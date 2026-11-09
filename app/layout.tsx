import type { Metadata } from "next";
import "./globals.css";
import "goey-toast/styles.css";
import GooeyToasterMount from "@/components/goey-toaster";
import QueryProvider from "@/lib/query/provider";
import { ThemeProvider } from "@/components/theme-provider";
// import Script from "next/script";
import { gochiHand, shantellSans } from "@/lib/fonts";
import HdLife from "@/components/handdrawn/hd-life";

export const metadata: Metadata = {
  title: "DM Desk",
  description: "Your Instagram DMs, stats and hooks in one place.",
  metadataBase: new URL(process.env.NEXTAUTH_URL ?? "https://instagram.ahumlabs.com"),
  applicationName: "DM Desk",
  openGraph: {
    title: "DM Desk",
    description: "Your Instagram DMs, stats and hooks in one place.",
    siteName: "DM Desk",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "DM Desk",
    description: "Your Instagram DMs, stats and hooks in one place.",
  },
  robots: { index: false, follow: false },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={gochiHand.variable + " " + shantellSans.variable}
    >
      <head>
        <meta
          name="google-site-verification"
          content="1ywEvz4B5lYEEfkF2hEWRlDFzCAVq-5_Qb37AgpM7Wg"
        />
        <meta name="apple-mobile-web-app-title" content="DM Desk" />
        {/* {process.env.NODE_ENV === "development" && (
          <Script
            src="//unpkg.com/react-scan/dist/auto.global.js"
            crossOrigin="anonymous"
            strategy="beforeInteractive"
          />
        )} */}
      </head>
      <body className="hd-page min-h-full antialiased">
        <QueryProvider>
          <ThemeProvider
            attribute="class"
            defaultTheme="light"
            enableSystem
            disableTransitionOnChange
          >
            {children}
            <GooeyToasterMount />
            <HdLife />
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
