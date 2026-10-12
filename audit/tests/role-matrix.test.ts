// Access-control role matrix, built from REAL calls against the test project.
//
// For every (table, operation, persona) we attempt the operation as that persona
// inside a rolled-back transaction and record the outcome:
//   ✓N   allowed, N rows affected/visible
//   ·0   no error but 0 rows (RLS filtered it out -> effectively denied)
//   ✗    rejected (RLS WITH CHECK / permission error)
//
// The table targets are Salon A's rows. Personas: anon, X (no salon),
// A (owner A), A1/A2 (staff A), B (owner of the OTHER salon).
//
// The matrix is written to audit/rol-matrisi.md. Security-critical expectations
// are also asserted below; a FAILING assertion is a confirmed finding.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sql, rolledBack, act, fixtureIds, type Persona } from "./_db";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PERSONAS: Persona[] = ["anon", "X", "A", "A1", "A2", "B"];
const PERSONA_LABEL: Record<Persona, string> = {
  anon: "anon (visitor)",
  X: "X (no salon)",
  A: "A (owner A)",
  A1: "A1 (staff A)",
  A2: "A2 (staff A)",
  B: "B (owner B)",
};

let ids: Awaited<ReturnType<typeof fixtureIds>>;
let aNoteId: string;

type Cell = string;
const matrix: Record<string, Record<string, Record<Persona, Cell>>> = {};

async function selCount(p: Persona, q: string, params: any[]): Promise<Cell> {
  try {
    const n = await rolledBack(async (t) => {
      await act(t, p);
      const r = await t.unsafe(q, params);
      return r.length;
    });
    return n > 0 ? `✓${n}` : `·0`;
  } catch (e: any) {
    return `✗`;
  }
}

async function writeOp(p: Persona, q: string, params: any[]): Promise<Cell> {
  try {
    return await rolledBack(async (t) => {
      await act(t, p);
      const r = await t.unsafe(q, params);
      const n = r.count ?? 0;
      return n > 0 ? `✓${n}` : `·0`;
    });
  } catch (e: any) {
    return `✗`;
  }
}

async function cellSet(table: string, op: string, fn: (p: Persona) => Promise<Cell>) {
  matrix[table] ??= {};
  matrix[table][op] ??= {} as Record<Persona, Cell>;
  for (const p of PERSONAS) matrix[table][op][p] = await fn(p);
}

beforeAll(async () => {
  ids = await fixtureIds();
  const [n] = await sql`select id from public.customer_notes where salon_id=${ids.salonA} limit 1`;
  aNoteId = n.id;

  // salons
  await cellSet("salons", "select(A)", (p) => selCount(p, `select 1 from public.salons where id=$1`, [ids.salonA]));
  await cellSet("salons", "update(A)", (p) => writeOp(p, `update public.salons set address='x' where id=$1`, [ids.salonA]));
  await cellSet("salons", "delete(A)", (p) => writeOp(p, `delete from public.salons where id=$1`, [ids.salonA]));

  // staff
  await cellSet("staff", "select(A)", (p) => selCount(p, `select 1 from public.staff where salon_id=$1`, [ids.salonA]));
  await cellSet("staff", "insert(A)", (p) => writeOp(p, `insert into public.staff(salon_id,name,role) values ($1,'Mallory','staff')`, [ids.salonA]));
  await cellSet("staff", "update(A)", (p) => writeOp(p, `update public.staff set name='x' where salon_id=$1`, [ids.salonA]));
  await cellSet("staff", "delete(A)", (p) => writeOp(p, `delete from public.staff where salon_id=$1 and role='staff'`, [ids.salonA]));

  // services
  await cellSet("services", "select(A)", (p) => selCount(p, `select 1 from public.services where salon_id=$1`, [ids.salonA]));
  await cellSet("services", "insert(A)", (p) => writeOp(p, `insert into public.services(salon_id,name,price,duration_min) values ($1,'Evil',0,30)`, [ids.salonA]));
  await cellSet("services", "update(A)", (p) => writeOp(p, `update public.services set price=1 where salon_id=$1`, [ids.salonA]));
  await cellSet("services", "delete(A)", (p) => writeOp(p, `delete from public.services where salon_id=$1`, [ids.salonA]));

  // customers
  await cellSet("customers", "select(A)", (p) => selCount(p, `select 1 from public.customers where salon_id=$1`, [ids.salonA]));
  await cellSet("customers", "insert(A)", (p) => writeOp(p, `insert into public.customers(salon_id,name,phone) values ($1,'Mallory','+900000')`, [ids.salonA]));
  await cellSet("customers", "update(A)", (p) => writeOp(p, `update public.customers set name='x' where salon_id=$1`, [ids.salonA]));
  await cellSet("customers", "delete(A)", (p) => writeOp(p, `delete from public.customers where salon_id=$1`, [ids.salonA]));

  // bookings
  await cellSet("bookings", "select(A)", (p) => selCount(p, `select 1 from public.bookings where salon_id=$1`, [ids.salonA]));
  await cellSet("bookings", "update(A)", (p) => writeOp(p, `update public.bookings set status='cancelled' where salon_id=$1`, [ids.salonA]));
  await cellSet("bookings", "delete(A)", (p) => writeOp(p, `delete from public.bookings where salon_id=$1`, [ids.salonA]));

  // customer_notes
  await cellSet("customer_notes", "select(A)", (p) => selCount(p, `select 1 from public.customer_notes where salon_id=$1`, [ids.salonA]));
  await cellSet("customer_notes", "update(A)", (p) => writeOp(p, `update public.customer_notes set body='x' where id=$1`, [aNoteId]));
  await cellSet("customer_notes", "delete(A)", (p) => writeOp(p, `delete from public.customer_notes where id=$1`, [aNoteId]));

  // render markdown
  let md = `# Rol matrisi - Salon A verisine erişim (test projesinde gerçek çağrılarla)\n\n`;
  md += `Hedef satırlar **Salon A**'ya ait. Personalar: anon (ziyaretçi), X (hiçbir salona üye değil, kayıtlı), A (A sahibi), A1/A2 (A personeli), B (DİĞER salonun sahibi).\n\n`;
  md += `Gösterim: \`✓N\` izin var (N satır etkilendi/görüldü) · \`·0\` hata yok ama 0 satır (RLS süzdü = fiilen engel) · \`✗\` reddedildi.\n\n`;
  for (const table of Object.keys(matrix)) {
    md += `### \`${table}\`\n\n`;
    md += `| İşlem | ${PERSONAS.map((p) => PERSONA_LABEL[p]).join(" | ")} |\n`;
    md += `|---|${PERSONAS.map(() => "---").join("|")}|\n`;
    for (const op of Object.keys(matrix[table])) {
      md += `| ${op} | ${PERSONAS.map((p) => matrix[table][op][p]).join(" | ")} |\n`;
    }
    md += `\n`;
  }
  md += `\n_Not: \`select(A)\` anonim için tabloya DOĞRUDAN erişimdir; herkese açık okuma yalnızca \`get_public_salon\`/\`get_busy_times\` RPC'leriyle olur (ayrı test)._\n`;
  writeFileSync(resolve(__dirname, "../rol-matrisi.md"), md);
});

afterAll(async () => {
  await sql.end();
});

describe("SEC - access control role matrix (assertions)", () => {
  it("anon cannot read any base table directly (must go through public RPCs)", () => {
    // After Item 11, anon has no table privileges at all -> hard deny ("✗");
    // before that it was RLS-filtered ("·0"). Either way: no rows visible.
    for (const table of ["salons", "staff", "services", "customers", "bookings", "customer_notes"]) {
      expect(matrix[table]["select(A)"].anon, `${table}`).not.toMatch(/✓/);
    }
  });

  it("X (registered, no salon) cannot read Salon A data", () => {
    for (const table of ["customers", "bookings", "customer_notes"]) {
      expect(matrix[table]["select(A)"].X, `${table}`).toBe("·0");
    }
  });

  it("B (other salon owner) cannot read Salon A data - tenant isolation", () => {
    for (const table of ["staff", "services", "customers", "bookings", "customer_notes"]) {
      expect(matrix[table]["select(A)"].B, `${table}`).toBe("·0");
    }
  });

  it("B (other salon owner) cannot write/delete Salon A data - tenant isolation", () => {
    expect(matrix["customers"]["update(A)"].B).not.toMatch(/✓/);
    expect(matrix["customers"]["delete(A)"].B).not.toMatch(/✓/);
    expect(matrix["bookings"]["update(A)"].B).not.toMatch(/✓/);
    expect(matrix["services"]["insert(A)"].B).toBe("✗");
  });

  it("[#3] staff (A1) should NOT be able to DELETE customers (over-permission vs 'see their own calendar')", () => {
    // SECURE expectation: deleting customers is not a stylist action.
    expect(matrix["customers"]["delete(A)"].A1, "staff deleted salon customers").not.toMatch(/✓/);
  });

  it("[#3] staff (A1) should NOT be able to edit customers", () => {
    expect(matrix["customers"]["update(A)"].A1, "staff edited salon customers").not.toMatch(/✓/);
  });

  it("DEFENSE: staff (A1) cannot modify bookings (owner-only) or settings", () => {
    expect(matrix["bookings"]["update(A)"].A1).not.toMatch(/✓/);
    expect(matrix["bookings"]["delete(A)"].A1).not.toMatch(/✓/);
    expect(matrix["services"]["insert(A)"].A1).toBe("✗");
    expect(matrix["staff"]["insert(A)"].A1).toBe("✗");
  });
});
