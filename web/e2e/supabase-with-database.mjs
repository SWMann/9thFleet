// A stand-in for Supabase with the fleet's real database behind it.
//
// It runs PostgreSQL in memory, applies the migrations in supabase/migrations
// unchanged, and answers the site's requests by running them against that
// database as the signed-in person. So the access rules, triggers and column
// grants the browser test meets are the real ones, not a copy of them.
//
// It understands only the kinds of request the site makes. Anything else is
// refused loudly, so a new kind of query shows up as a failed test and not as
// a wrong answer. It is never part of the running site.

import { PGlite } from "@electric-sql/pglite";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { createServer } from "node:http";
import { createSigner, readClaims } from "./tokens.mjs";

const supabaseDir = new URL("../../supabase/", import.meta.url);
const NAME = /^[a-z_][a-z0-9_]*$/;

export async function startSupabaseWithDatabase(port) {
  const origin = `http://127.0.0.1:${port}`;
  const db = new PGlite();
  // The roles, the sign-in tables and Supabase's own defaults, then the migrations.
  await db.exec(readFileSync(new URL("tests/supabase-shim.sql", supabaseDir), "utf8"));
  const migrations = new URL("migrations/", supabaseDir);
  for (const name of readdirSync(migrations).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(readFileSync(new URL(name, migrations), "utf8"));
  }

  const signer = createSigner();
  const state = {
    /** Who the next sign-in is: { discordId, name }. Set it with signInAs(). */
    person: null,
    challenge: null,
    requests: [],
    /** Requests this stand-in refused because it does not understand them. */
    unsupported: [],
  };

  /** The account for a Discord identity, made the way the sign-in service makes one. */
  async function accountFor(person) {
    return db.transaction(async (tx) => {
      await tx.query("set local role supabase_auth_admin");
      const data = JSON.stringify({ provider_id: person.discordId, full_name: person.name });
      const known = await tx.query(
        "select user_id from auth.identities where provider = 'discord' and provider_id = $1",
        [person.discordId],
      );
      if (known.rows.length > 0) {
        await tx.query(
          "update auth.identities set identity_data = $2, last_sign_in_at = now() where provider = 'discord' and provider_id = $1",
          [person.discordId, data],
        );
        return known.rows[0].user_id;
      }
      const made = await tx.query(
        "insert into auth.users (raw_app_meta_data, raw_user_meta_data) values ($1, $2) returning id",
        [JSON.stringify({ provider: "discord", providers: ["discord"] }), data],
      );
      await tx.query(
        "insert into auth.identities (provider_id, user_id, identity_data, provider) values ($1, $2, $3, 'discord')",
        [person.discordId, made.rows[0].id, data],
      );
      return made.rows[0].id;
    });
  }

  function session(userId, name) {
    const now = Math.floor(Date.now() / 1000);
    const user = {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      app_metadata: { provider: "discord", providers: ["discord"] },
      user_metadata: { full_name: name },
      created_at: new Date().toISOString(),
    };
    return {
      access_token: signer.sign({
        iss: `${origin}/auth/v1`,
        sub: userId,
        aud: "authenticated",
        role: "authenticated",
        iat: now,
        exp: now + 3600,
        is_anonymous: false,
        app_metadata: user.app_metadata,
        user_metadata: user.user_metadata,
      }),
      token_type: "bearer",
      expires_in: 3600,
      expires_at: now + 3600,
      refresh_token: `${userId}:${name}`,
      user,
    };
  }

  /** Run one statement as the caller, with the database's access rules applied. */
  function asCaller(request, text, params) {
    const claims = readClaims((request.headers.authorization ?? "").replace(/^Bearer /, ""));
    const role = claims?.sub ? "authenticated" : "anon";
    return db.transaction(async (tx) => {
      await tx.query(`set local role ${role}`);
      await tx.query("select set_config('request.jwt.claims', $1, true)", [
        JSON.stringify(claims?.sub ? { sub: claims.sub, role } : { role }),
      ]);
      return tx.query(text, params);
    });
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const body = await readBody(request);
    state.requests.push(`${request.method} ${url.pathname}`);

    const send = (status, payload, headers = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(payload === undefined ? "" : JSON.stringify(payload));
    };

    try {
      // --- Sign-in service -------------------------------------------------
      if (url.pathname === "/auth/v1/authorize") {
        if (request.method !== "GET") return send(405);
        if (!state.person) return send(500, { msg: "The test did not say who is signing in." });
        state.challenge = { code: url.searchParams.get("code_challenge"), person: state.person };
        const back = new URL(url.searchParams.get("redirect_to"));
        back.searchParams.set("code", "stand-in-code");
        response.writeHead(302, { location: back.toString() });
        return response.end();
      }
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
        const proof = createHash("sha256").update(body.code_verifier ?? "").digest("base64url");
        if (body.auth_code !== "stand-in-code" || !state.challenge || proof !== state.challenge.code) {
          return send(400, { code: 400, error_code: "bad_code_verifier", msg: "The code did not match." });
        }
        const { person } = state.challenge;
        state.challenge = null;
        return send(200, session(await accountFor(person), person.name));
      }
      if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
        const [userId, name] = String(body.refresh_token ?? "").split(":");
        return send(200, session(userId, name));
      }
      if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(200, { keys: [signer.jwk] });
      if (url.pathname === "/auth/v1/logout") return send(204);

      // --- The database ----------------------------------------------------
      if (url.pathname.startsWith("/rest/v1/")) {
        const result = await rest(request, url, body, asCaller);
        return send(result.status, result.body, result.headers);
      }

      send(404, { message: `The stand-in does not answer ${request.method} ${url.pathname}` });
    } catch (error) {
      if (error instanceof Unsupported) {
        state.unsupported.push(`${request.method} ${url.pathname}${url.search}: ${error.message}`);
        return send(501, { code: "STANDIN", message: error.message });
      }
      // A refusal by the database, passed on in the shape Supabase uses.
      if (typeof error.code === "string" && error.code.length === 5) {
        const status = error.code === "42501" ? 403 : error.code.startsWith("23") ? 409 : 400;
        return send(status, { code: error.code, message: error.message, details: error.detail ?? null, hint: error.hint ?? null });
      }
      send(500, { message: String(error.stack ?? error) });
    }
  });

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
  return {
    origin,
    state,
    /** Choose who signs in next, such as { discordId: "7", name: "kit_on_discord" }. */
    signInAs(person) {
      state.person = person;
    },
    /** Run a statement as the database owner, to set a scene or to check a result. */
    async sql(text, params = []) {
      return (await db.query(text, params)).rows;
    },
    async close() {
      server.close();
      await db.close();
    },
  };
}

class Unsupported extends Error {}

const comparisons = { eq: "=", neq: "<>", gt: ">", gte: ">=", lt: "<", lte: "<=" };
const settings = new Set(["select", "order", "limit", "offset", "columns", "on_conflict"]);

function column(name) {
  if (!NAME.test(name)) throw new Unsupported(`The stand-in does not understand the column "${name}".`);
  return name;
}

/** Turn the address's filters into a WHERE clause. */
function where(url, params) {
  const tests = [];
  for (const [key, raw] of url.searchParams) {
    if (settings.has(key)) continue;
    const dot = raw.indexOf(".");
    const operator = raw.slice(0, dot);
    const value = raw.slice(dot + 1);
    if (operator in comparisons) {
      params.push(value);
      tests.push(`${column(key)} ${comparisons[operator]} $${params.length}`);
    } else if (operator === "is" && ["null", "true", "false"].includes(value)) {
      tests.push(`${column(key)} is ${value}`);
    } else if (operator === "in" && value.startsWith("(") && value.endsWith(")")) {
      const list = value.slice(1, -1);
      params.push(list === "" ? [] : list.split(",").map((item) => item.replace(/^"|"$/g, "")));
      tests.push(`${column(key)}::text = any($${params.length}::text[])`);
    } else {
      throw new Unsupported(`The stand-in does not understand the filter ${key}=${raw}.`);
    }
  }
  return tests.length > 0 ? ` where ${tests.join(" and ")}` : "";
}

function columns(url) {
  const wanted = url.searchParams.get("select");
  if (!wanted || wanted === "*") return "*";
  return wanted
    .split(",")
    .map((name) => column(name.trim()))
    .join(", ");
}

function ordering(url) {
  const wanted = url.searchParams.get("order");
  if (!wanted) return "";
  const parts = wanted.split(",").map((part) => {
    const [name, direction = "asc"] = part.split(".");
    if (!["asc", "desc"].includes(direction)) throw new Unsupported(`The stand-in does not understand order=${wanted}.`);
    return `${column(name)} ${direction}`;
  });
  const limit = url.searchParams.get("limit");
  if (limit && !/^\d+$/.test(limit)) throw new Unsupported(`The stand-in does not understand limit=${limit}.`);
  return ` order by ${parts.join(", ")}${limit ? ` limit ${limit}` : ""}`;
}

/** Values go to the database as text and it works out the type, as it does for the real API. */
function asText(value) {
  if (value === null || value === undefined) return null;
  // A list of plain values is a database array, such as {navy,army}.
  if (Array.isArray(value) && value.every((item) => typeof item !== "object")) return `{${value.join(",")}}`;
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

async function rest(request, url, body, asCaller) {
  const table = url.pathname.slice("/rest/v1/".length);
  if (!NAME.test(table)) throw new Unsupported(`The stand-in does not understand ${url.pathname}.`);
  const target = `public.${table}`;
  const prefer = request.headers.prefer ?? "";
  const wantsRows = prefer.includes("return=representation");
  const wantsOne = (request.headers.accept ?? "").includes("vnd.pgrst.object");
  const params = [];

  const answer = (rows, status) => {
    if (!wantsOne) return { status, body: rows };
    if (rows.length === 1) return { status, body: rows[0] };
    return {
      status: 406,
      body: { code: "PGRST116", message: `The result contains ${rows.length} rows`, details: null, hint: null },
    };
  };
  // The database builds the reply itself, so dates and the like read exactly
  // as they do from the real API.
  const collect = async (statement) => {
    const result = await asCaller(
      request,
      `with done as (${statement}) select coalesce(json_agg(done), '[]'::json) as found from done`,
      params,
    );
    return result.rows[0].found;
  };

  if (request.method === "GET") {
    return answer(await collect(`select ${columns(url)} from ${target}${where(url, params)}${ordering(url)}`), 200);
  }

  if (request.method === "POST") {
    if (Array.isArray(body) || prefer.includes("resolution=")) {
      throw new Unsupported("The stand-in inserts one row at a time and does not merge.");
    }
    const names = Object.keys(body).map(column);
    const values = Object.values(body).map((value) => {
      params.push(asText(value));
      return `$${params.length}`;
    });
    const rows = await collect(
      `insert into ${target} (${names.join(", ")}) values (${values.join(", ")}) returning ${columns(url)}`,
    );
    return wantsRows ? answer(rows, 201) : { status: 201 };
  }

  if (request.method === "PATCH") {
    const changes = Object.entries(body).map(([name, value]) => {
      params.push(asText(value));
      return `${column(name)} = $${params.length}`;
    });
    if (changes.length === 0) throw new Unsupported("The stand-in was asked to change nothing.");
    const rows = await collect(
      `update ${target} set ${changes.join(", ")}${where(url, params)} returning ${columns(url)}`,
    );
    return wantsRows ? answer(rows, 200) : { status: 204 };
  }

  if (request.method === "DELETE") {
    const filter = where(url, params);
    if (!filter) throw new Unsupported("The stand-in will not delete a whole table.");
    const rows = await collect(`delete from ${target}${filter} returning ${columns(url)}`);
    return wantsRows ? answer(rows, 200) : { status: 204 };
  }

  throw new Unsupported(`The stand-in does not understand ${request.method} on ${url.pathname}.`);
}

function readBody(request) {
  return new Promise((resolve) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch {
        resolve({});
      }
    });
  });
}
