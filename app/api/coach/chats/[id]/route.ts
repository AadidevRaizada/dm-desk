import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { getChatMessages, sendChatMessage } from "@/lib/server/coach/chat";

export const maxDuration = 120;

const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status, headers });
type Ctx = { params: Promise<{ id: string }> };

async function ownChat(workspaceId: string, id: string) {
  return prisma.coachChat.findFirst({
    where: { id, workspaceId },
    select: { id: true, personaId: true },
  });
}

export async function GET(_request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const { id } = await params;
  const chat = await ownChat(context.workspaceId, id);
  if (!chat) return fail("Chat not found", 404);
  const data = await getChatMessages(chat.id);
  return NextResponse.json({ success: true, data }, { headers });
}

/** POST {message, personaId?}: send the next message, get the reply. */
export async function POST(request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const { id } = await params;
  const chat = await ownChat(context.workspaceId, id);
  if (!chat) return fail("Chat not found", 404);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return fail("Type a message first.", 400);
  try {
    const { user, reply } = await sendChatMessage({
      workspaceId: context.workspaceId,
      chatId: chat.id,
      personaId: typeof body?.personaId === "string" ? body.personaId : chat.personaId,
      message,
      instagramAccountId:
        typeof body?.instagramAccountId === "string" ? body.instagramAccountId : undefined,
    });
    return NextResponse.json({ success: true, messages: [user, reply] }, { headers });
  } catch (err) {
    console.error("[Coach] chat failed:", err instanceof Error ? err.message : err);
    return fail("The coach couldn't answer right now. Try again.", 502);
  }
}

export async function DELETE(_request: NextRequest, { params }: Ctx) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const { id } = await params;
  const { count } = await prisma.coachChat.deleteMany({
    where: { id, workspaceId: context.workspaceId },
  });
  return NextResponse.json({ success: count > 0 }, { status: count > 0 ? 200 : 404, headers });
}
