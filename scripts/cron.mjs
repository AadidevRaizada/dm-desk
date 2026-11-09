// Scheduler for /api/cron/* on the Mac (Node port of scripts/cron.sh).
// Runs under launchd via node: macOS privacy rules stop /bin/sh from reading
// files on the Desktop when started as a daemon, but node has access.
//   - attach-next-reel  every :00 and :30
//   - refresh-tokens, snapshot-followers, snapshot-cleanup  daily at 05:xx UTC
//   - publish-scheduled  every minute (backup for the worker's publisher loop)
//   - evaluate-experiments  every 15 minutes (backup for the worker's strategy loop)
import { existsSync } from "node:fs";

if (existsSync(".env")) process.loadEnvFile(".env");

const BASE = process.env.CRON_BASE_URL ?? "http://localhost:3000";
const SECRET = process.env.CRON_SECRET || process.env.NEXTAUTH_SECRET;
if (!SECRET) {
  console.error("[cron] neither CRON_SECRET nor NEXTAUTH_SECRET is set");
  process.exit(1);
}

async function call(route, method = "GET") {
  const stamp = new Date().toISOString();
  try {
    const res = await fetch(`${BASE}/api/cron/${route}`, {
      method,
      headers: { Authorization: `Bearer ${SECRET}` },
      signal: AbortSignal.timeout(180_000),
    });
    const body = (await res.text()).slice(0, 300);
    (res.ok ? console.log : console.error)(`[cron] ${stamp} ${route} ${res.ok ? "ok" : "FAILED " + res.status} ${body}`);
  } catch (err) {
    console.error(`[cron] ${stamp} ${route} FAILED ${err?.message ?? err}`);
  }
}

let lastSlot = "";
let lastPublishMinute = "";
let lastDaily = "";
let lastEvaluate = "";
console.log(`[cron] scheduler started, target ${BASE}`);

async function tick() {
  const now = new Date();
  const iso = now.toISOString();
  const today = iso.slice(0, 10);
  const hhmm = iso.slice(11, 16);
  const minute = now.getUTCMinutes();
  // Not awaited: a publish can poll Instagram for minutes and must not hold up
  // the other jobs. Overlapping calls are safe (posts are claimed atomically).
  if (lastPublishMinute !== hhmm) {
    lastPublishMinute = hhmm;
    void call("publish-scheduled", "POST");
  }
  if (minute % 15 === 7 && lastEvaluate !== hhmm) {
    lastEvaluate = hhmm;
    void call("evaluate-experiments", "POST");
  }
  if ((minute === 0 || minute === 30) && lastSlot !== hhmm) {
    lastSlot = hhmm;
    await call("attach-next-reel");
  }
  if (now.getUTCHours() === 5 && lastDaily !== today) {
    lastDaily = today;
    await call("refresh-tokens");
    await call("snapshot-followers");
    await call("snapshot-cleanup");
  }
}

setInterval(() => void tick(), 30_000);
void tick();
