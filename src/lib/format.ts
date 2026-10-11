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

/** Build free start times for a day within opening hours. */
export function buildSlots(opts: {
  date: Date;
  open: string; // "09:00:00"
  close: string;
  duration: number;
  busy: Busy[];
  step?: number;
}) {
  const { date, open, close, duration, busy, step = 15 } = opts;
  const [oh = 9, om = 0] = open.split(":").map(Number);
  const [ch = 19, cm = 0] = close.split(":").map(Number);
  const start = new Date(date);
  start.setHours(oh, om, 0, 0);
  const end = new Date(date);
  end.setHours(ch, cm, 0, 0);
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
