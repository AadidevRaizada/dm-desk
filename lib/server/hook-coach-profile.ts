import { prisma } from "@/lib/db/client";
import {
  DEFAULT_REFERENCES,
  type HookCoachProfileData,
} from "@/lib/hook-coach-story";

/** The workspace's Hook Coach style profile, with defaults when unsaved. */
export async function getHookCoachProfile(
  workspaceId: string
): Promise<HookCoachProfileData> {
  const row = await prisma.hookCoachProfile.findUnique({
    where: { workspaceId },
    select: { niche: true, audience: true, cta: true, references: true },
  });
  if (!row) {
    return {
      niche: "",
      audience: "",
      cta: "",
      references: [...DEFAULT_REFERENCES],
      saved: false,
    };
  }
  return {
    niche: row.niche,
    audience: row.audience,
    cta: row.cta,
    references: row.references.length > 0 ? row.references : [...DEFAULT_REFERENCES],
    saved: true,
  };
}
