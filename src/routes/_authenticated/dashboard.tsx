import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { addWeeks, endOfDay, format, startOfDay, startOfWeek, subWeeks } from "date-fns";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { useSalon } from "@/hooks/use-me";
import { useBookings } from "@/hooks/use-bookings";
import { fmtTime, money } from "@/lib/format";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — Chairside" }, { name: "description", content: "Your salon at a glance." }, { property: "og:title", content: "Dashboard — Chairside" }, { property: "og:description", content: "Your salon at a glance." }] }),
  component: Dashboard,
});

function Dashboard() {
  const me = useSalon();
  const today = startOfDay(new Date());
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const rangeFrom = subWeeks(weekStart, 7);
  const rangeTo = addWeeks(weekStart, 2);
  const staffFilter = me.isOwner ? undefined : me.myStaff?.id;
  const { data = [], isLoading } = useBookings({ salonId: me.salon.id, from: rangeFrom, to: rangeTo, staffId: staffFilter });

  const todays = data.filter((b) => new Date(b.starts_at) >= today && new Date(b.starts_at) <= endOfDay(today));

  const weekly = useMemo(() => {
    return Array.from({ length: 8 }, (_, i) => {
      const s = subWeeks(weekStart, 7 - i);
      const e = addWeeks(s, 1);
      const rows = data.filter((b) => new Date(b.starts_at) >= s && new Date(b.starts_at) < e);
      return { week: format(s, "d MMM"), revenue: rows.reduce((a, b) => a + Number(b.price), 0), count: rows.length };
    });
  }, [data, weekStart]);

  const popular = useMemo(() => {
    const m = new Map<string, { name: string; count: number; revenue: number }>();
    data.filter((b) => new Date(b.starts_at) >= rangeFrom).forEach((b) => {
      const c = m.get(b.service_name) ?? { name: b.service_name, count: 0, revenue: 0 };
      c.count++;
      c.revenue += Number(b.price);
      m.set(b.service_name, c);
    });
    return [...m.values()].sort((a, b) => b.count - a.count).slice(0, 5);
  }, [data, rangeFrom]);

  const thisWeek = weekly[7];
  const lastWeek = weekly[6];
  const link = typeof window !== "undefined" ? `${window.location.origin}/book/${me.salon.slug}` : "";

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{format(new Date(), "EEEE d MMMM")}</p>
          <h1 className="mt-1 text-4xl font-semibold">Good {new Date().getHours() < 12 ? "morning" : new Date().getHours() < 18 ? "afternoon" : "evening"}{me.myStaff ? `, ${me.myStaff.name.split(" ")[0]}` : ""}</h1>
        </div>
        {me.isOwner && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => { navigator.clipboard.writeText(link); toast.success("Booking link copied"); }}><Copy /> Copy booking link</Button>
            <Button variant="soft" size="sm" asChild><a href={`/book/${me.salon.slug}`} target="_blank" rel="noreferrer"><ExternalLink /> Open</a></Button>
          </div>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Stat label="Today" value={String(todays.length)} hint="appointments" />
        {me.isOwner ? (
          <>
            <Stat label="Revenue this week" value={money(thisWeek?.revenue)} hint={`${money(lastWeek?.revenue)} last week`} />
            <Stat label="Bookings this week" value={String(thisWeek?.count ?? 0)} hint={`${lastWeek?.count ?? 0} last week`} />
          </>
        ) : (
          <Stat label="This week" value={String(thisWeek?.count ?? 0)} hint="appointments" />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="surface p-5 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Today's schedule</h2>
            <Link to="/calendar" className="text-sm text-copper hover:underline">Calendar →</Link>
          </div>
          <div className="mt-4 space-y-2">
            {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
            {!isLoading && todays.length === 0 && <p className="text-sm text-muted-foreground">Nothing booked today.</p>}
            {todays.map((b) => (
              <Link key={b.id} to="/customers/$id" params={{ id: b.customer_id }} className="flex items-center gap-3 rounded-lg p-2 transition hover:bg-muted">
                <span className="w-12 font-semibold tabular-nums">{fmtTime(b.starts_at)}</span>
                <span className="h-8 w-1 rounded-full bg-copper" />
                <span className="flex-1 truncate">
                  <span className="block truncate font-medium">{b.customer?.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{b.service_name}{me.isOwner && b.staff ? ` · ${b.staff.name}` : ""}</span>
                </span>
              </Link>
            ))}
          </div>
        </section>

        {me.isOwner && (
          <section className="surface p-5 lg:col-span-3">
            <h2 className="text-xl font-semibold">Revenue per week</h2>
            <div className="mt-4 h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weekly}>
                  <CartesianGrid vertical={false} stroke="var(--color-border)" />
                  <XAxis dataKey="week" tickLine={false} axisLine={false} fontSize={12} stroke="var(--color-muted-foreground)" />
                  <YAxis tickLine={false} axisLine={false} fontSize={12} width={50} stroke="var(--color-muted-foreground)" />
                  <Tooltip cursor={{ fill: "var(--color-muted)" }} formatter={(v: number) => money(v)} contentStyle={{ borderRadius: 12, border: "1px solid var(--color-border)", background: "var(--color-card)" }} />
                  <Bar dataKey="revenue" fill="var(--color-copper)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </section>
        )}
      </div>

      {me.isOwner && (
        <section className="surface p-5">
          <h2 className="text-xl font-semibold">Most popular services <span className="text-sm font-normal text-muted-foreground">· last 8 weeks</span></h2>
          <div className="mt-4 space-y-3">
            {popular.length === 0 && <p className="text-sm text-muted-foreground">No bookings yet.</p>}
            {popular.map((p) => (
              <div key={p.name}>
                <div className="flex justify-between text-sm"><span className="font-medium">{p.name}</span><span className="text-muted-foreground">{p.count} bookings · {money(p.revenue)}</span></div>
                <div className="mt-1.5 h-2 rounded-full bg-muted"><div className="h-2 rounded-full bg-primary" style={{ width: `${(p.count / popular[0]!.count) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="surface p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-3xl font-semibold">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}
