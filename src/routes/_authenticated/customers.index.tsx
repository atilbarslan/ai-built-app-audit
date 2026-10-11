import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Search } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSalon } from "@/hooks/use-me";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/_authenticated/customers/")({
  head: () => ({ meta: [{ title: "Clients — Chairside" }, { name: "description", content: "Your salon's clients." }, { property: "og:title", content: "Clients — Chairside" }, { property: "og:description", content: "Your salon's clients." }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const me = useSalon();
  const [q, setQ] = useState("");
  const { data = [], isLoading } = useQuery({
    queryKey: ["customers", me.salon.id],
    queryFn: async () => {
      const { data, error } = await supabase.from("customers").select("*").eq("salon_id", me.salon.id).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
  const rows = data.filter((c) => `${c.name} ${c.phone} ${c.email ?? ""}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-5">
      <h1 className="text-3xl font-semibold">Clients</h1>
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input className="bg-card pl-9" placeholder="Search by name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {isLoading && <p className="text-muted-foreground">Loading…</p>}
      {!isLoading && rows.length === 0 && <div className="surface p-8 text-center text-muted-foreground">No clients yet — they appear here after their first booking.</div>}
      <div className="surface divide-y">
        {rows.map((c) => (
          <Link key={c.id} to="/customers/$id" params={{ id: c.id }} className="flex items-center gap-3 p-4 transition hover:bg-muted/60">
            <span className="grid size-10 place-items-center rounded-full bg-copper-soft font-semibold">{c.name.charAt(0)}</span>
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{c.name}</span>
              <span className="block truncate text-sm text-muted-foreground">{c.phone}{c.email ? ` · ${c.email}` : ""}</span>
            </span>
          </Link>
        ))}
      </div>
    </div>
  );
}
