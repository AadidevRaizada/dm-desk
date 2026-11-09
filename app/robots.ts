import type { MetadataRoute } from "next";

// DM Desk is a private tool: keep it out of search engines.
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: "*", disallow: "/" } };
}
