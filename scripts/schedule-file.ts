import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../lib/db/client";
import { captionProblem } from "../lib/scheduling/rules";
import {
  SCHEDULED_DIR,
  absolutePath,
  coverRelPath,
  ensureDirs,
  extractCover,
  faststartRemux,
  probeProblem,
  probeVideo,
} from "../lib/scheduling/storage";

// Schedule a video file that is already on this Mac (the Content pipeline's renders) without the browser upload.
// Same steps as POST /api/schedule: faststart into storage/scheduled, a cover frame, one ScheduledPost row.
//
//   npx tsx scripts/schedule-file.ts --file <mp4> --caption-file <txt> --at <ISO with offset>
//     [--account ahum.what.if] [--thumb-ms 400] [--trial SS_PERFORMANCE|MANUAL] [--apply]
//   npx tsx scripts/schedule-file.ts --list        (what is scheduled, next 14 days)
//   npx tsx scripts/schedule-file.ts --status <id> (one JSON line: status, mediaId, permalink)
//
// Dry-run by default: prints what it would schedule and any clash. --apply writes it.
function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function list() {
  const rows = await prisma.scheduledPost.findMany({
    where: { scheduledAt: { gte: new Date(Date.now() - 86_400_000), lte: new Date(Date.now() + 14 * 86_400_000) } },
    orderBy: { scheduledAt: "asc" },
    select: { id: true, scheduledAt: true, status: true, kind: true, trialStrategy: true, caption: true, instagramAccount: { select: { username: true } } },
  });
  for (const r of rows)
    console.log(`${r.scheduledAt.toISOString()}  ${r.status.padEnd(10)} @${r.instagramAccount.username}  ${r.kind}${r.trialStrategy ? " trial" : ""}  ${r.caption.split("\n")[0].slice(0, 60)}  (${r.id})`);
  if (!rows.length) console.log("nothing scheduled in the next 14 days");
}

// --status <id>: one JSON line {id,status,mediaId,permalink,publishedAt,error} for the Content repo's queue sync
async function status(id: string) {
  const r = await prisma.scheduledPost.findUnique({ where: { id }, select: { id: true, status: true, mediaId: true, permalink: true, publishedAt: true, error: true } });
  console.log(JSON.stringify(r ?? { id, status: "MISSING" }));
}

async function main() {
  if (process.argv.includes("--list")) return list();
  const sid = arg("status");
  if (sid) return status(sid);
  const file = arg("file"), captionFile = arg("caption-file"), at = arg("at");
  if (!file || !captionFile || !at) throw new Error("need --file, --caption-file and --at");
  const apply = process.argv.includes("--apply");
  const username = arg("account") ?? "ahum.what.if";
  const thumbMs = Number(arg("thumb-ms") ?? 0);
  const trial = arg("trial") ?? null;
  if (trial && !["SS_PERFORMANCE", "MANUAL"].includes(trial)) throw new Error("--trial must be SS_PERFORMANCE or MANUAL");

  const scheduledAt = new Date(at);
  if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() + 5 * 60_000)
    throw new Error("--at must be a valid time at least 5 minutes from now");
  const caption = (await readFile(captionFile, "utf8")).trim();
  const problem = captionProblem(caption);
  if (problem) throw new Error(problem);

  const account = await prisma.instagramAccount.findFirst({ where: { username }, select: { id: true, workspaceId: true, username: true } });
  if (!account) throw new Error(`no connected Instagram account @${username}`);

  const src = path.resolve(file);
  const probe = await probeVideo(src);
  const bad = probeProblem(probe, (await stat(src)).size);
  if (bad) throw new Error(bad);

  // clash check: another post for this account within 6 h
  const near = await prisma.scheduledPost.findMany({
    where: { instagramAccountId: account.id, status: { in: ["SCHEDULED", "PUBLISHING"] },
      scheduledAt: { gte: new Date(scheduledAt.getTime() - 6 * 3_600_000), lte: new Date(scheduledAt.getTime() + 6 * 3_600_000) } },
    select: { id: true, scheduledAt: true },
  });
  console.log(`@${account.username}  ${scheduledAt.toISOString()}  ${probe.durationSec.toFixed(1)} s ${probe.width}x${probe.height}  trial=${trial ?? "no"}`);
  console.log(`caption: ${caption.split("\n")[0]}`);
  if (near.length) console.log(`WARNING: ${near.length} other post(s) within 6 h: ${near.map((n) => n.scheduledAt.toISOString()).join(", ")}`);
  if (!apply) return console.log("dry run: nothing written (add --apply)");

  await ensureDirs();
  const id = randomUUID().replace(/-/g, "").slice(0, 25);
  const videoPath = `${SCHEDULED_DIR}/${id}.mp4`;
  if (!(await faststartRemux(src, absolutePath(videoPath)))) throw new Error("could not copy the video into storage");
  const offset = Math.min(thumbMs, Math.max(0, Math.floor(probe.durationSec * 1000) - 100));
  const coverRel = coverRelPath(id, offset);
  const hasCover = await extractCover(absolutePath(videoPath), offset, absolutePath(coverRel));
  const post = await prisma.scheduledPost.create({
    data: {
      id, workspaceId: account.workspaceId, instagramAccountId: account.id, caption, videoPath,
      coverPath: hasCover || offset > 0 ? coverRel : null, shareToFeed: true, trialStrategy: trial,
      scheduledAt, status: "SCHEDULED", durationSec: probe.durationSec > 0 ? probe.durationSec : null,
    },
    select: { id: true, scheduledAt: true },
  });
  console.log(`scheduled ${post.id} for ${post.scheduledAt.toISOString()}`);
}

main()
  .catch((e) => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
