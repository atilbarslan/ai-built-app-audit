import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { addDays, endOfDay, format, startOfDay } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSalon } from "@/hooks/use-me";
import { useBookings, useServices, useStaffList, type BookingRow } from "@/hooks/use-bookings";
import { buildSlots, fmtDay, fmtTime, money } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/bookings")({
  head: () => ({ meta: [{ title: "Bookings — Chairside" }, { name: "description", content: "Manage, cancel and move bookings." }, { property: "og:title", content: "Bookings — Chairside" }, { property: "og:description", content: "Manage, cancel and move bookings." }] }),
  component: BookingsPage,
});

function BookingsPage() {
  const me = useSalon();
  const [range, setRange] = useState<"upcoming" | "past">("upcoming");
  const [showCancelled, setShowCancelled] = useState(false);
  const now = startOfDay(new Date());
  const from = range === "upcoming" ? now : addDays(now, -60);
  const to = range === "upcoming" ? addDays(now, 90) : now;
  const { data = [], isLoading } = useBookings({ salonId: me.salon.id, from, to, includeCancelled: showCancelled });
  const [moving, setMoving] = useState<BookingRow>();
  const [cancelling, setCancelling] = useState<BookingRow>();
  const qc = useQueryClient();

  const rows = range === "past" ? [...data].reverse() : data;
  const grouped = useMemo(() => {
    const m = new Map<string, BookingRow[]>();
    rows.forEach((b) => {
      const k = format(new Date(b.starts_at), "yyyy-MM-dd");
      m.set(k, [...(m.get(k) ?? []), b]);
    });
    return [...m.entries()];
  }, [rows]);

  if (!me.isOwner) return <p className="text-muted-foreground">Only the salon owner can manage bookings.</p>;

  async function cancel(b: BookingRow) {
    const { error } = await supabase.from("bookings").update({ status: "cancelled" }).eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Booking cancelled");
    qc.invalidateQueries({ queryKey: ["bookings"] });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="mr-auto text-3xl font-semibold">Bookings</h1>
        <div className="flex rounded-full border bg-card p-1">
          {(["upcoming", "past"] as const).map((v) => (
            <button key={v} onClick={() => setRange(v)} className={cn("rounded-full px-4 py-1 text-sm font-medium capitalize", range === v ? "bg-primary text-primary-foreground" : "text-muted-foreground")}>{v}</button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input type="checkbox" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} className="accent-[var(--color-copper)]" /> Show cancelled
        </label>
      </div>

      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {!isLoading && grouped.length === 0 && <div className="surface p-8 text-center text-muted-foreground">No bookings here yet. Share your booking link to get started.</div>}

      {grouped.map(([day, items]) => (
        <section key={day}>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{fmtDay(day)}</h2>
          <div className="surface divide-y">
            {items.map((b) => (
              <div key={b.id} className={cn("flex flex-wrap items-center gap-3 p-4", b.status === "cancelled" && "opacity-55")}>
                <div className="w-24 font-semibold tabular-nums">{fmtTime(b.starts_at)}–{fmtTime(b.ends_at)}</div>
                <div className="min-w-0 flex-1">
                  <Link to="/customers/$id" params={{ id: b.customer_id }} className="font-medium hover:text-copper">{b.customer?.name}</Link>
                  <p className="truncate text-sm text-muted-foreground">{b.service_name} · {b.staff?.name} · {money(b.price)}</p>
                </div>
                {b.status === "cancelled" ? (
                  <Badge variant="secondary">Cancelled</Badge>
                ) : range === "upcoming" ? (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setMoving(b)}>Move</Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => setCancelling(b)}>Cancel</Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ))}

      <AlertDialog open={!!cancelling} onOpenChange={(o) => !o && setCancelling(undefined)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this booking?</AlertDialogTitle>
            <AlertDialogDescription>{cancelling && `${cancelling.customer?.name} · ${cancelling.service_name} on ${fmtDay(cancelling.starts_at)} at ${fmtTime(cancelling.starts_at)}`}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={() => cancelling && cancel(cancelling)}>Cancel booking</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {moving && <MoveDialog booking={moving} onClose={() => setMoving(undefined)} />}
    </div>
  );
}

function MoveDialog({ booking, onClose }: { booking: BookingRow; onClose: () => void }) {
  const me = useSalon();
  const qc = useQueryClient();
  const staffQ = useStaffList(me.salon.id);
  const servicesQ = useServices(me.salon.id);
  const [staffId, setStaffId] = useState(booking.staff_id);
  const [day, setDay] = useState(format(new Date(booking.starts_at), "yyyy-MM-dd"));
  const [saving, setSaving] = useState(false);
  const dayDate = startOfDay(new Date(day + "T00:00"));
  const duration = (new Date(booking.ends_at).getTime() - new Date(booking.starts_at).getTime()) / 60000;
  const busyQ = useBookings({ salonId: me.salon.id, from: dayDate, to: endOfDay(dayDate), staffId });
  const busy = (busyQ.data ?? []).filter((b) => b.id !== booking.id);
  const slots = busyQ.data ? buildSlots({ date: dayDate, open: me.salon.open_time, close: me.salon.close_time, duration, busy }) : [];
  void servicesQ;

  async function move(t: Date) {
    setSaving(true);
    const { error } = await supabase
      .from("bookings")
      .update({ staff_id: staffId, starts_at: t.toISOString(), ends_at: new Date(t.getTime() + duration * 60000).toISOString() })
      .eq("id", booking.id);
    setSaving(false);
    if (error) return toast.error(error.message.includes("exclu") ? "That time overlaps another booking." : error.message);
    toast.success(`Moved to ${fmtDay(t)} at ${fmtTime(t)}`);
    qc.invalidateQueries({ queryKey: ["bookings"] });
    onClose();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Move booking</DialogTitle></DialogHeader>
        <p className="text-sm text-muted-foreground">{booking.customer?.name} · {booking.service_name} ({duration} min)</p>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} /></div>
          <div className="space-y-1.5">
            <Label>Staff</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{staffQ.data?.filter((s) => s.active).map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto">
          {busyQ.isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : slots.length === 0 ? <p className="text-sm text-muted-foreground">No free times that day.</p> : (
            <div className="grid grid-cols-4 gap-2">
              {slots.map((t) => (
                <button key={t.toISOString()} disabled={saving} onClick={() => move(t)} className="rounded-lg border bg-card py-2 text-sm font-semibold hover:border-copper hover:text-copper disabled:opacity-50">{format(t, "HH:mm")}</button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
