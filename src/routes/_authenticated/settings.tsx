import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSalon, meQueryKey } from "@/hooks/use-me";
import { useServices, useStaffList } from "@/hooks/use-bookings";
import { money, slugify } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/settings")({
  head: () => ({ meta: [{ title: "Settings — Chairside" }, { name: "description", content: "Salon details, services and staff." }, { property: "og:title", content: "Settings — Chairside" }, { property: "og:description", content: "Salon details, services and staff." }] }),
  component: SettingsPage,
});

function SettingsPage() {
  const me = useSalon();
  if (!me.isOwner) return <p className="text-muted-foreground">Only the salon owner can change settings.</p>;
  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold">Settings</h1>
      <Tabs defaultValue="services">
        <TabsList>
          <TabsTrigger value="services">Services</TabsTrigger>
          <TabsTrigger value="staff">Staff</TabsTrigger>
          <TabsTrigger value="salon">Salon & hours</TabsTrigger>
        </TabsList>
        <TabsContent value="services" className="mt-4"><ServicesTab /></TabsContent>
        <TabsContent value="staff" className="mt-4"><StaffTab /></TabsContent>
        <TabsContent value="salon" className="mt-4"><SalonTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function ServicesTab() {
  const me = useSalon();
  const qc = useQueryClient();
  const { data = [] } = useServices(me.salon.id);
  const [f, setF] = useState({ name: "", price: "", duration: "30" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["services", me.salon.id] });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("services").insert({ salon_id: me.salon.id, name: f.name, price: Number(f.price || 0), duration_min: Number(f.duration || 30) });
    if (error) return toast.error(error.message);
    setF({ name: "", price: "", duration: "30" });
    refresh();
  }
  async function update(id: string, patch: { active?: boolean }) {
    const { error } = await supabase.from("services").update(patch).eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  }
  async function remove(id: string) {
    const { error } = await supabase.from("services").delete().eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="surface grid gap-3 p-4 sm:grid-cols-[1fr_120px_120px_auto] sm:items-end">
        <div className="space-y-1.5"><Label>Service</Label><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Skin fade" /></div>
        <div className="space-y-1.5"><Label>Price</Label><Input type="number" min="0" required value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Minutes</Label><Input type="number" min="5" step="5" required value={f.duration} onChange={(e) => setF({ ...f, duration: e.target.value })} /></div>
        <Button type="submit"><Plus /> Add</Button>
      </form>
      <div className="surface divide-y">
        {data.length === 0 && <p className="p-6 text-center text-muted-foreground">Add your first service above.</p>}
        {data.map((s) => (
          <div key={s.id} className={cn("flex items-center gap-3 p-4", !s.active && "opacity-60")}>
            <div className="min-w-0 flex-1"><p className="font-medium">{s.name}</p><p className="text-sm text-muted-foreground">{s.duration_min} min · {money(s.price)}</p></div>
            <Switch checked={s.active} onCheckedChange={(v) => update(s.id, { active: v })} aria-label="Bookable" />
            <Button variant="ghost" size="icon" onClick={() => remove(s.id)} aria-label="Delete"><Trash2 /></Button>
          </div>
        ))}
      </div>
    </div>
  );
}

function StaffTab() {
  const me = useSalon();
  const qc = useQueryClient();
  const { data = [] } = useStaffList(me.salon.id);
  const [f, setF] = useState({ name: "", email: "" });
  const refresh = () => qc.invalidateQueries({ queryKey: ["staff", me.salon.id] });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from("staff").insert({ salon_id: me.salon.id, name: f.name, email: f.email.trim().toLowerCase() || null });
    if (error) return toast.error(error.message);
    setF({ name: "", email: "" });
    toast.success(f.email ? "Added. They can now sign up with that email to see their calendar." : "Added");
    refresh();
  }
  async function toggle(id: string, active: boolean) {
    const { error } = await supabase.from("staff").update({ active }).eq("id", id);
    if (error) return toast.error(error.message);
    refresh();
  }

  return (
    <div className="space-y-4">
      <form onSubmit={add} className="surface grid gap-3 p-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <div className="space-y-1.5"><Label>Name</Label><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Emre" /></div>
        <div className="space-y-1.5"><Label>Email (for their login)</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="emre@example.com" /></div>
        <Button type="submit"><Plus /> Add</Button>
      </form>
      <div className="surface divide-y">
        {data.map((s) => (
          <div key={s.id} className={cn("flex items-center gap-3 p-4", !s.active && "opacity-60")}>
            <span className="grid size-10 place-items-center rounded-full bg-copper-soft font-semibold">{s.name.charAt(0)}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">{s.name} {s.role === "owner" && <Badge variant="secondary" className="ml-1">Owner</Badge>}</p>
              <p className="truncate text-sm text-muted-foreground">{s.email ?? "No login"}{s.email && (s.user_id ? " · linked" : " · waiting for sign-up")}</p>
            </div>
            <Switch checked={s.active} onCheckedChange={(v) => toggle(s.id, v)} aria-label="Active" />
          </div>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Turn a staff member off to hide them from the booking page and remove their access.</p>
    </div>
  );
}

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function SalonTab() {
  const me = useSalon();
  const qc = useQueryClient();
  const s = me.salon;
  const [f, setF] = useState({
    name: s.name,
    slug: s.slug,
    address: s.address ?? "",
    phone: s.phone ?? "",
    open_time: s.open_time.slice(0, 5),
    close_time: s.close_time.slice(0, 5),
    open_days: s.open_days,
  });
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.close_time <= f.open_time) return toast.error("Closing time must be after opening time");
    setSaving(true);
    const { error } = await supabase.from("salons").update({ ...f, slug: slugify(f.slug), address: f.address || null, phone: f.phone || null }).eq("id", s.id);
    setSaving(false);
    if (error) return toast.error(error.message.includes("duplicate") ? "That booking link is taken." : error.message);
    toast.success("Saved");
    qc.invalidateQueries({ queryKey: meQueryKey });
  }

  return (
    <form onSubmit={save} className="surface max-w-xl space-y-4 p-5">
      <div className="space-y-1.5"><Label>Salon name</Label><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
      <div className="space-y-1.5"><Label>Booking link</Label>
        <div className="flex items-center rounded-md border border-input bg-background pl-3 text-sm text-muted-foreground">/book/<input className="h-9 flex-1 bg-transparent px-1 text-foreground outline-none" value={f.slug} onChange={(e) => setF({ ...f, slug: slugify(e.target.value) })} /></div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5"><Label>Address</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Phone</Label><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5"><Label>Opens</Label><Input type="time" value={f.open_time} onChange={(e) => setF({ ...f, open_time: e.target.value })} /></div>
        <div className="space-y-1.5"><Label>Closes</Label><Input type="time" value={f.close_time} onChange={(e) => setF({ ...f, close_time: e.target.value })} /></div>
      </div>
      <div className="space-y-1.5">
        <Label>Open days</Label>
        <div className="flex flex-wrap gap-2">
          {DAYS.map((d, i) => {
            const n = i + 1;
            const on = f.open_days.includes(n);
            return (
              <button type="button" key={d} onClick={() => setF({ ...f, open_days: on ? f.open_days.filter((x) => x !== n) : [...f.open_days, n].sort() })} className={cn("rounded-full border px-3.5 py-1.5 text-sm font-medium", on ? "border-primary bg-primary text-primary-foreground" : "bg-card text-muted-foreground")}>{d}</button>
            );
          })}
        </div>
      </div>
      <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Save changes"}</Button>
    </form>
  );
}
