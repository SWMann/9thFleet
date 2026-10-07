import "server-only";

/**
 * The address this site is being reached at, such as https://example.org.
 * Behind Vercel the real host arrives in the forwarded headers.
 */
export function originOf(headers: Headers, fallback?: string): string {
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  if (!host) {
    if (fallback) return fallback;
    throw new Error("The request has no host header.");
  }
  const local = host.startsWith("localhost") || host.startsWith("127.0.0.1");
  const protocol = headers.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${protocol}://${host}`;
}
