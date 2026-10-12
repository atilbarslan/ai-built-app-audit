import { createFileRoute, notFound } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { addDays, startOfDay, endOfDay, format } from "date-fns";
import { ArrowLeft, Check, Clock, MapPin, Phone } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getPublicSalon } from "@/lib/public.functions";
import { buildSlots, isOpenDay, money, fmtDateTime } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/book/$slug")({
  loader: async ({ params }) => {
    const data = await getPublicSalon({ data: { slug: params.slug } });
    if (!data) throw notFound();
    return data;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return { meta: [{ title: "Salon not found" }, { name: "robots", content: "noindex" }] };
    const t = `Book at ${loaderData.salon.name}`;
    const d = `Choose a service, a stylist and a free time at ${loaderData.salon.name}.`;
    return { meta: [{ title: t }, { name: "description", content: d }, { property: "og:title", content: t }, { property: "og:description", content: d }] };
  },
  notFoundComponent: () => (
    <div className="grid min-h-screen place-items-center px-5 text-center">
      <div><h1 className="text-3xl font-semibold">Salon not found</h1><p className="mt-2 text-muted-foreground">Check the booking link and try again.</p></div>
    </div>
  ),
  component: BookingPage,
});

function BookingPage() {
  const { salon, services, staff } = Route.useLoaderData();
  const [serviceId, setServiceId] = useState<string>();
  const [staffId, setStaffId] = useState<string>();
  const [day, setDay] = useState<Date>();
  const [slot, setSlot] = useState<Date>();
  const [form, setForm] = useState({ name: "", phone: "", email: "" });
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<Date>();

  const service = services.find((s) => s.id === serviceId);
  const member = staff.find((s) => s.id === staffId);
  const step = !service ? 1 : !member ? 2 : !slot ? 3 : 4;

  const days = useMemo(
    () => Array.from({ length: 21 }, (_, i) => startOfDay(addDays(new Date(), i))).filter((d) => isOpenDay(d, salon.open_days)),
    [salon.open_days],
  );

  const busyQ = useQuery({
    queryKey: ["busy", salon.id, staffId, day?.toISOString()],
    enabled: !!staffId && !!day,
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_busy_times", {
        _salon: salon.id,
        _from: startOfDay(day!).toISOString(),
        _to: endOfDay(day!).toISOString(),
      });
      if (error) throw error;
      return (data ?? []).filter((b) => b.staff_id === staffId);
    },
  });

  const slots = useMemo(
    () =>
      day && service && busyQ.data
        ? buildSlots({ date: day, open: salon.open_time, close: salon.close_time, duration: service.duration_min, busy: busyQ.data, timeZone: salon.timezone })
        : [],
    [day, service, busyQ.data, salon],
  );

  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!service || !member || !slot) return;
    setBusy(true);
    const { error } = await supabase.rpc("create_public_booking", {
      _salon: salon.id,
      _service: service.id,
      _staff: member.id,
      _starts: slot.toISOString(),
      _name: form.name,
      _phone: form.phone,
      _email: form.email,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      setSlot(undefined);
      busyQ.refetch();
      return;
    }
    setDone(slot);
  }

  if (done && service && member) {
    return (
      <Shell salon={salon}>
        <div className="surface p-8 text-center">
          <div className="mx-auto grid size-14 place-items-center rounded-full bg-success-soft text-success"><Check className="size-7" /></div>
          <h2 className="mt-4 text-3xl font-semibold">You're booked!</h2>
          <p className="mt-2 text-muted-foreground">{service.name} with {member.name}</p>
          <p className="mt-1 text-lg font-semibold">{fmtDateTime(done)}</p>
          <Button className="mt-6" variant="outline" onClick={() => { setDone(undefined); setSlot(undefined); setServiceId(undefined); setStaffId(undefined); setDay(undefined); }}>Book another</Button>
        </div>
      </Shell>
    );
  }

  return (
    <Shell salon={salon}>
      <Steps step={step} />
      {step > 1 && (
        <button className="mb-4 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground" onClick={() => (step === 4 ? setSlot(undefined) : step === 3 ? setStaffId(undefined) : setServiceId(undefined))}>
          <ArrowLeft className="size-4" /> Back
        </button>
      )}

      {step === 1 && (
        <Section title="Choose a service">
          {services.length === 0 && <p className="text-muted-foreground">No services yet.</p>}
          <div className="grid gap-3">
            {services.map((s) => (
              <button key={s.id} onClick={() => setServiceId(s.id)} className="surface flex items-center justify-between p-4 text-left transition hover:shadow-lift">
                <div>
                  <p className="font-semibold">{s.name}</p>
                  <p className="flex items-center gap-1 text-sm text-muted-foreground"><Clock className="size-3.5" />{s.duration_min} min</p>
                </div>
                <span className="font-display text-lg font-semibold">{money(s.price)}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {step === 2 && (
        <Section title="Who would you like?">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {staff.map((m) => (
              <button key={m.id} onClick={() => { setStaffId(m.id); setDay(days[0]); }} className="surface flex flex-col items-center p-5 transition hover:shadow-lift">
                <span className="grid size-14 place-items-center rounded-full bg-copper-soft font-display text-xl font-semibold text-primary">{m.name.charAt(0)}</span>
                <span className="mt-3 font-semibold">{m.name}</span>
              </button>
            ))}
          </div>
        </Section>
      )}

      {step === 3 && (
        <Section title="Pick a time">
          <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-2">
            {days.map((d) => (
              <button key={d.toISOString()} onClick={() => setDay(d)} className={cn("flex min-w-16 flex-col items-center rounded-xl border px-3 py-2 text-sm transition", day?.getTime() === d.getTime() ? "border-primary bg-primary text-primary-foreground" : "bg-card hover:border-copper")}>
                <span className="text-xs uppercase opacity-80">{format(d, "EEE")}</span>
                <span className="text-lg font-semibold">{format(d, "d")}</span>
                <span className="text-xs opacity-80">{format(d, "MMM")}</span>
              </button>
            ))}
          </div>
          <div className="mt-4">
            {busyQ.isLoading ? (
              <p className="text-muted-foreground">Checking availability…</p>
            ) : slots.length === 0 ? (
              <p className="text-muted-foreground">No free times this day — try another.</p>
            ) : (
              <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
                {slots.map((t) => (
                  <button key={t.toISOString()} onClick={() => setSlot(t)} className="rounded-lg border bg-card py-2.5 text-sm font-semibold transition hover:border-copper hover:text-copper">
                    {format(t, "HH:mm")}
                  </button>
                ))}
              </div>
            )}
          </div>
        </Section>
      )}

      {step === 4 && service && member && slot && (
        <Section title="Your details">
          <div className="surface mb-4 p-4 text-sm">
            <p className="font-semibold">{service.name} · {money(service.price)}</p>
            <p className="text-muted-foreground">with {member.name} · {fmtDateTime(slot)} · {service.duration_min} min</p>
          </div>
          <form onSubmit={book} className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="n">Name</Label><Input id="n" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="space-y-1.5"><Label htmlFor="p">Phone</Label><Input id="p" type="tel" required value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+90 5xx xxx xx xx" /></div>
            <div className="space-y-1.5"><Label htmlFor="e">Email</Label><Input id="e" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            <Button type="submit" variant="copper" size="lg" className="w-full" disabled={busy}>{busy ? "Booking…" : "Confirm booking"}</Button>
          </form>
        </Section>
      )}
    </Shell>
  );
}

function Shell({ salon, children }: { salon: { name: string; address: string | null; phone: string | null }; children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <div className="bg-primary px-5 pb-16 pt-10 text-primary-foreground">
        <div className="mx-auto max-w-2xl">
          <p className="text-xs font-bold uppercase tracking-[0.14em] opacity-70">Online booking</p>
          <h1 className="mt-2 text-4xl font-semibold">{salon.name}</h1>
          <div className="mt-3 flex flex-wrap gap-4 text-sm opacity-80">
            {salon.address && <span className="flex items-center gap-1"><MapPin className="size-4" />{salon.address}</span>}
            {salon.phone && <span className="flex items-center gap-1"><Phone className="size-4" />{salon.phone}</span>}
          </div>
        </div>
      </div>
      <div className="mx-auto -mt-10 max-w-2xl px-4 pb-16">{children}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-4 text-2xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Steps({ step }: { step: number }) {
  const labels = ["Service", "Stylist", "Time", "Details"];
  return (
    <div className="surface mb-6 flex justify-between p-3">
      {labels.map((l, i) => (
        <div key={l} className={cn("flex items-center gap-2 text-xs font-semibold sm:text-sm", i + 1 <= step ? "text-foreground" : "text-muted-foreground")}>
          <span className={cn("grid size-6 place-items-center rounded-full text-xs", i + 1 < step ? "bg-success text-copper-foreground" : i + 1 === step ? "bg-copper text-copper-foreground" : "bg-muted")}>
            {i + 1 < step ? <Check className="size-3.5" /> : i + 1}
          </span>
          <span className="hidden sm:inline">{l}</span>
        </div>
      ))}
    </div>
  );
}
