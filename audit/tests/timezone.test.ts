// Time-zone correctness of the booking slot builder (src/lib/format.ts).
//
// The salon stores open_time/close_time as a bare wall-clock ("09:00"). The fix
// (SE-02) makes buildSlots interpret them in the SALON's time zone, so the slot
// is the same absolute instant for every visitor. This test pins the salon to
// Istanbul (UTC+3) and asserts the 09:00 slot == 06:00Z REGARDLESS of the
// process/browser zone. It must pass under TZ=Europe/Istanbul, Europe/Berlin and
// America/New_York alike.
//
// The second case documents the OLD (buggy) behavior: without a timeZone,
// buildSlots falls back to the viewer's zone and the instant shifts.

import { describe, it, expect } from "vitest";
import { buildSlots } from "../../src/lib/format";

// The REAL runtime zone (TZ env may be empty while the machine is on Istanbul,
// which would make the "old bug" demo a false alarm). Read it properly.
const REAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const ON_ISTANBUL = REAL_TZ === "Europe/Istanbul";

describe("SE-02 - buildSlots time zone", () => {
  it("FIXED: 09:00 resolves to the salon's zone (Istanbul=06:00Z) for every viewer", () => {
    const date = new Date("2027-06-15T12:00:00Z");
    const slots = buildSlots({ date, open: "09:00:00", close: "19:00:00", duration: 30, busy: [], timeZone: "Europe/Istanbul" });
    expect(slots.length).toBeGreaterThan(0);
    const firstIso = slots[0].toISOString();
    // eslint-disable-next-line no-console
    console.log(`[TZ=${process.env.TZ ?? "(system)"}] salon-zone first slot -> ${firstIso}`);
    expect(firstIso).toBe("2027-06-15T06:00:00.000Z");
  });

  // Skipped when the machine itself is on Istanbul: there the legacy viewer-zone
  // path coincides with the salon zone, so the old bug is invisible (not a failure).
  it.skipIf(ON_ISTANBUL)("documents the old bug: without timeZone the instant shifts with the viewer's zone", () => {
    const date = new Date("2027-06-15T12:00:00Z");
    const slots = buildSlots({ date, open: "09:00:00", close: "19:00:00", duration: 30, busy: [] });
    const firstIso = slots[0].toISOString();
    // eslint-disable-next-line no-console
    console.log(`[real TZ=${REAL_TZ}] viewer-zone first slot -> ${firstIso}`);
    expect(firstIso).not.toBe("2027-06-15T06:00:00.000Z");
  });
});

describe("SE-02 residual (functional review) - public busy-time window", () => {
  // Not changed in this round. src/routes/book.$slug.tsx asks get_busy_times for
  // the visitor's local day (startOfDay/endOfDay in the browser zone). For a
  // visitor east of the salon (e.g. Asia/Tokyo) an Istanbul booking at 18:00 falls
  // outside that window, so the slot is offered as free; the server then rejects
  // it ("that time was just taken"), so no double booking is possible.
  it.todo("[SE-02 residual] the busy-time window should be the SALON's day, not the visitor's local day");
});
