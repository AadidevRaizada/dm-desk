import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { listPersonas, personaSchema } from "@/lib/server/coach/personas";

const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status, headers });

type Ctx = { params: Promise<{ id: string }> };

/** PATCH: edit fields and/or make this the default persona. */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const { id } = await params;
  const persona = await prisma.coachPersona.findFirst({
    where: { id, workspaceId: context.workspaceId },
    select: { id: true },
  });
  if (!persona) return fail("Persona not found", 404);

  const parsed = personaSchema
    .partial()
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success) return fail("Check the persona's fields.", 400);
  const { isDefault, ...fields } = parsed.data;

  await prisma.$transaction(async (tx) => {
    if (isDefault) {
      await tx.coachPersona.updateMany({
        where: { workspaceId: context.workspaceId },
        data: { isDefault: false },
      });
    }
    await tx.coachPersona.update({
      where: { id },
      data: { ...fields, ...(isDefault ? { isDefault: true } : {}) },
    });
  });
  const data = await listPersonas(context.workspaceId);
  return NextResponse.json({ success: true, data }, { headers });
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const { id } = await params;
  const all = await listPersonas(context.workspaceId);
  const target = all.find((p) => p.id === id);
  if (!target) return fail("Persona not found", 404);
  if (all.length <= 1) return fail("Keep at least one persona.", 400);

  await prisma.$transaction(async (tx) => {
    await tx.coachPersona.delete({ where: { id } });
    if (target.isDefault) {
      const next = all.find((p) => p.id !== id)!;
      await tx.coachPersona.update({
        where: { id: next.id },
        data: { isDefault: true },
      });
    }
  });
  const data = await listPersonas(context.workspaceId);
  return NextResponse.json({ success: true, data }, { headers });
}
