// Signs the session tokens the stand-ins hand out, the way Supabase does, so
// the site can check them with the published key.

import { createSign, generateKeyPairSync } from "node:crypto";

const base64url = (input) => Buffer.from(input).toString("base64url");

export function createSigner() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const kid = "stand-in-key-1";
  return {
    /** The public half, as served at /auth/v1/.well-known/jwks.json. */
    jwk: { ...publicKey.export({ format: "jwk" }), kid, alg: "ES256", use: "sig", key_ops: ["verify"] },
    sign(claims) {
      const head = base64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid }));
      const body = base64url(JSON.stringify(claims));
      const signature = createSign("SHA256")
        .update(`${head}.${body}`)
        .sign({ key: privateKey, dsaEncoding: "ieee-p1363" });
      return `${head}.${body}.${base64url(signature)}`;
    },
  };
}

/** The claims inside a token, without checking it. Null if it is not a token. */
export function readClaims(token) {
  const parts = (token ?? "").split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
}
