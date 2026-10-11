import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const MODEL = "openai/gpt-6-astra";

async function generate(instructions: string, input: string): Promise<string> {
  const key = process.env["LOVABLE_API_KEY"];
  if (!key) throw new Error("AI is not configured for this app.");
  const res = await fetch("https://ai.gateway.lovable.dev/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${key}`,
      "Lovable-API-Key": key,
      "X-Lovable-AIG-SDK": "fetch",
    },
    body: JSON.stringify({
      model: MODEL,
      instructions,
      input: [{ role: "user", content: input }],
      reasoning: { effort: "low" },
      store: false,
      stream: true,
    }),
  });
  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => "");
    console.error("AI gateway error", res.status, body);
    let msg = "";
    try {
      msg = JSON.parse(body)?.error?.message ?? JSON.parse(body)?.message ?? "";
    } catch {
      /* ignore */
    }
    if (res.status === 429) throw new Error("The AI is busy right now. Please try again in a moment.");
    if (res.status === 402) throw new Error(msg || "AI credits have run out. Add credits in your workspace settings.");
    if (res.status === 403) throw new Error(msg || "AI access is not available for this workspace.");
    throw new Error("The AI couldn't respond. Please try again.");
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const ev = JSON.parse(payload);
          if (ev.type === "response.output_text.delta") text += ev.delta ?? "";
          else if (ev.type === "response.failed" || ev.type === "error") {
            console.error("AI stream error", payload);
            throw new Error("The AI couldn't finish. Please try again.");
          }
        } catch (e) {
          if (e instanceof Error && e.message.startsWith("The AI")) throw e;
        }
      }
    }
  }
  if (!text.trim()) throw new Error("The AI returned no text. Please try again.");
  return text.trim();
}

async function loadCustomer(supabase: any, customerId: string) {
  const { data: customer, error } = await supabase
    .from("customers")
    .select("id, name, phone, email, salon_id, salons(name, address, phone)")
    .eq("id", customerId)
    .maybeSingle();
  if (error || !customer) throw new Error("Customer not found");
  const { data: bookings } = await supabase
    .from("bookings")
    .select("service_name, price, starts_at, status, staff:staff(name)")
    .eq("customer_id", customerId)
    .order("starts_at", { ascending: false })
    .limit(30);
  const { data: notes } = await supabase
    .from("customer_notes")
    .select("body, author_name, created_at")
    .eq("customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(40);
  return { customer, bookings: bookings ?? [], notes: notes ?? [] };
}

const fmt = (d: string) =>
  new Date(d).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Istanbul" });

export const summarizeCustomer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customerId: string }) => ({ customerId: String(d.customerId) }))
  .handler(async ({ data, context }) => {
    const { customer, bookings, notes } = await loadCustomer(context.supabase, data.customerId);
    const now = Date.now();
    const history = bookings
      .map((b: any) => `- ${fmt(b.starts_at)}: ${b.service_name} with ${b.staff?.name ?? "?"} (${b.status}${new Date(b.starts_at).getTime() > now ? ", upcoming" : ""})`)
      .join("\n");
    const noteText = notes.map((n: any) => `- [${fmt(n.created_at)}${n.author_name ? `, ${n.author_name}` : ""}] ${n.body}`).join("\n");
    const summary = await generate(
      "You brief hairdressers and barbers right before a client's appointment. Write a short, practical briefing in plain text (no markdown symbols like ** or #). Use 3-6 short lines starting with '• '. Cover: upcoming appointment, usual services and frequency, preferences and anything to remember from notes, and one friendly conversation tip if the notes allow. Never invent facts; if data is thin, say so briefly.",
      `Client: ${customer.name}\nVisits (newest first):\n${history || "none"}\n\nTeam notes (newest first):\n${noteText || "none"}`,
    );
    return { summary };
  });

export const writeReminder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { customerId: string }) => ({ customerId: String(d.customerId) }))
  .handler(async ({ data, context }) => {
    const { customer, bookings, notes } = await loadCustomer(context.supabase, data.customerId);
    const upcoming = [...bookings]
      .filter((b: any) => b.status === "booked" && new Date(b.starts_at).getTime() > Date.now())
      .sort((a: any, b: any) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime())[0];
    const salon = customer.salons ?? {};
    const message = await generate(
      "You write short, warm appointment reminder messages for a hair salon or barbershop, to be sent by WhatsApp or SMS. Max 320 characters. Plain text, at most one emoji, no markdown. Address the client by first name, include the date, time, service and stylist, sign off with the salon name. If there is no upcoming appointment, write a friendly message inviting them to book again. Write in the language that best fits the client's name and notes; default to English. Never invent details.",
      `Salon: ${salon.name ?? ""}${salon.address ? `, ${salon.address}` : ""}${salon.phone ? `, phone ${salon.phone}` : ""}\nClient: ${customer.name}\nUpcoming: ${upcoming ? `${fmt(upcoming.starts_at)} — ${upcoming.service_name} with ${upcoming.staff?.name ?? ""}` : "none"}\nRecent notes: ${notes.slice(0, 5).map((n: any) => n.body).join(" | ") || "none"}`,
    );
    return { message };
  });
