// Shared test helpers for the Chairside security audit.
//
// These talk to the test Supabase project's Postgres DIRECTLY (postgres.js over
// AUDIT_DATABASE_URL) and impersonate each persona exactly the way PostgREST /
// Supabase does at request time:
//
//     set local role <anon|authenticated>;
//     select set_config('request.jwt.claims', '<json>', true);
//
// auth.uid() reads request.jwt.claims->>'sub', so this reproduces RLS faithfully.
// We use the direct DB path because the project's HTTP API gateway was returning
// PGRST125 on every route during the audit (documented in AUDIT.md).
//
// Every helper runs inside a transaction that is ALWAYS rolled back, so probes
// never mutate shared state unless a test explicitly uses `persist`.

import postgres from "postgres";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

function auditDatabaseUrl(): string {
  // Load AUDIT_DATABASE_URL from .env.audit without importing it into the repo.
  if (process.env.AUDIT_DATABASE_URL) return process.env.AUDIT_DATABASE_URL;
  const envPath = resolve(__dirname, "../../.env.audit");
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith("AUDIT_DATABASE_URL="));
  if (!line) throw new Error("AUDIT_DATABASE_URL not found in .env.audit");
  return line.slice("AUDIT_DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

export const sql = postgres(auditDatabaseUrl(), { max: 1, prepare: false, onnotice: () => {} });

/** Read a var from process.env or .env.audit (for the HTTP client config). */
export function auditEnv(name: string): string {
  if (process.env[name]) return process.env[name]!;
  const envPath = resolve(__dirname, "../../.env.audit");
  const line = readFileSync(envPath, "utf8")
    .split("\n")
    .find((l) => l.startsWith(name + "="));
  if (!line) throw new Error(`${name} not found in .env.audit`);
  return line.slice((name + "=").length).trim().replace(/^["']|["']$/g, "");
}

/** Base Supabase URL with any trailing slash trimmed. */
export function supabaseUrl(): string {
  return auditEnv("AUDIT_SUPABASE_URL").replace(/\/+$/, "");
}

export const PERSONA_LOGINS: Record<string, { email: string; password: string }> = {
  A: { email: "ownera@example.test", password: "Test-Passw0rd!1" },
  A1: { email: "staffa1@example.test", password: "Test-Passw0rd!2" },
  A2: { email: "staffa2@example.test", password: "Test-Passw0rd!3" },
  B: { email: "ownerb@example.test", password: "Test-Passw0rd!4" },
  X: { email: "userx@example.test", password: "Test-Passw0rd!5" },
};

export type Persona = "anon" | "X" | "A" | "A1" | "A2" | "B";

const SUBS: Record<Persona, string | null> = {
  anon: null,
  X: "55555555-5555-5555-5555-555555555555",
  A: "11111111-1111-1111-1111-111111111111",
  A1: "22222222-2222-2222-2222-222222222222",
  A2: "33333333-3333-3333-3333-333333333333",
  B: "44444444-4444-4444-4444-444444444444",
};

function claims(p: Persona): string {
  const sub = SUBS[p];
  return sub
    ? JSON.stringify({ sub, role: "authenticated", email: `${p}@example.test` })
    : JSON.stringify({ role: "anon" });
}

function dbRole(p: Persona): "anon" | "authenticated" {
  return p === "anon" ? "anon" : "authenticated";
}

export type ProbeResult = { ok: boolean; count: number; error?: string; rows?: any[] };

/**
 * Run `fn` as persona `p` inside a rolled-back transaction.
 * Returns the callback's value; the transaction is always rolled back.
 */
export async function asPersona<T>(p: Persona, fn: (t: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const ROLLBACK = Symbol("rollback");
  let captured: T;
  try {
    await sql.begin(async (t) => {
      await t.unsafe(`set local role ${dbRole(p)}`);
      await t.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claims(p)]);
      captured = await fn(t);
      throw ROLLBACK; // force rollback so probes never persist
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return captured!;
}

/** Run a single statement as persona, rolled back, capturing allow/deny + rowcount. */
export async function probe(p: Persona, query: string, params: any[] = []): Promise<ProbeResult> {
  try {
    return await asPersona(p, async (t) => {
      const res = await t.unsafe(query, params);
      return { ok: true, count: res.count ?? res.length ?? 0, rows: [...res] };
    });
  } catch (e: any) {
    return { ok: false, count: 0, error: shortErr(e) };
  }
}

/** Call an RPC as persona. By default rolled back; pass {persist:true} to commit. */
export async function rpc(
  p: Persona,
  name: string,
  args: Record<string, unknown>,
  opts: { persist?: boolean } = {},
): Promise<ProbeResult> {
  const keys = Object.keys(args);
  const argSql = keys.map((k, i) => `${k} => $${i + 1}`).join(", ");
  const params = keys.map((k) => args[k]);
  const stmt = `select public.${name}(${argSql}) as result`;
  if (opts.persist) {
    try {
      let out: ProbeResult = { ok: true, count: 0 };
      await sql.begin(async (t) => {
        await t.unsafe(`set local role ${dbRole(p)}`);
        await t.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claims(p)]);
        const res = await t.unsafe(stmt, params);
        out = { ok: true, count: 1, rows: [...res] };
      });
      return out;
    } catch (e: any) {
      return { ok: false, count: 0, error: shortErr(e) };
    }
  }
  return probe(p, stmt, params);
}

/** Switch the current transaction to act as persona `p`. */
export async function act(t: postgres.TransactionSql, p: Persona): Promise<void> {
  await t.unsafe(`reset role`);
  await t.unsafe(`set local role ${dbRole(p)}`);
  await t.unsafe(`select set_config('request.jwt.claims', $1, true)`, [claims(p)]);
}

/** Run a multi-step scenario in one transaction that is ALWAYS rolled back. */
export async function rolledBack<T>(fn: (t: postgres.TransactionSql) => Promise<T>): Promise<T> {
  const ROLLBACK = Symbol("rollback");
  let captured: T;
  try {
    await sql.begin(async (t) => {
      captured = await fn(t);
      throw ROLLBACK;
    });
  } catch (e) {
    if (e !== ROLLBACK) throw e;
  }
  return captured!;
}

export function shortErr(e: any): string {
  const msg = (e?.message ?? String(e)).split("\n")[0];
  const code = e?.code ? ` [${e.code}]` : "";
  return msg + code;
}

/** Fixture ids, loaded privileged (RLS bypassed as the superuser connection). */
export async function fixtureIds() {
  const [a] = await sql`select id from public.salons where slug='salon-a'`;
  const [b] = await sql`select id from public.salons where slug='salon-b'`;
  const svcA = await sql`select id,name from public.services where salon_id=${a.id}`;
  const svcB = await sql`select id,name from public.services where salon_id=${b.id}`;
  const staffA = await sql`select id,name,role from public.staff where salon_id=${a.id} order by role`;
  const staffB = await sql`select id,name,role from public.staff where salon_id=${b.id} order by role`;
  const custB = await sql`select id,phone from public.customers where salon_id=${b.id} limit 1`;
  const custA = await sql`select id from public.customers where salon_id=${a.id} and phone='+905551110000' limit 1`;
  return {
    salonA: a.id as string,
    salonB: b.id as string,
    serviceA: svcA[0].id as string,
    serviceB: svcB[0].id as string,
    ownerStaffA: (staffA.find((s) => s.role === "owner") ?? staffA[0]).id as string,
    staffA1: staffA.find((s) => s.name === "Stylist A1")?.id as string,
    ownerStaffB: (staffB.find((s) => s.role === "owner") ?? staffB[0]).id as string,
    customerB: custB[0]?.id as string,
    customerBPhone: custB[0]?.phone as string,
    customerA: custA[0]?.id as string,
  };
}
