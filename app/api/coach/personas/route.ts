import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { listPersonas, personaSchema } from "@/lib/server/coach/personas";


const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status, headers });

export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const data = await listPersonas(context.workspaceId);
  return NextResponse.json({ success: true, data }, { headers });
}

export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const parsed = personaSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return fail("Give the persona a name and some instructions.", 400);
  }
  const existing = await listPersonas(context.workspaceId);
  if (existing.length >= 20) return fail("Up to 20 personas.", 400);
  const { isDefault, ...fields } = parsed.data;
  await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.coachPersona.updateMany({
        where: { workspaceId: context.workspaceId },
        data: { isDefault: false },
      });
    }
    await tx.coachPersona.create({
      data: {
        ...fields,
        workspaceId: context.workspaceId,
        isDefault: Boolean(isDefault),
        sortOrder: Math.max(0, ...existing.map((p) => p.sortOrder)) + 1,
      },
    });
  });
  const data = await listPersonas(context.workspaceId);
  return NextResponse.json({ success: true, data }, { headers });
}
