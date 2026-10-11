import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Logo } from "./index";

export const Route = createFileRoute("/auth")({
  validateSearch: (s: Record<string, unknown>) => ({ mode: s["mode"] === "signup" ? "signup" : undefined }) as { mode?: "signup" },
  head: () => ({
    meta: [
      { title: "Sign in — Chairside" },
      { name: "description", content: "Sign in or create your Chairside salon account." },
      { property: "og:title", content: "Sign in — Chairside" },
      { property: "og:description", content: "Sign in or create your Chairside salon account." },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">(search.mode === "signup" ? "signup" : "signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate({ to: "/dashboard", replace: true });
    });
    const { data } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session) navigate({ to: "/dashboard", replace: true });
    });
    return () => data.subscription.unsubscribe();
  }, [navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin + "/dashboard" },
        });
        if (error) throw error;
        if (!data.session) setSent(true);
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/auth" });
    if (r.error) toast.error(r.error.message ?? "Google sign-in failed");
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-5 py-10">
      <Logo />
      <div className="surface mt-8 w-full max-w-sm p-6">
        {sent ? (
          <div className="text-center">
            <h1 className="text-2xl font-semibold">Check your email</h1>
            <p className="mt-2 text-sm text-muted-foreground">We sent a confirmation link to {email}. Click it to finish signing up.</p>
          </div>
        ) : (
          <>
            <h1 className="text-2xl font-semibold">{mode === "signup" ? "Create your account" : "Welcome back"}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {mode === "signup" ? "Owners and invited staff can both sign up here." : "Sign in to your salon."}
            </p>
            <Button variant="outline" className="mt-6 w-full" onClick={google}>Continue with Google</Button>
            <div className="my-4 flex items-center gap-3 text-xs text-muted-foreground"><span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" /></div>
            <form onSubmit={submit} className="space-y-3">
              <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="pw">Password</Label><Input id="pw" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              <Button type="submit" className="w-full" disabled={busy}>{busy ? "Please wait…" : mode === "signup" ? "Sign up" : "Sign in"}</Button>
            </form>
            <button className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>
              {mode === "signup" ? "Already have an account? Sign in" : "New here? Create an account"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
