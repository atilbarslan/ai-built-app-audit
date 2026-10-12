// End-to-end over the REAL HTTP path (supabase-js -> PostgREST/GoTrue), using the
// corrected AUDIT_SUPABASE_URL. This confirms the DB-layer findings also hold
// through the stack the browser actually uses, and that tenant isolation holds
// for a signed-in persona.
//
// Red assertions = confirmed findings; green = confirmed defenses.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sql, supabaseUrl, auditEnv, PERSONA_LOGINS, fixtureIds, validSlotUtc } from "./_db";

const URL = supabaseUrl();
const ANON = auditEnv("AUDIT_SUPABASE_PUBLISHABLE_KEY");

function anonClient(): SupabaseClient {
  return createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function signedInClient(p: keyof typeof PERSONA_LOGINS): Promise<SupabaseClient> {
  const c = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await c.auth.signInWithPassword(PERSONA_LOGINS[p]);
  if (error) throw new Error(`sign-in ${p}: ${error.message}`);
  return c;
}

let ids: Awaited<ReturnType<typeof fixtureIds>>;
const TEST_PHONE = "+905557654321";

beforeAll(async () => {
  ids = await fixtureIds();
  // a known existing customer in Salon A for the overwrite scenario
  await sql`delete from public.customers where salon_id=${ids.salonA} and phone=${TEST_PHONE}`;
  await sql`insert into public.customers(salon_id,name,phone,email) values (${ids.salonA},'HTTP Real',${TEST_PHONE},'httpreal@example.test')`;
});
afterAll(async () => {
  await sql`delete from public.customers where salon_id=${ids.salonA} and phone=${TEST_PHONE}`;
  await sql.end();
});

describe("E2E over HTTP (supabase-js)", () => {
  it("DEFENSE: anonymous can load the public salon and place a booking (happy path works)", async () => {
    const c = anonClient();
    const { data: pub, error } = await c.rpc("get_public_salon", { _slug: "salon-a" });
    expect(error).toBeNull();
    expect((pub as any).salon.name).toBe("Salon A");
    const svc = (pub as any).services[0];
    const staff = (pub as any).staff[0];
    const starts = validSlotUtc(10).toISOString();
    const { data: bid, error: bErr } = await c.rpc("create_public_booking", {
      _salon: (pub as any).salon.id, _service: svc.id, _staff: staff.id,
      _starts: starts, _name: "Walk In", _phone: "+905550009999", _email: "",
    });
    expect(bErr).toBeNull();
    expect(bid).toBeTruthy();
    await sql`delete from public.bookings where id=${bid as string}`;
    await sql`delete from public.customers where salon_id=${ids.salonA} and phone='+905550009999'`;
  });

  it("[#1] over HTTP: anon overwrites an existing customer's name/email via phone collision", async () => {
    const c = anonClient();
    const { data: pub } = await c.rpc("get_public_salon", { _slug: "salon-a" });
    const svc = (pub as any).services[0];
    const staff = (pub as any).staff[0];
    const { data: bid, error } = await c.rpc("create_public_booking", {
      _salon: (pub as any).salon.id, _service: svc.id, _staff: staff.id,
      _starts: validSlotUtc(11).toISOString(),
      _name: "HTTP HACKED", _phone: TEST_PHONE, _email: "http-attacker@evil.test",
    });
    expect(error).toBeNull();
    const [row] = await sql`select name,email from public.customers where salon_id=${ids.salonA} and phone=${TEST_PHONE}`;
    if (bid) await sql`delete from public.bookings where id=${bid as string}`;
    // SECURE expectation: existing customer identity unchanged.
    expect(row.name).toBe("HTTP Real");
    expect(row.email).toBe("httpreal@example.test");
  });

  it("DEFENSE: signed-in owner A sees only Salon A bookings; owner B sees none of A's customers", async () => {
    const a = await signedInClient("A");
    const { data: aBookings, error: aErr } = await a.from("bookings").select("id,salon_id");
    expect(aErr).toBeNull();
    expect(aBookings!.length).toBeGreaterThan(0);
    expect(aBookings!.every((b: any) => b.salon_id === ids.salonA)).toBe(true);

    const b = await signedInClient("B");
    const { data: bSeesACustomers } = await b.from("customers").select("id").eq("salon_id", ids.salonA);
    // tenant isolation: B cannot read Salon A customers
    expect(bSeesACustomers ?? []).toHaveLength(0);
  });

  it("[#3] over HTTP: staff A1 can edit a Salon A customer (over-permission)", async () => {
    const a1 = await signedInClient("A1");
    const { error } = await a1.from("customers").update({ name: "EDITED BY STAFF" }).eq("id", ids.customerA ?? "");
    // SECURE expectation: a stylist cannot edit customer records -> expect an RLS block (no rows / error).
    const [row] = await sql`select name from public.customers where id=${ids.customerA}`;
    // restore
    await sql`update public.customers set name='Salon A Customer' where id=${ids.customerA}`;
    expect(error === null && row.name === "EDITED BY STAFF", "staff edited a customer over HTTP").toBe(false);
  });
});
