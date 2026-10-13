import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { addDays, endOfDay, format, isSameDay, startOfDay, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useSalon } from "@/hooks/use-me";
import { useBookings, useStaffList, type BookingRow } from "@/hooks/use-bookings";
import { calendarHourRange, fmtTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/calendar")({
  head: () => ({ meta: [{ title: "Calendar — Chairside" }, { name: "description", content: "Day and week calendar for your appointments." }, { property: "og:title", content: "Calendar — Chairside" }, { property: "og:description", content: "Day and week calendar for your appointments." }] }),
  component: CalendarPage,
});

const HOUR = 64;

function CalendarPage() {
  const me = useSalon();
  const [view, setView] = useState<"day" | "week">("day");
  const [date, setDate] = useState(startOfDay(new Date()));
  const [staffSel, setStaffSel] = useState<string>(me.isOwner ? "all" : me.myStaff?.id ?? "none");
  const staffQ = useStaffList(me.salon.id);

  const from = view === "day" ? date : startOfWeek(date, { weekStartsOn: 1 });
  const to = view === "day" ? endOfDay(date) : addDays(from, 7);
  const staffId = staffSel === "all" ? undefined : staffSel;
  const { data = [] } = useBookings({ salonId: me.salon.id, from, to, staffId });

  // FN-02: widen the grid so appointments outside the opening hours stay visible.
  const { start: openH, end: closeH } = calendarHourRange(me.salon.open_time, me.salon.close_time, data);
  const hours = Array.from({ length: closeH - openH }, (_, i) => openH + i);
  const days = view === "day" ? [date] : Array.from({ length: 7 }, (_, i) => addDays(from, i));
  const shift = (n: number) => setDate(addDays(date, view === "day" ? n : n * 7));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-3xl font-semibold">{view === "day" ? format(date, "EEEE d MMM") : `Week of ${format(from, "d MMM")}`}</h1>
        <div className="flex rounded-full border bg-card p-1">
          {(["day", "week"] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={cn("rounded-full px-4 py-1 text-sm font-medium capitalize", view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v}</button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" onClick={() => shift(-1)} aria-label="Previous"><ChevronLeft /></Button>
          <Button variant="outline" size="sm" onClick={() => setDate(startOfDay(new Date()))}>Today</Button>
          <Button variant="outline" size="icon" onClick={() => shift(1)} aria-label="Next"><ChevronRight /></Button>
        </div>
        {me.isOwner && (
          <Select value={staffSel} onValueChange={setStaffSel}>
            <SelectTrigger className="w-44 bg-card"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {staffQ.data?.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {!me.isOwner && !me.myStaff && <p className="text-muted-foreground">Your account isn't linked to a staff profile yet.</p>}

      {/* Mobile week: agenda list */}
      {view === "week" && (
        <div className="space-y-4 md:hidden">
          {days.map((d) => {
            const items = data.filter((b) => isSameDay(new Date(b.starts_at), d));
            return (
              <div key={d.toISOString()} className="surface p-4">
                <p className={cn("text-sm font-semibold", isSameDay(d, new Date()) && "text-copper")}>{format(d, "EEEE d MMM")}</p>
                {items.length === 0 ? <p className="mt-1 text-sm text-muted-foreground">Free</p> : (
                  <div className="mt-2 space-y-2">{items.map((b) => <AgendaItem key={b.id} b={b} showStaff={!staffId} />)}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className={cn("surface overflow-x-auto", view === "week" && "hidden md:block")}>
        <div className="flex min-w-full" style={{ minWidth: view === "week" ? 840 : undefined }}>
          <div className="w-14 shrink-0 border-r">
            <div className="h-10 border-b" />
            {hours.map((h) => <div key={h} style={{ height: HOUR }} className="pr-2 pt-1 text-right text-xs text-muted-foreground">{String(h).padStart(2, "0")}:00</div>)}
          </div>
          {days.map((d) => {
            const items = data.filter((b) => isSameDay(new Date(b.starts_at), d));
            return (
              <div key={d.toISOString()} className="min-w-0 flex-1 border-r last:border-r-0">
                <div className={cn("flex h-10 items-center justify-center border-b text-sm font-semibold", isSameDay(d, new Date()) && "text-copper")}>{format(d, view === "day" ? "EEEE" : "EEE d")}</div>
                <div className="relative" style={{ height: hours.length * HOUR }}>
                  {hours.map((h, i) => <div key={h} className="absolute inset-x-0 border-t border-dashed" style={{ top: i * HOUR }} />)}
                  {items.map((b) => {
                    const s = new Date(b.starts_at);
                    const e = new Date(b.ends_at);
                    const top = (s.getHours() + s.getMinutes() / 60 - openH) * HOUR;
                    const height = Math.max(((e.getTime() - s.getTime()) / 3600000) * HOUR - 2, 22);
                    return (
                      <Link key={b.id} to="/customers/$id" params={{ id: b.customer_id }} className="absolute inset-x-1 overflow-hidden rounded-lg border-l-4 border-copper bg-copper-soft px-2 py-1 text-xs transition hover:shadow-soft" style={{ top, height }}>
                        <p className="truncate font-semibold">{fmtTime(b.starts_at)} {b.customer?.name}</p>
                        <p className="truncate text-muted-foreground">{b.service_name}{!staffId && b.staff ? ` · ${b.staff.name}` : ""}</p>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function AgendaItem({ b, showStaff }: { b: BookingRow; showStaff: boolean }) {
  return (
    <Link to="/customers/$id" params={{ id: b.customer_id }} className="flex items-center gap-3 rounded-lg bg-copper-soft px-3 py-2 text-sm">
      <span className="font-semibold tabular-nums">{fmtTime(b.starts_at)}</span>
      <span className="truncate">{b.customer?.name} · <span className="text-muted-foreground">{b.service_name}{showStaff && b.staff ? ` · ${b.staff.name}` : ""}</span></span>
    </Link>
  );
}
