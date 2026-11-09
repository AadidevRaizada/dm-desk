import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["instagram.ahumlabs.com"],
  // Cache Components: enables `use cache`/`cacheLife` and Partial Prerendering.
  // With it, `dynamic`/`revalidate`/`fetchCache` segment configs are replaced
  // by the new caching model — data fetching is dynamic by default and the
  // framework prerenders a static shell that streams dynamic content into.
  cacheComponents: true,
  // Each visible Link now prefetches the reusable route shell. Routes that
  // depend on URL-specific data can opt into runtime prefetching selectively
  // with `prefetch={true}`.
  partialPrefetching: true,
  // Client cache TTL for dynamic segments (default: 0 = not cached). Without
  // this, every navigation to a user-scoped page (dashboard, settings, …) hits
  // the server and flashes the loading skeleton. 4 minutes matches the
  // server-side cacheLife windows on the dashboard/settings reads. Mutations
  // still show fresh data immediately — router.refresh() and revalidateTag()
  // clear the client cache regardless of this TTL.
  experimental: {
    staleTimes: {
      dynamic: 240,
      static: 300,
    },
    turbopackRustReactCompiler: true,
    cachedNavigations: true,
    turbopackFileSystemCacheForBuild: true,
  },
  images: {
    remotePatterns: [
      {
        hostname: "*",
      },
    ],
  },
  reactCompiler: true,
  async redirects() {
    // DM Desk is private: the original project's marketing/SEO pages go to sign-in.
    const marketing = [
      "/auto-reply-instagram-comments", "/chatfuel-alternative", "/comment-link-automation",
      "/docs/:path*", "/docs", "/instagram-auto-dm", "/instagram-comment-to-dm-examples",
      "/instagram-dm-automation-agencies", "/instagram-keyword-automation",
      "/instagram-lead-magnet-automation", "/linkdm-alternative", "/manychat-alternative",
      "/instagram-comment-to-dm-templates",
    ].map((source) => ({ source, destination: "/login", permanent: false }));
    return [
      ...marketing,
      {
        source: "/instagram-comment-to-dm-templates-old",
        destination: "/instagram-comment-to-dm-examples",
        permanent: true,
      },
    ];
  },
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
