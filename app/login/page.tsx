import { Suspense } from "react";
import { signIn } from "@/lib/auth";
import { getCampaignTemplate } from "@/lib/templates/campaign-templates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowRightIcon,
  GithubLogoIcon,
  GoogleLogoIcon,
  InstagramLogoIcon,
} from "@phosphor-icons/react/dist/ssr";
import { AhumMark, LoginScene } from "@/components/handdrawn/critter-art";
import SoundToggle from "@/components/handdrawn/sound-toggle";
import { ModeToggle } from "@/components/theme-toggle";

export const metadata = {
  title: "Sign in - DM Desk",
  description: "Your Instagram DMs, stats and hooks in one place.",
};

type LoginSearchParams = Promise<{
  callbackUrl?: string;
  template?: string;
  error?: string;
}>;

function getErrorMessage(
  error: string,
): { title: string; description: string } | null {
  switch (error) {
    case "OAuthAccountNotLinked":
      return {
        title: "Email already linked to another method",
        description:
          "This email is already registered with a different sign-in method (e.g. magic link or another OAuth provider). Sign in with the original method first, then you can link Google/GitHub from your account. Or contact support to merge accounts.",
      };
    case "OAuthCallback":
    case "OAuthSignin":
    case "OAuthCreateAccount":
    case "Callback":
      return {
        title: "Sign-in failed",
        description:
          "The OAuth provider returned an error. Please try again or use another method.",
      };
    case "EmailSignin":
    case "EmailCreateAccount":
    case "Verification":
      return {
        title: "Magic link failed",
        description:
          "Could not send the magic link. Check your email address or try OAuth instead.",
      };
    case "AccessDenied":
      return {
        title: "Access denied",
        description: "You don't have permission to sign in.",
      };
    case "Configuration":
      return {
        title: "Configuration error",
        description:
          "The auth provider is misconfigured (check redirect URI / client secret).",
      };
    default:
      if (error)
        return {
          title: "Something went wrong",
          description: decodeURIComponent(error),
        };
      return null;
  }
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: LoginSearchParams;
}) {
  return (
    <Suspense fallback={<div className="min-h-dvh" />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}

async function LoginContent({ searchParams }: { searchParams: LoginSearchParams }) {
  const params = await searchParams;
  const selectedTemplate = getCampaignTemplate(params.template);
  const templateCallbackUrl = selectedTemplate
    ? `/campaigns/new?template=${selectedTemplate.slug}`
    : null;
  const callbackUrl = params.callbackUrl ?? templateCallbackUrl ?? "/dashboard";
  const errorInfo = params.error ? getErrorMessage(params.error) : null;

  const hasResend = !!process.env.RESEND_API_KEY;
  const hasGoogle =
    !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
  const hasGitHub = !!(
    (process.env.GITHUB_ID ?? process.env.GITHUB_CLIENT_ID) &&
    (process.env.GITHUB_SECRET ?? process.env.GITHUB_CLIENT_SECRET)
  );
  const hasOAuth = hasGoogle || hasGitHub;
  const hasAnyProvider = hasOAuth || hasResend;

  async function sendMagicLink(formData: FormData) {
    "use server";
    await signIn("resend", {
      email: String(formData.get("email") ?? ""),
      redirectTo: callbackUrl,
    });
  }

  async function signInWithGoogle() {
    "use server";
    await signIn("google", { redirectTo: callbackUrl });
  }

  async function signInWithGitHub() {
    "use server";
    await signIn("github", { redirectTo: callbackUrl });
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-end gap-2 px-4 pt-4">
        <SoundToggle />
        <ModeToggle />
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-10 pt-2 sm:items-center">
        <div className="w-full max-w-sm">
          <LoginScene className="mx-auto w-full max-w-[320px]" />

          <div className="mt-2 flex items-center justify-center gap-2">
            <AhumMark className="size-9" />
            <h1 className="font-display text-5xl leading-none">DM Desk</h1>
          </div>
          <p className="mt-3 text-center text-base leading-relaxed">
            {selectedTemplate
              ? `Sign in to use the ${selectedTemplate.title} template.`
              : "Your Instagram DMs, stats and hooks in one place."}
          </p>

          {errorInfo && (
            <div
              role="alert"
              className="hr3 mt-6 border-2 border-hd-accent bg-paper2 px-4 py-3 text-sm leading-6"
            >
              <p className="font-semibold text-hd-accent">{errorInfo.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {errorInfo.description}
              </p>
            </div>
          )}

          <a
            href="/api/instagram/login"
            className="clicky hr1 mt-7 flex h-14 w-full items-center justify-center gap-2.5 border-[2.5px] border-ink bg-hd-accent font-display text-2xl text-paper2 transition-opacity hover:opacity-90"
          >
            <InstagramLogoIcon size={26} weight="bold" />
            Sign in with Instagram
          </a>
          <p className="mt-3 text-center text-xs text-muted-foreground">
            Only invited accounts can sign in.
          </p>

          {/* Other sign-in methods only appear when their keys are set. */}
          {hasAnyProvider && (
            <div className="mt-8 space-y-3">
              {hasGoogle && (
                <form action={signInWithGoogle}>
                  <Button type="submit" className="w-full" size="lg" variant="outline">
                    <GoogleLogoIcon size={18} className="mr-2" />
                    Continue with Google
                  </Button>
                </form>
              )}
              {hasGitHub && (
                <form action={signInWithGitHub}>
                  <Button type="submit" className="w-full" size="lg" variant="outline">
                    <GithubLogoIcon size={18} className="mr-2" />
                    Continue with GitHub
                  </Button>
                </form>
              )}
              {hasResend && (
                <form action={sendMagicLink} className="space-y-3">
                  <div className="space-y-2">
                    <label htmlFor="email" className="block text-sm font-medium">
                      Email
                    </label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      required
                      autoComplete="email"
                      placeholder="you@example.com"
                    />
                  </div>
                  <Button type="submit" className="w-full" size="lg" variant="outline">
                    Email me a sign-in link <ArrowRightIcon className="ml-2 h-4 w-4" />
                  </Button>
                </form>
              )}
            </div>
          )}

          <p className="mt-10 text-center text-xs text-muted-foreground">
            By continuing, you agree to the{" "}
            <a href="/terms" className="underline underline-offset-2">
              Terms
            </a>{" "}
            and{" "}
            <a href="/privacy" className="underline underline-offset-2">
              Privacy Policy
            </a>
            .
          </p>
        </div>
      </main>
    </div>
  );
}
