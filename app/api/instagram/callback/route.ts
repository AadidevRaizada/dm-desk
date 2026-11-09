import { NextRequest, NextResponse } from "next/server";
import { auth, signIn } from "@/lib/auth";
import { ensureWorkspaceForUser } from "@/lib/workspace";
import { prisma } from "@/lib/db/client";
import { getBaseUrl } from "@/lib/env";
import { canConnectInstagramAccount } from "@/lib/instagram-accounts";
import { getLongLivedToken, getUserInfo, subscribeInstagramAccountToWebhooks } from "@/lib/meta/client";
import {
  createLoginHandoffToken,
  encryptToken,
  exchangeCodeForToken,
  verifyOAuthState,
} from "@/lib/meta/oauth";
import { invalidateSettingsCache } from "@/lib/server/settings";
import { invalidateWorkspaceStats } from "@/lib/server/stats";
import { canManageInstagramAccounts } from "@/lib/workspace-access";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");
  const state = verifyOAuthState(request.nextUrl.searchParams.get("state"));
  const baseUrl = getBaseUrl();

  if (error || !code || !state) {
    const dest = state?.mode === "login" ? "/login?error=" + encodeURIComponent(error ? "Instagram sign-in was cancelled." : "Sign-in link expired. Try again.") : `/settings?instagram=${error ? "denied" : "invalid"}`;
    return NextResponse.redirect(`${baseUrl}${dest}`);
  }

  const isLogin = state.mode === "login";
  const failUrl = (q: string) =>
    isLogin ? `${baseUrl}/login?error=${encodeURIComponent(q)}` : `${baseUrl}/settings?instagram=${q}`;

  let workspaceId = state.workspaceId;
  let loginUserId: string | null = null;

  if (!isLogin) {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.redirect(`${baseUrl}/login`);
    }
    const membership = await prisma.workspaceMember.findFirst({
      where: { workspaceId, userId: session.user.id },
    });
    if (!membership || !canManageInstagramAccounts(membership)) {
      return NextResponse.redirect(`${baseUrl}/settings?instagram=forbidden`);
    }
  }

  try {
    const redirectUri = `${baseUrl}/api/instagram/callback`;
    const { accessToken: shortLivedToken } = await exchangeCodeForToken(
      code,
      redirectUri
    );
    const { accessToken: longLivedToken, expiresIn } =
      await getLongLivedToken(shortLivedToken);
    const userInfo = await getUserInfo(longLivedToken);
    // Webhooks and the messaging API key off the professional account ID
    // (user_id), not the app-scoped `id`. Store user_id so comment webhooks
    // can be matched back to this account. Fall back to id if user_id is
    // ever absent.
    const instagramId = userInfo.user_id ?? userInfo.id;

    if (isLogin) {
      const allowed = (process.env.ALLOWED_INSTAGRAM_USERNAMES ?? "")
        .split(",").map((u) => u.trim().toLowerCase()).filter(Boolean);
      if (allowed.length > 0 && !allowed.includes(userInfo.username.toLowerCase())) {
        return NextResponse.redirect(failUrl("This Instagram account isn't allowed on this DM Desk."));
      }
      const existing = await prisma.instagramAccount.findUnique({
        where: { instagramId },
        select: { workspace: { select: { id: true, ownerId: true } } },
      });
      if (existing) {
        workspaceId = existing.workspace.id;
        loginUserId = existing.workspace.ownerId;
      } else {
        const user = await prisma.user.create({ data: { name: userInfo.username } });
        workspaceId = (await ensureWorkspaceForUser(user.id)).id;
        loginUserId = user.id;
      }
    }
    const connection = await canConnectInstagramAccount({
      workspaceId: workspaceId,
      instagramId,
    });

    if (!connection.allowed) {
      return NextResponse.redirect(
        `${baseUrl}/settings?instagram=already_connected`
      );
    }

    const encryptedToken = encryptToken(longLivedToken);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000);

    let webhookSubscribed = false;
    try {
      const subscription = await subscribeInstagramAccountToWebhooks(
        instagramId,
        longLivedToken
      );
      webhookSubscribed = Boolean(subscription.success);
    } catch (subscriptionError) {
      console.warn(
        "[Instagram Callback] Webhook subscription failed:",
        subscriptionError
      );
    }

    await prisma.instagramAccount.upsert({
      where: { instagramId },
      create: {
        workspaceId: workspaceId,
        instagramId,
        username: userInfo.username,
        name: userInfo.name,
        accessToken: encryptedToken,
        tokenExpiresAt,
        webhookSubscribed,
      },
      update: {
        workspaceId: workspaceId,
        username: userInfo.username,
        name: userInfo.name,
        accessToken: encryptedToken,
        tokenExpiresAt,
        webhookSubscribed,
      },
    });

    // New/updated account — drop the dashboard's cached stats so the account
    // list and counts refresh on the landing redirect.
    invalidateWorkspaceStats(workspaceId);
    invalidateSettingsCache(workspaceId);

    if (!isLogin) {
      return NextResponse.redirect(`${baseUrl}/dashboard?connected=true`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[Instagram Callback] Error:", err);
    // The message is the only diagnostic a self-hoster gets for a failed
    // connect, so persist it alongside the other operational events rather
    // than leaving it in server logs they may not be able to reach.
    await prisma.operationalEvent
      .create({
        data: {
          source: "SYSTEM",
          level: "ERROR",
          workspaceId: workspaceId,
          message: "Instagram connection failed",
          payload: { reason: message },
        },
      })
      .catch(() => {});

    return NextResponse.redirect(
      isLogin
        ? failUrl(`Instagram sign-in failed: ${message.slice(0, 200)}`)
        : `${baseUrl}/settings?instagram=failed&reason=${encodeURIComponent(message.slice(0, 200))}`
    );
  }

  // Login mode: start the NextAuth session. signIn() throws a redirect, so it
  // must run outside the try/catch above.
  await signIn("instagram-handoff", {
    token: createLoginHandoffToken(loginUserId!),
    redirectTo: "/dashboard?connected=true",
  });
  return NextResponse.redirect(`${baseUrl}/dashboard`);
}
