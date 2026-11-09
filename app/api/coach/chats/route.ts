import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { chatTitle, sendChatMessage } from "@/lib/server/coach/chat";
import { resolvePersona } from "@/lib/server/coach/personas";

export const maxDuration = 120;

const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) =>
  NextResponse.json({ success: false, error }, { status, headers });

/** GET: recent chats, newest first. */
export async function GET() {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const chats = await prisma.coachChat.findMany({
    where: { workspaceId: context.workspaceId },
    orderBy: { updatedAt: "desc" },
    take: 30,
    select: { id: true, title: true, personaId: true, updatedAt: true },
  });
  return NextResponse.json(
    {
      success: true,
      data: chats.map((c) => ({ ...c, updatedAt: c.updatedAt.toISOString() })),
    },
    { headers }
  );
}

/** POST {message, personaId?}: start a chat with its first message. */
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return fail("Unauthorized", 401);
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return fail("Type a message first.", 400);
  const persona = await resolvePersona(
    context.workspaceId,
    typeof body?.personaId === "string" ? body.personaId : null
  );
  const chat = await prisma.coachChat.create({
    data: {
      workspaceId: context.workspaceId,
      personaId: persona.id || null,
      title: chatTitle(message),
    },
    select: { id: true, title: true, personaId: true, updatedAt: true },
  });
  const summary = { ...chat, updatedAt: chat.updatedAt.toISOString() };
  try {
    const { user, reply } = await sendChatMessage({
      workspaceId: context.workspaceId,
      chatId: chat.id,
      personaId: persona.id,
      message,
      instagramAccountId:
        typeof body?.instagramAccountId === "string" ? body.instagramAccountId : undefined,
    });
    return NextResponse.json({ success: true, chat: summary, messages: [user, reply] }, { headers });
  } catch (err) {
    console.error("[Coach] chat failed:", err instanceof Error ? err.message : err);
    return NextResponse.json(
      { success: false, chat: summary, error: "The coach couldn't answer right now. Try again." },
      { status: 502, headers }
    );
  }
}
