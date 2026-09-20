import type { MetadataRoute } from "next";

/**
 * The School Management System is a private staff portal served from its own
 * origin. The public marketing website is a separate site and owns search
 * indexing, so this origin opts out entirely.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}
