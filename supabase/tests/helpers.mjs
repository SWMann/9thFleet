// Test helpers: an in-memory PostgreSQL with the migrations applied, and ways
// to act as each kind of user the way the Supabase API would.

import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "migrations");

export function migrationFiles() {
  return readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
}

/** A fresh database with the Supabase stand-ins and every migration applied. */
export async function newFleet() {
  const db = new PGlite();
  await db.exec(readFileSync(join(here, "supabase-shim.sql"), "utf8"));
  for (const name of migrationFiles()) {
    try {
      await db.exec(readFileSync(join(migrationsDir, name), "utf8"));
    } catch (error) {
      error.message = `${name}: ${error.message}`;
      throw error;
    }
  }
  return new Fleet(db);
}

export class Fleet {
  constructor(db) {
    this.db = db;
  }

  /** Run as the database owner, the way the SQL editor does. */
  sql(text, params = []) {
    return this.db.query(text, params);
  }

  async rows(text, params = []) {
    return (await this.db.query(text, params)).rows;
  }

  async one(text, params = []) {
    return (await this.db.query(text, params)).rows[0];
  }

  /** Run one statement as a signed-in user, with the access rules applied. */
  as(userId) {
    return new Actor(this.db, "authenticated", userId);
  }

  /** Run one statement as a visitor who is not signed in. */
  visitor() {
    return new Actor(this.db, "anon", null);
  }

  /**
   * Sign in with Discord for the first time, the way Supabase's sign-in
   * service does it: a user row, then an identity row, as its own role.
   */
  async signIn(discordId, name, { provider = "discord", userData } = {}) {
    return this.db.transaction(async (tx) => {
      await tx.query("set local role supabase_auth_admin");
      const data = userData ?? { provider_id: discordId, sub: discordId, full_name: name };
      const user = await tx.query(
        `insert into auth.users (raw_app_meta_data, raw_user_meta_data)
         values ($1, $2) returning id`,
        [JSON.stringify({ provider, providers: [provider] }), JSON.stringify(data)],
      );
      const id = user.rows[0].id;
      await tx.query(
        `insert into auth.identities (provider_id, user_id, identity_data, provider)
         values ($1, $2, $3, $4)`,
        [provider === "discord" ? discordId : id, id, JSON.stringify(data), provider],
      );
      return id;
    });
  }

  /** Someone who has signed in and filled in their names, ready to apply. */
  async applicant(discordId, name) {
    const id = await this.signIn(discordId, name);
    await this.as(id).query(
      "update public.members set character_name = $2, rsi_handle = $3 where id = $1",
      [id, name, name.replace(/\s+/g, "_")],
    );
    return id;
  }

  /** A signed-in person moved straight to a status, for setting up a test. */
  async person(discordId, name, { status = "member", service = "navy", roles = [] } = {}) {
    const id = await this.signIn(discordId, name);
    await this.sql(
      "update public.members set status = $2, service = $3, character_name = $4 where id = $1",
      [id, status, status === "applicant" ? null : service, name],
    );
    for (const role of roles) {
      await this.sql("insert into public.member_roles (member_id, role) values ($1, $2)", [id, role]);
    }
    return id;
  }

  async positionId(unit, title) {
    const row = await this.one(
      `select p.id from public.positions p
       join public.units u on u.id = p.unit_id
       where u.name = $1 and p.title = $2`,
      [unit, title],
    );
    if (!row) throw new Error(`No position "${title}" in "${unit}"`);
    return row.id;
  }

  /** Award qualifications directly, for setting up a test. */
  async qualify(memberId, ...codes) {
    for (const code of codes) {
      await this.sql(
        `insert into public.qualification_awards (member_id, qualification_id)
         select $1, id from public.qualifications where code = $2`,
        [memberId, code],
      );
    }
  }

  setStage(stage) {
    return this.sql("update public.fleet_settings set current_stage = $1", [stage]);
  }

  openRecruitment(open = true) {
    return this.sql("update public.fleet_settings set recruitment_open = $1", [open]);
  }

  /** A member's line on the roster, read as the database owner. */
  rosterLine(memberId) {
    return this.one("select * from public.roster where member_id = $1", [memberId]);
  }

  close() {
    return this.db.close();
  }
}

class Actor {
  constructor(db, role, userId) {
    this.db = db;
    this.role = role;
    this.userId = userId;
  }

  query(text, params = []) {
    return this.db.transaction(async (tx) => {
      await tx.query(`set local role ${this.role}`);
      const claims = this.userId ? { sub: this.userId, role: this.role } : { role: this.role };
      await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(claims)]);
      return tx.query(text, params);
    });
  }

  async rows(text, params = []) {
    return (await this.query(text, params)).rows;
  }

  async one(text, params = []) {
    return (await this.query(text, params)).rows[0];
  }

  /** How many rows a statement changed. The rules hide rows instead of raising. */
  async changed(text, params = []) {
    return (await this.query(text, params)).affectedRows ?? 0;
  }
}
