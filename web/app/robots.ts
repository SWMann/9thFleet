import type { MetadataRoute } from "next";
import { indexable } from "@/lib/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: indexable ? { userAgent: "*", allow: "/" } : { userAgent: "*", disallow: "/" },
  };
}
