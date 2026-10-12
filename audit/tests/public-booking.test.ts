// Public booking RPC abuse (anonymous visitor).
//
// Each `it` asserts the SECURE expectation. A FAILING test here is a confirmed
// finding: the server (create_public_booking) does not enforce the rule, so an
// attacker bypassing the browser UI can do what the test describes.
//
// Scenarios run inside rolled-back transactions and do not persist.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, rolledBack, act, fixtureIds, shortErr } from "./_db";

let ids: Awaited<ReturnType<typeof fixtureIds>>;
beforeAll(async () => {
  ids = await fixtureIds();
});
afterAll(async () => {
  await sql.end();
});

const book = (
  t: any,
  o: { salon: string; service: string; staff: string; starts: string; name?: string; phone?: string; email?: string },
) =>
  t.unsafe(
    `select public.create_public_booking($1,$2,$3,$4,$5,$6,$7) as id`,
    [o.salon, o.service, o.staff, o.starts, o.name ?? "Walk In", o.phone ?? "+905550000000", o.email ?? ""],
  );

describe("SEC/BH - public booking RPC (anonymous)", () => {
  it("[#1] anon must NOT be able to overwrite an existing customer's name/email via a phone collision", async () => {
    const result = await rolledBack(async (t) => {
      // owner A creates a real customer
      await act(t, "A");
      await t.unsafe(
        `insert into public.customers(salon_id,name,phone,email) values ($1,'Real Customer','+905551112233','real@example.test')`,
        [ids.salonA],
      );
      // anonymous visitor books with the same phone, attacker-controlled identity
      await act(t, "anon");
      await book(t, {
        salon: ids.salonA,
        service: ids.serviceA,
        staff: ids.staffA1, // A1 has no seed booking -> collision-free slot
        starts: new Date(Date.now() + 100 * 864e5).toISOString(),
        name: "HACKED NAME",
        phone: "+905551112233",
        email: "attacker@evil.test",
      });
      await act(t, "A"); // read back as owner (anon cannot read customers)
      const [row] = await t.unsafe(
        `select name,email from public.customers where salon_id=$1 and phone='+905551112233'`,
        [ids.salonA],
      );
      return row;
    });
    // SECURE expectation: the existing customer's identity is untouched.
    expect(result.name).toBe("Real Customer");
    expect(result.email).toBe("real@example.test");
  });

  it("[#2] anon must NOT be able to book at 03:00 (outside the salon's open hours)", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      // salon A hours default 09:00–19:00; 03:00 is closed
      const start = new Date();
      start.setUTCDate(start.getUTCDate() + 3);
      start.setUTCHours(0, 0, 0, 0); // 00:00Z == 03:00 Istanbul, before opening
      try {
        await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.ownerStaffA, starts: start.toISOString(), phone: "+905550000031" });
        return { booked: true };
      } catch (e) {
        return { booked: false, error: shortErr(e) };
      }
    });
    // SECURE expectation: rejected as outside opening hours.
    expect(res.booked, `booking at 03:00 was accepted (no server-side hours check)`).toBe(false);
  });

  it("[#2] anon must NOT be able to book years in the future (beyond the 21-day window)", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      try {
        await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.ownerStaffA, starts: "2099-01-01T12:00:00+03:00", phone: "+905550000032" });
        return { booked: true };
      } catch (e) {
        return { booked: false, error: shortErr(e) };
      }
    });
    expect(res.booked, "booking in year 2099 was accepted (no future-window cap)").toBe(false);
  });

  it("[#2] anon must NOT be able to book on a closed day", async () => {
    const res = await rolledBack(async (t) => {
      // close salon A on Sundays only would need config; instead set open_days to Mon only and try a non-Mon
      await act(t, "A");
      await t.unsafe(`update public.salons set open_days='{1}' where id=$1`, [ids.salonA]); // Mondays only
      await act(t, "anon");
      // find the next Tuesday at noon Istanbul
      const d = new Date();
      d.setUTCHours(9, 0, 0, 0);
      do {
        d.setUTCDate(d.getUTCDate() + 1);
      } while (d.getUTCDay() !== 2); // Tuesday
      try {
        await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.ownerStaffA, starts: d.toISOString(), phone: "+905550000033" });
        return { booked: true };
      } catch (e) {
        return { booked: false, error: shortErr(e) };
      }
    });
    expect(res.booked, "booking on a closed day was accepted (open_days not enforced server-side)").toBe(false);
  });

  it("[#2/#7] anon must be rate-limited when flooding bookings (DoS)", async () => {
    const created = await rolledBack(async (t) => {
      await act(t, "anon");
      let n = 0;
      // 60 distinct future slots, all should-be-blocked by some quota
      const base = new Date(Date.now() + 5 * 864e5);
      base.setUTCHours(9, 0, 0, 0);
      for (let i = 0; i < 60; i++) {
        const s = new Date(base.getTime() + i * 30 * 60000);
        try {
          await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.ownerStaffA, starts: s.toISOString(), name: `Flood ${i}`, phone: `+90555${String(1000000 + i)}` });
          n++;
        } catch {
          /* stop counting on first rejection */
        }
      }
      return n;
    });
    // SECURE expectation: some quota stops a single anon well before 60 bookings.
    expect(created, `anon created ${created}/60 bookings with no rate limit`).toBeLessThan(60);
  });

  it("[#2] create_public_booking must bound the customer name length", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      const huge = "A".repeat(20000);
      await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.ownerStaffA, starts: new Date(Date.now() + 6 * 864e5).toISOString(), name: huge, phone: "+905550000034" });
      await act(t, "A"); // read back as the owner (anon cannot read customers - a good defense)
      const [row] = await t.unsafe(`select length(name) as len from public.customers where salon_id=$1 and phone='+905550000034'`, [ids.salonA]);
      return (row?.len ?? 0) as number;
    });
    expect(res, "20k-char customer name stored unbounded").toBeLessThanOrEqual(200);
  });

  // ---- Defenses that DO hold (these should PASS, and are reported as strengths) ----

  it("DEFENSE: anon booking in the past is rejected", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      try {
        await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.ownerStaffA, starts: new Date(Date.now() - 864e5).toISOString(), phone: "+905550000035" });
        return { booked: true };
      } catch (e) {
        return { booked: false, error: shortErr(e) };
      }
    });
    expect(res.booked).toBe(false);
  });

  it("DEFENSE: double-booking the same staff+time is blocked by the exclusion constraint", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      const start = new Date(Date.now() + 7 * 864e5);
      start.setUTCHours(10, 0, 0, 0);
      await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.ownerStaffA, starts: start.toISOString(), phone: "+905550000036" });
      try {
        await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.ownerStaffA, starts: start.toISOString(), phone: "+905550000037" });
        return { second: true };
      } catch (e) {
        return { second: false, error: shortErr(e) };
      }
    });
    expect(res.second).toBe(false);
  });

  it("DEFENSE: anon cannot book a service/staff from another salon (mismatched salon_id)", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      try {
        // salon A, but service + staff belong to salon B
        await book(t, { salon: ids.salonA, service: ids.serviceB, staff: ids.ownerStaffB, starts: new Date(Date.now() + 8 * 864e5).toISOString(), phone: "+905550000038" });
        return { booked: true };
      } catch (e) {
        return { booked: false, error: shortErr(e) };
      }
    });
    expect(res.booked).toBe(false);
  });
});
