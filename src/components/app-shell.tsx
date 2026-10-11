import { Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { BarChart3, CalendarDays, ClipboardList, LogOut, Settings, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useMe, meQueryKey } from "@/hooks/use-me";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { slugify } from "@/lib/format";

export function AppShell() {
  const { data: me, isLoading } = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();

  async function signOut() {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  if (isLoading || !me) {
    return <div className="grid min-h-screen place-items-center text-muted-foreground">Loading…</div>;
  }
  if (!me.salon) return <Onboarding onSignOut={signOut} email={me.email} />;

  const nav = [
    { to: "/dashboard", label: "Home", icon: BarChart3 },
    { to: "/calendar", label: "Calendar", icon: CalendarDays },
    ...(me.isOwner ? [{ to: "/bookings", label: "Bookings", icon: ClipboardList }] : []),
    { to: "/customers", label: "Clients", icon: Users },
    ...(me.isOwner ? [{ to: "/settings", label: "Settings", icon: Settings }] : []),
  ] as const;

  return (
    <div className="min-h-screen pb-24 md:pb-0">
      <header className="sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-6 px-4">
          <Link to="/dashboard" className="flex items-center gap-2">
            <span className="grid size-8 place-items-center rounded-full bg-primary font-display text-lg text-primary-foreground">
              {me.salon.name.charAt(0).toUpperCase()}
            </span>
            <span className="max-w-[12rem] truncate font-display text-lg font-semibold">{me.salon.name}</span>
          </Link>
          <nav className="hidden flex-1 gap-1 md:flex">
            {nav.map((n) => (
              <Link
                key={n.to}
                to={n.to}
                className="rounded-full px-3.5 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
                activeProps={{ className: "bg-secondary text-foreground" }}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={signOut}>
            <LogOut /> <span className="hidden sm:inline">Sign out</span>
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 md:py-10">
        <Outlet />
      </main>
      <nav className="fixed inset-x-0 bottom-0 z-30 border-t bg-card/95 backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md justify-around px-2 pb-[env(safe-area-inset-bottom)]">
          {nav.map((n) => (
            <Link
              key={n.to}
              to={n.to}
              className="flex flex-1 flex-col items-center gap-0.5 py-2.5 text-[11px] font-medium text-muted-foreground"
              activeProps={{ className: "text-copper" }}
            >
              <n.icon className="size-5" />
              {n.label}
            </Link>
          ))}
        </div>
      </nav>
    </div>
  );
}

function Onboarding({ onSignOut, email }: { onSignOut: () => void; email: string }) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [owner, setOwner] = useState("");
  const [busy, setBusy] = useState(false);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.rpc("create_salon", { _name: name, _slug: slug || slugify(name), _owner_name: owner });
    setBusy(false);
    if (error) {
      toast.error(error.message.includes("duplicate") ? "That booking link is taken — try another." : error.message);
      return;
    }
    toast.success("Your salon is ready!");
    qc.invalidateQueries({ queryKey: meQueryKey });
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <p className="eyebrow">Step 1 of 1</p>
        <h1 className="mt-2 text-4xl font-semibold">Set up your salon</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Signed in as {email}. If you're a staff member, ask the owner to add this email under Settings → Staff, then refresh.
        </p>
        <form onSubmit={create} className="surface mt-6 space-y-4 p-6">
          <div className="space-y-1.5">
            <Label htmlFor="sn">Salon name</Label>
            <Input id="sn" required value={name} onChange={(e) => { setName(e.target.value); setSlug(slugify(e.target.value)); }} placeholder="Atelier Hair & Beard" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="sl">Booking link</Label>
            <div className="flex items-center rounded-md border border-input bg-background pl-3 text-sm text-muted-foreground">
              /book/
              <input id="sl" required className="h-9 flex-1 bg-transparent px-1 text-foreground outline-none" value={slug} onChange={(e) => setSlug(slugify(e.target.value))} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="on">Your name</Label>
            <Input id="on" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="So clients can book with you too" />
          </div>
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Create salon"}</Button>
          <div className="flex justify-between text-sm">
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={() => qc.invalidateQueries({ queryKey: meQueryKey })}>I was invited — refresh</button>
            <button type="button" className="text-muted-foreground hover:text-foreground" onClick={onSignOut}>Sign out</button>
          </div>
        </form>
      </div>
    </div>
  );
}
