import { format } from "date-fns";

export const CURRENCY = "TRY";

export function money(n: number | string | null | undefined) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: CURRENCY,
    maximumFractionDigits: 0,
  }).format(Number(n ?? 0));
}

export const fmtTime = (d: string | Date) => format(new Date(d), "HH:mm");
export const fmtDay = (d: string | Date) => format(new Date(d), "EEE d MMM");
export const fmtDateTime = (d: string | Date) => format(new Date(d), "EEE d MMM, HH:mm");

export function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/ı/g, "i")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

export function phoneDigits(p: string) {
  return p.replace(/[^\d]/g, "");
}

type Busy = { starts_at: string; ends_at: string };

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(utcMs: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const p = dtf.formatToParts(new Date(utcMs)).reduce<Record<string, string>>((a, x) => {
    if (x.type !== "literal") a[x.type] = x.value;
    return a;
  }, {});
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, +(p.hour === "24" ? "0" : p.hour), +p.minute, +p.second);
  return asUTC - utcMs;
}

/** The absolute instant of a wall-clock time in `timeZone`. */
export function zonedWallTimeToUtc(y: number, mo: number, d: number, hh: number, mm: number, timeZone: string): Date {
  const guess = Date.UTC(y, mo, d, hh, mm, 0);
  return new Date(guess - tzOffsetMs(guess, timeZone));
}

/**
 * Build free start times for a day within opening hours.
 * When `timeZone` is given, open/close are interpreted in the SALON's zone so
 * the slots are the same absolute instants for every visitor (SE-02). Without
 * it, falls back to the viewer's local zone (legacy behavior).
 */
export function buildSlots(opts: {
  date: Date;
  open: string; // "09:00:00"
  close: string;
  duration: number;
  busy: Busy[];
  step?: number;
  timeZone?: string;
}) {
  const { date, open, close, duration, busy, step = 15, timeZone } = opts;
  const [oh = 9, om = 0] = open.split(":").map(Number);
  const [ch = 19, cm = 0] = close.split(":").map(Number);
  let start: Date;
  let end: Date;
  if (timeZone) {
    const y = date.getFullYear();
    const mo = date.getMonth();
    const d = date.getDate();
    start = zonedWallTimeToUtc(y, mo, d, oh, om, timeZone);
    end = zonedWallTimeToUtc(y, mo, d, ch, cm, timeZone);
  } else {
    start = new Date(date);
    start.setHours(oh, om, 0, 0);
    end = new Date(date);
    end.setHours(ch, cm, 0, 0);
  }
  const now = Date.now();
  const out: Date[] = [];
  for (let t = start.getTime(); t + duration * 60000 <= end.getTime(); t += step * 60000) {
    if (t < now + 5 * 60000) continue;
    const e = t + duration * 60000;
    const clash = busy.some(
      (b) => new Date(b.starts_at).getTime() < e && new Date(b.ends_at).getTime() > t,
    );
    if (!clash) out.push(new Date(t));
  }
  return out;
}

export function isOpenDay(date: Date, openDays: number[]) {
  // openDays uses 1=Mon..7=Sun
  const d = date.getDay() === 0 ? 7 : date.getDay();
  return openDays.includes(d);
}

/**
 * Hours drawn on the calendar's time grid: the opening hours, widened to include
 * any appointment that starts before opening or ends after closing (FN-02), so an
 * appointment is never drawn outside the grid where it cannot be seen. Hours are
 * in the viewer's zone, like the rest of the calendar view.
 */
export function calendarHourRange(
  open: string,
  close: string,
  bookings: { starts_at: string | Date; ends_at: string | Date }[],
): { start: number; end: number } {
  let start = Number(open.slice(0, 2));
  let end = Math.ceil(Number(close.slice(0, 2)) + Number(close.slice(3, 5)) / 60);
  for (const b of bookings) {
    const s = new Date(b.starts_at);
    const e = new Date(b.ends_at);
    start = Math.min(start, s.getHours());
    const sameDay = e.toDateString() === s.toDateString();
    end = Math.max(end, sameDay ? Math.ceil(e.getHours() + e.getMinutes() / 60) : 24);
  }
  return { start, end };
}
