import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { CoachPersonaData } from "@/lib/coach/types";

/**
 * Coach personas: configurable coach voices per workspace. The four defaults
 * are seeded the first time a workspace opens the Coach.
 */

export const DEFAULT_PERSONAS: Array<
  Omit<CoachPersonaData, "id" | "sortOrder">
> = [
  {
    name: "Retention Editor",
    emoji: "✂️",
    description: "Cuts, pacing, re-hooks and the first 3 seconds.",
    isDefault: true,
    instructions: `You are a ruthless short-form video editor. You care about one thing: people still watching at the end.
- Judge the first 3 seconds hardest: the first frame, the first spoken words and the on-screen text must open a question.
- Find dead air, slow setups, repeated points and anything that could be cut. Name the exact second.
- Every 5-8 seconds there must be a new visual, a pattern interrupt or a re-hook line.
- Prefer concrete edits ("cut 0:04-0:07", "put the result on screen at 0:01") over general advice.`,
  },
  {
    name: "Storyteller",
    emoji: "📖",
    description: "Narrative arcs, open loops and a payoff that lands.",
    isDefault: false,
    instructions: `You are a story coach for short-form video.
- Every reel is a story: a hook that opens a loop, content that raises the stakes, re-hooks that open the next loop before closing the last, and a payoff that pays the promise off.
- Look for the tension: what does the viewer want to know, and when do they find out? Delay the answer, never drop it.
- Make the payoff feel earned and quotable; it carries the creator's CTA.
- Suggest specific lines, not vague tips.`,
  },
  {
    name: "Growth Strategist",
    emoji: "📈",
    description: "Shares, saves, follows, the CTA and when to post.",
    isDefault: false,
    instructions: `You are a growth strategist for an Instagram creator.
- Optimise for shares, saves and follows, not likes. Ask: why would someone send this to a friend or save it for later?
- The CTA must give a reason to act now (a resource, a part 2, a template) and sit at the payoff, said out loud and on screen.
- Use his own numbers (best posting time, top posts by shares+saves) to back every recommendation.
- Be specific about what to change and the metric it should move.`,
  },
  {
    name: "Brand Voice",
    emoji: "🎙️",
    description: "Keeps it sounding like you: your niche, audience and references.",
    isDefault: false,
    instructions: `You protect the creator's voice.
- Everything you write must sound like his top posts: his vocabulary, rhythm, language mix and level of formality. No generic guru phrasing.
- Stay inside his niche and speak to his audience as described in his profile.
- Borrow structure from his reference creators, never their words or catchphrases.
- If a suggestion would make him sound like someone else, say so and offer a version in his voice.`,
  },
];

const select = {
  id: true,
  name: true,
  emoji: true,
  description: true,
  instructions: true,
  isDefault: true,
  sortOrder: true,
} as const;

/** All personas for a workspace, seeding the defaults on first use. */
export async function listPersonas(
  workspaceId: string
): Promise<CoachPersonaData[]> {
  const rows = await prisma.coachPersona.findMany({
    where: { workspaceId },
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    select,
  });
  if (rows.length > 0) return rows;

  // Seed inside a transaction and re-check so two first loads don't double-seed.
  return prisma.$transaction(async (tx) => {
    const again = await tx.coachPersona.count({ where: { workspaceId } });
    if (again === 0) {
      await tx.coachPersona.createMany({
        data: DEFAULT_PERSONAS.map((p, i) => ({
          ...p,
          workspaceId,
          sortOrder: i,
        })),
      });
    }
    return tx.coachPersona.findMany({
      where: { workspaceId },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
      select,
    });
  });
}

/** The persona to use: the requested one if it's in this workspace, else the default. */
export async function resolvePersona(
  workspaceId: string,
  personaId?: string | null
): Promise<CoachPersonaData> {
  const all = await listPersonas(workspaceId);
  return (
    (personaId ? all.find((p) => p.id === personaId) : undefined) ??
    all.find((p) => p.isDefault) ??
    all[0] ?? {
      id: "",
      sortOrder: 0,
      ...DEFAULT_PERSONAS[0],
    }
  );
}

export const personaSchema = z.object({
  name: z.string().trim().min(1).max(60),
  emoji: z.string().trim().max(16).default(""),
  description: z.string().trim().max(200).default(""),
  instructions: z.string().trim().min(1).max(6000),
  isDefault: z.boolean().optional(),
});
