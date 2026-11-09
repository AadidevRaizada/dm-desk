import { config as loadEnv } from "dotenv";
loadEnv();

import { createDMWorker } from "@/lib/queue/dm-worker";
import { recordWorkerHeartbeat } from "@/lib/ops/worker-health";
import { reconcileComments } from "@/lib/polling/comment-reconciler";
import { publishDuePosts } from "@/lib/scheduling/publisher";
import os from "node:os";

const worker = createDMWorker();
const startedAt = new Date().toISOString();
const HEARTBEAT_INTERVAL_MS = 30_000;
// Polling safety net for comments that webhooks miss. Runs in the worker because
// it must fire every few minutes and Vercel's free crons only run once a day.
//
// Neon pooled still needs a query-free window to autosuspend (default 5 min).
// 90 min halves the fixed sweep cost (~7 → ~5 CU-hours/month at 0.25 CU) while
// leaving a long idle window where Neon can suspend to 0 CU. Trade-off: a
// comment Meta's webhooks miss is now picked up up to 90 minutes late instead
// of 60. Polling covers comments only — DM inbox automations are webhook-only
// and never need this sweep.
// One account on an always-on Mac: poll often so comment→DM still works if
// Meta withholds comment webhooks (they need Advanced Access). Override with
// COMMENT_POLL_MINUTES.
const POLL_INTERVAL_MS =
  Math.max(1, Number(process.env.COMMENT_POLL_MINUTES ?? "2")) * 60_000;
const POLL_DISABLED = false;

console.log(
  `[DM Worker] Started (poll=${POLL_DISABLED ? "disabled" : `${POLL_INTERVAL_MS / 60_000}min`}, heartbeat=30s)`
);

async function heartbeat() {
  try {
    await recordWorkerHeartbeat({
      pid: process.pid,
      hostname: os.hostname(),
      startedAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Heartbeat failed:", message);
  }
}

void heartbeat();
const heartbeatTimer = setInterval(() => void heartbeat(), HEARTBEAT_INTERVAL_MS);

let pollRunning = false;
let pollTimer: ReturnType<typeof setTimeout> | null = null;

async function poll() {
  if (POLL_DISABLED) return;
  if (pollRunning) {
    console.log("[DM Worker] Previous sweep still running, skipping");
    return;
  }
  pollRunning = true;
  try {
    await reconcileComments();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Comment reconciliation failed:", message);
  } finally {
    pollRunning = false;
    pollTimer = setTimeout(() => void poll(), POLL_INTERVAL_MS);
  }
}

// Kick off one sweep shortly after boot (unless polling disabled).
if (!POLL_DISABLED) {
  setTimeout(() => void poll(), 10_000);
} else {
  console.log("[DM Worker] Comment polling disabled — webhook-only mode");
}

// Scheduled reels: publish anything due, every minute. A publish can poll
// Instagram for up to ~10 minutes, so ticks skip while one is running.
// /api/cron/publish-scheduled is a backup caller; claims make overlap safe.
const PUBLISH_INTERVAL_MS = 60_000;
let publishRunning = false;
async function publishTick() {
  if (publishRunning) return;
  publishRunning = true;
  try {
    const result = await publishDuePosts();
    if (result.claimed || result.recovered) {
      console.log("[DM Worker] Scheduled posts:", JSON.stringify(result));
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[DM Worker] Scheduled publish failed:", message);
  } finally {
    publishRunning = false;
  }
}
const publishTimer = setInterval(() => void publishTick(), PUBLISH_INTERVAL_MS);
setTimeout(() => void publishTick(), 15_000);

async function shutdown(signal: string) {
  console.log(`[DM Worker] ${signal} received, closing worker`);
  clearInterval(heartbeatTimer);
  clearInterval(publishTimer);
  if (pollTimer) clearTimeout(pollTimer);
  await worker.close();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
