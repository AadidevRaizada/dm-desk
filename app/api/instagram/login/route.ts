import { NextResponse } from "next/server";
import { getBaseUrl, getMissingInstagramOAuthEnv } from "@/lib/env";
import { createLoginOAuthState, getAuthorizationUrl } from "@/lib/meta/oauth";

// "Sign in with Instagram": one tap signs in AND connects the account.
export async function GET() {
  const missing = getMissingInstagramOAuthEnv();
  if (missing.length > 0) {
    return NextResponse.redirect(
      `${getBaseUrl()}/login?error=${encodeURIComponent("Server not configured: " + missing.join(", "))}`
    );
  }
  const redirectUri = `${getBaseUrl()}/api/instagram/callback`;
  return NextResponse.redirect(getAuthorizationUrl(redirectUri, createLoginOAuthState()));
}
