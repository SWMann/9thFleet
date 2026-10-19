import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // The manual's words are read from files, so they must travel with its pages.
  outputFileTracingIncludes: { "/manual/**": ["./content/manual/**"] },
  // The PDF renderer brings its own fonts and layout engine, and is left as it is.
  serverExternalPackages: ["@react-pdf/renderer"],
};

export default nextConfig;
