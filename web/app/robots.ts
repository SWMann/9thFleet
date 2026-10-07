import type { MetadataRoute } from "next";
import { indexable } from "@/lib/site";

/** Pages that belong to one signed-in person and are never for search engines. */
const memberPages = ["/profile", "/sign-in", "/auth/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: indexable ? { userAgent: "*", allow: "/", disallow: memberPages } : { userAgent: "*", disallow: "/" },
  };
}
