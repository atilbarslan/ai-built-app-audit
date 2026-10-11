import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Copy, Mail, MessageCircle, MessageSquareText, Phone, Trash2, Wand2, NotebookPen } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useSalon } from "@/hooks/use-me";
import { summarizeCustomer, writeReminder } from "@/lib/ai.functions";
import { fmtDateTime, money, phoneDigits } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/customers/$id")({
  head: () => ({ meta: [{ title: "Client — Chairside" }, { name: "description", content: "Client history, notes and AI briefing." }, { property: "og:title", content: "Client — Chairside" }, { property: "og:description", content: "Client history, notes and AI briefing." }] }),
  component: CustomerPage,
});

function CustomerPage() {
  const { id } = Route.useParams();
  const me = useSalon();
  const qc = useQueryClient();
  const summarize = useServerFn(summarizeCustomer);
  const remind = useServerFn(writeReminder);
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<string>();
  const [reminder, setReminder] = useState<string>();
  const [aiBusy, setAiBusy] = useState<"summary" | "reminder">();

  const custQ = useQuery({
    queryKey: ["customer", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const histQ = useQuery({
    queryKey: ["customer-bookings", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("bookings").select("*, staff:staff(name)").eq("customer_id", id).order("starts_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
  const notesQ = useQuery({
    queryKey: ["notes", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("customer_notes").select("*").eq("customer_id", id).order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const c = custQ.data;
  if (custQ.isLoading) return <p className="text-muted-foreground">Loading…</p>;
  if (!c) return <p className="text-muted-foreground">Client not found.</p>;

  const visits = histQ.data ?? [];
  const now = Date.now();
  const upcoming = visits.filter((b) => b.status === "booked" && new Date(b.starts_at).getTime() > now).reverse();
  const past = visits.filter((b) => !(b.status === "booked" && new Date(b.starts_at).getTime() > now));
  const spent = past.filter((b) => b.status === "booked").reduce((a, b) => a + Number(b.price), 0);

  async function addNote(e: React.FormEvent) {
    e.preventDefault();
    if (!note.trim()) return;
    const { error } = await supabase.from("customer_notes").insert({ salon_id: me.salon.id, customer_id: id, body: note.trim(), author_name: me.myStaff?.name ?? null });
    if (error) return toast.error(error.message);
    setNote("");
    qc.invalidateQueries({ queryKey: ["notes", id] });
  }
  async function delNote(nid: string) {
    const { error } = await supabase.from("customer_notes").delete().eq("id", nid);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["notes", id] });
  }
  async function runSummary() {
    setAiBusy("summary");
    try {
      const r = await summarize({ data: { customerId: id } });
      setSummary(r.summary);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(undefined);
    }
  }
  async function runReminder() {
    setAiBusy("reminder");
    try {
      const r = await remind({ data: { customerId: id } });
      setReminder(r.message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setAiBusy(undefined);
    }
  }

  const digits = phoneDigits(c.phone);

  return (
    <div className="space-y-6">
      <Link to="/customers" className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" /> Clients</Link>

      <div className="surface flex flex-wrap items-center gap-4 p-5">
        <span className="grid size-14 place-items-center rounded-full bg-copper-soft font-display text-2xl font-semibold">{c.name.charAt(0)}</span>
        <div className="min-w-0 flex-1">
          <h1 className="text-3xl font-semibold">{c.name}</h1>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <a href={`tel:${c.phone}`} className="flex items-center gap-1 hover:text-foreground"><Phone className="size-3.5" />{c.phone}</a>
            {c.email && <a href={`mailto:${c.email}`} className="flex items-center gap-1 hover:text-foreground"><Mail className="size-3.5" />{c.email}</a>}
          </div>
        </div>
        <div className="flex gap-6 text-sm">
          <div><p className="text-muted-foreground">Visits</p><p className="font-display text-xl font-semibold">{past.filter((b) => b.status === "booked").length}</p></div>
          {me.isOwner && <div><p className="text-muted-foreground">Spent</p><p className="font-display text-xl font-semibold">{money(spent)}</p></div>}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Button variant="copper" size="lg" onClick={runSummary} disabled={!!aiBusy}><Wand2 /> {aiBusy === "summary" ? "Preparing briefing…" : "AI briefing before appointment"}</Button>
        <Button variant="soft" size="lg" onClick={runReminder} disabled={!!aiBusy}><MessageSquareText /> {aiBusy === "reminder" ? "Writing…" : "AI reminder message"}</Button>
      </div>

      {summary && (
        <section className="surface border-copper/40 p-5">
          <p className="eyebrow">AI briefing</p>
          <p className="mt-2 whitespace-pre-wrap leading-relaxed">{summary}</p>
        </section>
      )}

      {reminder !== undefined && (
        <section className="surface p-5">
          <p className="eyebrow">Reminder message</p>
          <Textarea className="mt-2 min-h-28 bg-background" value={reminder} onChange={(e) => setReminder(e.target.value)} />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(reminder); toast.success("Copied"); }}><Copy /> Copy</Button>
            <Button size="sm" asChild><a href={`https://wa.me/${digits}?text=${encodeURIComponent(reminder)}`} target="_blank" rel="noreferrer"><MessageCircle /> WhatsApp</a></Button>
            <Button size="sm" variant="secondary" asChild><a href={`sms:${c.phone}?&body=${encodeURIComponent(reminder)}`}><MessageSquareText /> SMS</a></Button>
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="surface p-5">
          <h2 className="flex items-center gap-2 text-xl font-semibold"><NotebookPen className="size-5 text-copper" /> Notes</h2>
          <form onSubmit={addNote} className="mt-3 space-y-2">
            <Textarea placeholder="Preferences, formulas, allergies, chat topics…" value={note} onChange={(e) => setNote(e.target.value)} className="bg-background" />
            <Button type="submit" size="sm" disabled={!note.trim()}>Add note</Button>
          </form>
          <div className="mt-4 space-y-3">
            {notesQ.data?.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
            {notesQ.data?.map((n) => (
              <div key={n.id} className="group rounded-lg bg-muted/70 p-3">
                <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                <div className="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{n.author_name ?? "Team"} · {fmtDateTime(n.created_at)}</span>
                  {(n.author_id === me.userId || me.isOwner) && (
                    <button onClick={() => delNote(n.id)} className="opacity-60 hover:text-destructive hover:opacity-100" aria-label="Delete note"><Trash2 className="size-3.5" /></button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="surface p-5">
          <h2 className="text-xl font-semibold">Appointments</h2>
          {upcoming.length > 0 && (
            <div className="mt-3 space-y-2">
              {upcoming.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg bg-copper-soft p-3 text-sm">
                  <span><span className="font-semibold">{fmtDateTime(b.starts_at)}</span> · {b.service_name} · {(b.staff as { name: string } | null)?.name}</span>
                  <Badge>Upcoming</Badge>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 divide-y">
            {past.length === 0 && <p className="text-sm text-muted-foreground">No past visits.</p>}
            {past.map((b) => (
              <div key={b.id} className="flex items-center justify-between py-2.5 text-sm">
                <span><span className="font-medium">{fmtDateTime(b.starts_at)}</span> · {b.service_name} · <span className="text-muted-foreground">{(b.staff as { name: string } | null)?.name}</span></span>
                {b.status === "cancelled" ? <Badge variant="secondary">Cancelled</Badge> : <span className="text-muted-foreground">{money(b.price)}</span>}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
