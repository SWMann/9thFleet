import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The manual's words are read from files, so they must travel with its pages.
  outputFileTracingIncludes: { "/manual/**": ["./content/manual/**"] },
};

export default nextConfig;
