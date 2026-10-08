// A stand-in for Supabase, for the sign-in test only.
//
// It answers the handful of requests the site makes: the Discord hand-off, the
// code exchange, the keys that prove a session is genuine, and the member's own
// rows. It holds one member in memory. It is never part of the running site.

import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createSigner } from "./tokens.mjs";

// The units, posts and ranks exactly as the database migrations create them.
// To refresh it, dump those tables from a database built from supabase/migrations.
const orderOfBattle = JSON.parse(readFileSync(new URL("./fixtures/order-of-battle.json", import.meta.url), "utf8"));
const SERVING = ["recruit", "auxiliary", "member", "reserve"];

const signer = createSigner();
const jwk = signer.jwk;
const signToken = (claims) => signer.sign(claims);

export function startMockSupabase(port) {
  const origin = `http://127.0.0.1:${port}`;
  const state = {
    userId: randomUUID(),
    member: null,
    roles: [],
    recruitmentOpen: false,
    challenge: null,
    holdAtDiscord: false,
    stage: 1,
    // Other members of the fleet, as rows of the roster, and who holds which duty.
    crew: [],
    duties: [],
    nextLifetime: 3600,
    refreshes: 0,
    signOuts: 0,
    requests: [],
    // What the site wrote to the logs: page views counted, and lines of activity.
    views: [],
    activity: [],
  };
  resetMember(state);

  function session() {
    const now = Math.floor(Date.now() / 1000);
    const lifetime = state.nextLifetime;
    state.nextLifetime = 3600;
    const user = {
      id: state.userId,
      aud: "authenticated",
      role: "authenticated",
      email: "ada@example.org",
      app_metadata: { provider: "discord", providers: ["discord"] },
      user_metadata: { full_name: "ada_on_discord" },
      created_at: new Date().toISOString(),
    };
    const access_token = signToken({
      iss: `${origin}/auth/v1`,
      sub: state.userId,
      aud: "authenticated",
      role: "authenticated",
      email: user.email,
      iat: now,
      exp: now + lifetime,
      session_id: randomUUID(),
      is_anonymous: false,
      app_metadata: user.app_metadata,
      user_metadata: user.user_metadata,
    });
    return {
      access_token,
      token_type: "bearer",
      expires_in: lifetime,
      expires_at: now + lifetime,
      refresh_token: randomUUID(),
      user,
    };
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, origin);
    const body = await readBody(request);
    state.requests.push(`${request.method} ${url.pathname}`);

    const send = (status, payload, headers = {}) => {
      response.writeHead(status, { "content-type": "application/json", ...headers });
      response.end(payload === undefined ? "" : JSON.stringify(payload));
    };
    const signedIn = () => (request.headers.authorization ?? "").split(".").length === 3;
    const wantsOne = () => (request.headers.accept ?? "").includes("vnd.pgrst.object");
    const rows = (list) => {
      if (!wantsOne()) return send(200, list);
      if (list.length === 1) return send(200, list[0]);
      return send(406, { code: "PGRST116", message: "The result contains 0 rows", details: null, hint: null });
    };

    // --- Sign-in service ---------------------------------------------------
    if (url.pathname === "/auth/v1/authorize") {
      // Like the real service, this only answers a browser arriving with GET.
      if (request.method !== "GET") {
        response.writeHead(405);
        return response.end();
      }
      state.challenge = url.searchParams.get("code_challenge");
      const back = new URL(url.searchParams.get("redirect_to"));
      back.searchParams.set("code", "mock-code");
      if (state.holdAtDiscord) {
        // Stop where Discord's own page would be, so the test can press Back.
        response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        return response.end(`<!doctype html><title>Discord stand-in</title><h1>Discord stand-in</h1><a href="${back}">Authorise</a>`);
      }
      response.writeHead(302, { location: back.toString() });
      return response.end();
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "pkce") {
      const proof = createHash("sha256").update(body.code_verifier ?? "").digest("base64url");
      if (body.auth_code !== "mock-code" || proof !== state.challenge) {
        return send(400, { code: 400, error_code: "bad_code_verifier", msg: "The code did not match." });
      }
      return send(200, session());
    }
    if (url.pathname === "/auth/v1/token" && url.searchParams.get("grant_type") === "refresh_token") {
      state.refreshes += 1;
      return send(200, session());
    }
    if (url.pathname === "/auth/v1/.well-known/jwks.json") return send(200, { keys: [jwk] });
    if (url.pathname === "/auth/v1/user") return signedIn() ? send(200, session().user) : send(401, { msg: "No session" });
    if (url.pathname === "/auth/v1/logout") {
      state.signOuts += 1;
      response.writeHead(204);
      return response.end();
    }

    // --- The logs ----------------------------------------------------------
    // A visitor may count a page view. Only someone signed in writes a line of activity.
    if (url.pathname === "/rest/v1/page_view_ticks" && request.method === "POST") {
      state.views.push(body);
      return send(201);
    }
    if (url.pathname === "/rest/v1/activity_log" && request.method === "POST" && signedIn()) {
      state.activity.push(body);
      return send(201);
    }

    // --- The member's own rows ---------------------------------------------
    if (url.pathname.startsWith("/rest/v1/") && !signedIn()) {
      return send(401, { code: "42501", message: "permission denied" });
    }
    // Like the database's own rules: you always see yourself, and the serving
    // fleet and its order of battle only once you serve in it.
    const serving = Boolean(state.member) && SERVING.includes(state.member.status);
    if (url.pathname === "/rest/v1/roster") {
      if (!state.member) return rows([]);
      if (url.searchParams.has("member_id") || !serving) return rows([state.member]);
      return rows([state.member, ...state.crew]);
    }
    if (url.pathname === "/rest/v1/ranks") return send(200, orderOfBattle.ranks);
    for (const table of ["units", "positions", "position_qualifications", "qualifications"]) {
      if (url.pathname === `/rest/v1/${table}`) return send(200, serving ? orderOfBattle[table] : []);
    }
    if (url.pathname === "/rest/v1/assignments") return send(200, serving ? state.duties : []);
    // What a member has earned, on their record. This member has earned nothing yet.
    for (const table of ["qualification_awards", "qualifications", "event_mentions"]) {
      if (url.pathname === `/rest/v1/${table}` && request.method === "GET") return send(200, []);
    }
    if (url.pathname === "/rest/v1/member_accounts") {
      return rows(state.member ? [{ discord_name: "ada_on_discord" }] : []);
    }
    if (url.pathname === "/rest/v1/member_roles") return send(200, state.roles.map((role) => ({ role })));
    if (url.pathname === "/rest/v1/fleet_settings") {
      return rows([{ recruitment_open: state.recruitmentOpen, current_stage: state.stage }]);
    }
    if (url.pathname === "/rest/v1/members" && request.method === "PATCH") {
      if (!state.member) return send(200, []);
      if (body.character_name === "Taken Name") {
        return send(409, {
          code: "23505",
          message: 'duplicate key value violates unique constraint "members_character_name_key"',
        });
      }
      const renaming = "character_name" in body && body.character_name !== state.member.character_name;
      if (renaming && state.member.status !== "applicant" && state.member.character_name !== null) {
        return send(403, {
          code: "42501",
          message: "A character name is fixed once you have joined. Ask staff to change it.",
        });
      }
      Object.assign(state.member, body);
      return send(200, [{ id: state.userId }]);
    }

    // --- Test controls -----------------------------------------------------
    if (url.pathname === "/__mock/set" && request.method === "POST") {
      if (body.member === null) state.member = null;
      else if (body.member) Object.assign(state.member ?? resetMember(state), body.member);
      if (body.roles) state.roles = body.roles;
      if (typeof body.nextLifetime === "number") state.nextLifetime = body.nextLifetime;
      if (typeof body.recruitmentOpen === "boolean") state.recruitmentOpen = body.recruitmentOpen;
      if (typeof body.holdAtDiscord === "boolean") state.holdAtDiscord = body.holdAtDiscord;
      if (typeof body.stage === "number") state.stage = body.stage;
      if (body.crew) state.crew = body.crew;
      if (body.duties) state.duties = body.duties;
      return send(200, { ok: true });
    }

    send(404, { message: `The stand-in does not answer ${request.method} ${url.pathname}` });
  });

  return new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve({ origin, state, orderOfBattle, close: () => server.close() }));
  });
}

function resetMember(state) {
  state.member = {
    member_id: state.userId,
    character_name: null,
    rsi_handle: null,
    service: null,
    status: "applicant",
    grade_code: null,
    rank_name: null,
    acting: null,
    position_id: null,
    position_title: null,
    unit_name: null,
  };
  return state.member;
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
