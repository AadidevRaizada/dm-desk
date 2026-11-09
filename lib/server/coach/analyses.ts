import { prisma } from "@/lib/db/client";
import type { CoachKind, SavedAnalysis } from "@/lib/coach/types";

export const analysisSelect = {
  id: true,
  kind: true,
  mediaId: true,
  personaId: true,
  input: true,
  result: true,
  expectedRetention: true,
  createdAt: true,
} as const;

type Row = {
  id: string;
  kind: string;
  mediaId: string | null;
  personaId: string | null;
  input: unknown;
  result: unknown;
  expectedRetention: unknown;
  createdAt: Date;
};

/** A pending analyze job older than this is treated as interrupted. */
export const STALE_JOB_MS = 15 * 60 * 1000;

export function toSaved(row: Row): SavedAnalysis {
  let result = row.result;
  const r = result as { status?: string; startedAt?: string } | null;
  if (
    row.kind === "analyze" &&
    r?.status === "pending" &&
    Date.now() - new Date(r.startedAt ?? row.createdAt).getTime() > STALE_JOB_MS
  ) {
    result = {
      ...r,
      status: "error",
      error: "This analysis was interrupted (the server restarted). Tap Redo.",
    };
  }
  return {
    id: row.id,
    kind: row.kind as CoachKind,
    mediaId: row.mediaId,
    personaId: row.personaId,
    input: row.input,
    result,
    expectedRetention: row.expectedRetention,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listAnalyses(
  workspaceId: string,
  opts: { kind?: CoachKind; mediaId?: string; take?: number } = {}
): Promise<SavedAnalysis[]> {
  const rows = await prisma.coachAnalysis.findMany({
    where: {
      workspaceId,
      ...(opts.kind ? { kind: opts.kind } : {}),
      ...(opts.mediaId ? { mediaId: opts.mediaId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 200,
    select: analysisSelect,
  });
  return rows.map(toSaved);
}

export async function getAnalysis(
  workspaceId: string,
  id: string
): Promise<SavedAnalysis | null> {
  const row = await prisma.coachAnalysis.findFirst({
    where: { id, workspaceId },
    select: analysisSelect,
  });
  return row ? toSaved(row) : null;
}
