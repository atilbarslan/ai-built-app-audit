// Functional review (requirements traceability): does each sentence of the
// prompt work the way it was asked for?
//
// `DEFENSE:` tests pin behaviour that already works. `[FN-xx]` tests assert the
// EXPECTED behaviour; they failed on the code before the fix and pass after it.
// Findings left as recommendations are listed as `it.todo` with the reason.
//
// Database scenarios run inside rolled-back transactions and do not persist.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { sql, rolledBack, act, fixtureIds, validSlotUtc } from "./_db";
import { buildSlots, calendarHourRange } from "../../src/lib/format";

let ids: Awaited<ReturnType<typeof fixtureIds>>;
let staffA2: string;
beforeAll(async () => {
  ids = await fixtureIds();
  const [a2] = await sql`select id from public.staff where salon_id=${ids.salonA} and name='Stylist A2'`;
  staffA2 = a2.id;
});
afterAll(async () => {
  await sql.end();
});

const book = (t: any, staff: string, starts: Date, name = "Walk In", phone = "+905550000000") =>
  t.unsafe(`select public.create_public_booking($1,$2,$3,$4,$5,$6,'') as id`, [
    ids.salonA,
    ids.serviceA,
    staff,
    starts.toISOString(),
    name,
    phone,
  ]);

/** Owner-side insert of a booking (the in-app path writes the table directly). */
const insertBooking = (t: any, o: { staff: string; customer: string; starts: Date; minutes?: number; price?: number; status?: string }) =>
  t.unsafe(
    `insert into public.bookings(salon_id,staff_id,customer_id,service_name,price,starts_at,ends_at,status)
     values ($1,$2,$3,'Haircut',$4,$5,$6,$7) returning id`,
    [
      ids.salonA,
      o.staff,
      o.customer,
      o.price ?? 300,
      o.starts.toISOString(),
      new Date(o.starts.getTime() + (o.minutes ?? 30) * 60000).toISOString(),
      o.status ?? "booked",
    ],
  );

/** A local Date whose calendar day equals the salon (Istanbul) day of `instant`. */
function salonDay(instant: Date): Date {
  const [y, m, d] = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul" }).format(instant).split("-").map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

describe("R-03 public booking page: free time slots", () => {
  it("DEFENSE: a booked slot disappears from that stylist's free slots and stays free for another stylist", async () => {
    const slot = validSlotUtc(3, 11);
    const res = await rolledBack(async (t) => {
      await act(t, "anon");
      await book(t, ids.staffA1, slot);
      const busy = await t.unsafe(`select * from public.get_busy_times($1,$2,$3)`, [
        ids.salonA,
        new Date(slot.getTime() - 12 * 3600e3).toISOString(),
        new Date(slot.getTime() + 12 * 3600e3).toISOString(),
      ]);
      return [...busy];
    });
    const opts = { date: salonDay(slot), open: "09:00:00", close: "19:00:00", duration: 30, timeZone: "Europe/Istanbul" };
    const forA1 = buildSlots({ ...opts, busy: res.filter((b: any) => b.staff_id === ids.staffA1).map(iso) }).map((d) => d.toISOString());
    const forA2 = buildSlots({ ...opts, busy: res.filter((b: any) => b.staff_id === staffA2).map(iso) }).map((d) => d.toISOString());
    expect(forA1).not.toContain(slot.toISOString());
    expect(forA2).toContain(slot.toISOString());
  });

  it("DEFENSE: a cancelled appointment frees the slot for a new public booking", async () => {
    const slot = validSlotUtc(4, 11);
    const second = await rolledBack(async (t) => {
      await act(t, "anon");
      const [first] = await book(t, ids.staffA1, slot, "First Client", "+905550000101");
      await act(t, "A");
      await t.unsafe(`update public.bookings set status='cancelled' where id=$1`, [first.id]);
      await act(t, "anon");
      const [again] = await book(t, ids.staffA1, slot, "Second Client", "+905550000102");
      return again.id as string;
    });
    expect(second).toBeTruthy();
  });
});

describe("R-05 owner cancels or moves bookings", () => {
  it("DEFENSE: moving onto an occupied slot is rejected, with an error the Bookings screen recognises", async () => {
    const at11 = validSlotUtc(6, 11);
    const at12 = validSlotUtc(6, 12);
    const err = await rolledBack(async (t) => {
      await act(t, "A");
      await insertBooking(t, { staff: ids.staffA1, customer: ids.customerA, starts: at11 });
      const [moving] = await insertBooking(t, { staff: ids.staffA1, customer: ids.customerA, starts: at12 });
      try {
        await t.unsafe(`savepoint mv`);
        await t.unsafe(`update public.bookings set starts_at=$1, ends_at=$2 where id=$3`, [
          at11.toISOString(),
          new Date(at11.getTime() + 30 * 60000).toISOString(),
          moving.id,
        ]);
        return "";
      } catch (e: any) {
        await t.unsafe(`rollback to savepoint mv`);
        return String(e.message);
      }
    });
    // src/routes/_authenticated/bookings.tsx maps messages containing "exclu" to
    // "That time overlaps another booking."
    expect(err).toMatch(/exclu/);
  });
});

describe("R-04 / R-07 client history seen by staff (FN-01)", () => {
  async function historyAs(p: "A" | "A1" | "B" | "X") {
    return rolledBack(async (t) => {
      await act(t, "A");
      const [c] = await t.unsafe(
        `insert into public.customers(salon_id,name,phone) values ($1,'History Client','+905550000201') returning id`,
        [ids.salonA],
      );
      await insertBooking(t, { staff: staffA2, customer: c.id, starts: new Date(Date.now() - 10 * 864e5), price: 900 });
      await insertBooking(t, { staff: staffA2, customer: c.id, starts: validSlotUtc(5, 12), price: 900 });
      await insertBooking(t, { staff: ids.staffA1, customer: c.id, starts: validSlotUtc(5, 10), price: 300 });
      await act(t, p);
      try {
        await t.unsafe(`savepoint h`);
        return { rows: [...(await t.unsafe(`select * from public.get_customer_history($1)`, [c.id]))], error: "" };
      } catch (e: any) {
        await t.unsafe(`rollback to savepoint h`);
        return { rows: [] as any[], error: String(e.message) };
      }
    });
  }

  it("[FN-01] a stylist opening a client sees the client's whole visit history (every stylist), without prices", async () => {
    const r = await historyAs("A1");
    expect(r.error).toBe("");
    expect(r.rows).toHaveLength(3);
    expect(r.rows.map((b: any) => b.staff_name).sort()).toEqual(["Stylist A1", "Stylist A2", "Stylist A2"]);
    expect(r.rows.every((b: any) => b.price === null)).toBe(true);
  });

  it("[FN-01] the owner also gets prices; another salon's owner and a non-member get nothing", async () => {
    const owner = await historyAs("A");
    expect(owner.rows).toHaveLength(3);
    expect(owner.rows.every((b: any) => Number(b.price) > 0)).toBe(true);
    expect((await historyAs("B")).rows).toHaveLength(0);
    expect((await historyAs("X")).rows).toHaveLength(0);
  });

  it("[FN-01] anonymous visitors cannot call the history function", async () => {
    const err = await rolledBack(async (t) => {
      await act(t, "anon");
      try {
        await t.unsafe(`select * from public.get_customer_history($1)`, [ids.customerA]);
        return "";
      } catch (e: any) {
        return String(e.message);
      }
    });
    expect(err).toMatch(/permission denied/);
  });
});

describe("R-04 / R-05 calendar grid (FN-02)", () => {
  it("[FN-02] the day grid widens to show an appointment that starts before opening time", () => {
    const b = { starts_at: new Date(2026, 9, 14, 9, 0), ends_at: new Date(2026, 9, 14, 9, 30) };
    expect(calendarHourRange("10:00:00", "19:00:00", [b])).toEqual({ start: 9, end: 19 });
  });

  it("[FN-02] the day grid widens to show an appointment that runs past closing time", () => {
    const b = { starts_at: new Date(2026, 9, 14, 19, 30), ends_at: new Date(2026, 9, 14, 20, 15) };
    expect(calendarHourRange("10:00:00", "19:00:00", [b])).toEqual({ start: 10, end: 21 });
  });

  it("[FN-02] with no appointments outside the hours the grid stays exactly the opening hours", () => {
    const b = { starts_at: new Date(2026, 9, 14, 11, 0), ends_at: new Date(2026, 9, 14, 11, 30) };
    expect(calendarHourRange("09:00:00", "18:30:00", [b])).toEqual({ start: 9, end: 19 });
  });
});

describe("Recommendations (not changed in this round, see audit/AUDIT.md)", () => {
  it.todo(
    "[FN-03] dashboard 'revenue' should count only appointments that took place; today it adds this week's future bookings, and 'most popular, last 8 weeks' also counts the next two weeks (needs a completed/no-show status: product decision)",
  );
  it.todo(
    "[FN-04] the Bookings list should reach every booking; today it shows only 60 days back and 90 days ahead (needs paging together with SE-03)",
  );
  it.todo(
    "[FN-05] the owner should be able to edit a service's price/duration and a staff member's name/email; today the only way is delete and re-create (UI work, low risk)",
  );
});

function iso(b: any) {
  return { starts_at: new Date(b.starts_at).toISOString(), ends_at: new Date(b.ends_at).toISOString() };
}
