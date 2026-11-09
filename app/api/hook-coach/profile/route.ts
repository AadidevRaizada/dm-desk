import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { MAX_REFERENCES } from "@/lib/hook-coach-story";
import { getHookCoachProfile } from "@/lib/server/hook-coach-profile";

const profileSchema = z.object({
  niche: z.string().trim().max(200).default(""),
  audience: z.string().trim().max(300).default(""),
  cta: z.string().trim().max(300).default(""),
  references: z
    .array(z.string().trim().min(1).max(80))
    .max(MAX_REFERENCES)
    .default([]),
});

const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status, headers });

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  try {
    const data = await getHookCoachProfile(context.workspaceId);
    return NextResponse.json({ success: true, data }, { headers });
  } catch {
    return fail("Unable to load your style profile", 500);
  }
}

export async function PUT(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const parsed = profileSchema.safeParse(
    await request.json().catch(() => null)
  );
  if (!parsed.success) {
    return fail(
      `Check your style: short text fields and up to ${MAX_REFERENCES} reference creators.`,
      400
    );
  }
  const { niche, audience, cta } = parsed.data;
  // De-duplicate case-insensitively, keeping the first spelling.
  const seen = new Set<string>();
  const references = parsed.data.references.filter((r) => {
    const key = r.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  try {
    const fields = { niche, audience, cta, references };
    await prisma.hookCoachProfile.upsert({
      where: { workspaceId: context.workspaceId },
      create: { workspaceId: context.workspaceId, ...fields },
      update: fields,
    });
    const data = await getHookCoachProfile(context.workspaceId);
    return NextResponse.json({ success: true, data }, { headers });
  } catch {
    return fail("Unable to save your style profile", 500);
  }
}
