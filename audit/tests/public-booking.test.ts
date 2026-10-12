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

// A valid bookable instant: `daysAhead` from now (within the 21-day window), at
// 11:00 in the salon's zone (Istanbul = UTC+3 year-round -> 08:00Z), on an open
// day (Mon-Sat), aligned to the minute. Used so tests exercise the intended
// behaviour instead of tripping the new open-hours/window/alignment checks.
function validSlotUtc(daysAhead: number, hourIstanbul = 11): Date {
  const d = new Date(Date.now() + daysAhead * 864e5);
  d.setUTCHours(hourIstanbul - 3, 0, 0, 0);
  while (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1); // skip Sunday (closed)
  return d;
}

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
        starts: validSlotUtc(5).toISOString(),
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

  it("[SEC-01 residual] a booking with a different name is recorded as booked_name (not merged into the customer)", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "A");
      await t.unsafe(
        `insert into public.customers(salon_id,name,phone,email) values ($1,'Residual Real','+905551113333','rr@example.test')`,
        [ids.salonA],
      );
      await act(t, "anon");
      const [b] = await book(t, {
        salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1,
        starts: validSlotUtc(5).toISOString(), name: "Someone Else", phone: "+905551113333",
      });
      await act(t, "A");
      const [bk] = await t.unsafe(`select booked_name from public.bookings where id=$1`, [b.id]);
      const [cust] = await t.unsafe(`select name from public.customers where salon_id=$1 and phone='+905551113333'`, [ids.salonA]);
      return { booked_name: bk.booked_name as string, customer_name: cust.name as string };
    });
    // customer identity untouched, but the entered name is captured for staff to see
    expect(res.customer_name).toBe("Residual Real");
    expect(res.booked_name).toBe("Someone Else");
  });

  it("[BH-01] slot must be on the 15-minute grid (off-grid time rejected, on-grid accepted)", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      const onGrid = validSlotUtc(6, 11); // 11:00 == open(09:00)+120min -> multiple of 15
      const offGrid = new Date(onGrid.getTime() + 7 * 60000); // +7 minutes -> off the grid
      let onOk = false;
      let offOk = false;
      try { await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1, starts: onGrid.toISOString(), phone: "+905550000061" }); onOk = true; } catch { /* */ }
      try { await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.staffA2, starts: offGrid.toISOString(), phone: "+905550000062" }); offOk = true; } catch { /* */ }
      return { onOk, offOk };
    });
    expect(res.onOk, "on-grid 11:00 slot was rejected").toBe(true);
    expect(res.offOk, "off-grid 11:07 slot was accepted").toBe(false);
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

  it("[#2/BH-02] one phone cannot hold many upcoming bookings (per-phone cap)", async () => {
    const created = await rolledBack(async (t) => {
      await act(t, "anon");
      let n = 0;
      // valid in-hours slots on distinct open days, SAME phone
      for (let i = 0; i < 10; i++) {
        try {
          await book(t, {
            salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1,
            starts: validSlotUtc(2 + i).toISOString(), name: "Repeat Caller", phone: "+905551234567",
          });
          n++;
        } catch {
          break; // stop at first rejection
        }
      }
      return n;
    });
    // SECURE expectation: the per-phone upcoming cap (5) stops it well before 10.
    expect(created, `one phone created ${created} upcoming bookings`).toBeLessThanOrEqual(5);
  });

  it("[#2/BH-02] a salon cannot be flooded with bookings in a short burst (per-salon quota)", async () => {
    const created = await rolledBack(async (t) => {
      await act(t, "anon");
      let n = 0;
      // valid slots on distinct open days, DIFFERENT phones (defeats the per-phone cap)
      for (let i = 0; i < 16; i++) {
        try {
          await book(t, {
            salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1,
            starts: validSlotUtc(2 + i).toISOString(), name: `Flood ${i}`, phone: `+90555${String(2000000 + i)}`,
          });
          n++;
        } catch {
          break;
        }
      }
      return n;
    });
    // SECURE expectation: the per-salon burst quota (10/min) stops the flood.
    expect(created, `salon accepted ${created} bookings in one burst`).toBeLessThanOrEqual(10);
  });

  it("[#2/SEC-02] create_public_booking must bound the customer name length", async () => {
    // Secure outcome: a 20k-char name is rejected server-side (nothing stored).
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      const huge = "A".repeat(20000);
      try {
        await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1, starts: validSlotUtc(6).toISOString(), name: huge, phone: "+905550000034" });
        return { rejected: false };
      } catch (e) {
        return { rejected: true, error: shortErr(e) };
      }
    });
    expect(res.rejected, "20k-char customer name accepted (no length bound)").toBe(true);
  });

  it("[Item 12] different phone formats for the same person map to ONE customer", async () => {
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1, starts: validSlotUtc(3).toISOString(), name: "Norm One", phone: "0555 111 99 88" });
      await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1, starts: validSlotUtc(4).toISOString(), name: "Norm One", phone: "+90 555 111 9988" });
      await act(t, "A");
      const [row] = await t.unsafe(
        `select count(*)::int as n, min(phone) as phone from public.customers where salon_id=$1 and phone like '%5551119988'`,
        [ids.salonA],
      );
      return row;
    });
    expect(res.n, "phone variants created duplicate customers").toBe(1);
    expect(res.phone).toBe("+905551119988");
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
      const start = validSlotUtc(7, 12); // valid open-hours slot on an open day
      await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1, starts: start.toISOString(), phone: "+905550000036" });
      try {
        await book(t, { salon: ids.salonA, service: ids.serviceA, staff: ids.staffA1, starts: start.toISOString(), phone: "+905550000037" });
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
