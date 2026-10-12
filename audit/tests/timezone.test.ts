// Time-zone correctness of the booking slot builder (src/lib/format.ts).
//
// The salon stores open_time/close_time as a bare wall-clock ("09:00") with NO
// time zone. buildSlots() turns that into concrete Date objects with
// `date.setHours(oh, om)` - which uses the *viewer's browser* time zone, then
// sends `.toISOString()` (an absolute UTC instant) to the server.
//
// Consequence: two visitors in different time zones who both pick "09:00" send
// two DIFFERENT absolute instants, and a visitor outside the salon's zone books
// a slot that is not 09:00 at the salon.
//
// This test pins the salon to Istanbul (its real zone, per the app defaults) and
// asserts the 09:00 slot resolves to the Istanbul instant (06:00Z) REGARDLESS of
// the process/browser zone. Run it under different TZ values:
//   TZ=Europe/Istanbul  -> passes (viewer == salon)
//   TZ=Europe/Berlin    -> FAILS  (slot shifts)
//   TZ=America/New_York -> FAILS  (slot shifts)
// A failing run is the finding.

import { describe, it, expect } from "vitest";
import { buildSlots } from "../../src/lib/format";

describe("SE - buildSlots time zone", () => {
  it("09:00 slot must be the salon's 09:00 (Istanbul = 06:00Z) regardless of viewer TZ", () => {
    const date = new Date("2027-06-15T12:00:00Z"); // a fixed far-enough day
    const slots = buildSlots({ date, open: "09:00:00", close: "19:00:00", duration: 30, busy: [] });
    expect(slots.length).toBeGreaterThan(0);
    const firstIso = slots[0].toISOString();
    // eslint-disable-next-line no-console
    console.log(`[TZ=${process.env.TZ ?? "(system)"}] first 09:00 slot -> ${firstIso}`);
    // Istanbul is UTC+3 year-round: 09:00 Istanbul on 2027-06-15 == 06:00Z.
    expect(firstIso).toBe("2027-06-15T06:00:00.000Z");
  });
});
