import { createFileRoute, Link } from "@tanstack/react-router";
import { CalendarCheck, Users, BarChart3, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import hero from "@/assets/salon-hero.jpg";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Chairside — Online booking for salons & barbershops" },
      { name: "description", content: "Give your salon a booking page, staff calendars, customer notes and AI reminders in minutes." },
      { property: "og:title", content: "Chairside — Online booking for salons & barbershops" },
      { property: "og:description", content: "Give your salon a booking page, staff calendars, customer notes and AI reminders in minutes." },
    ],
  }),
  component: Landing,
});

const features = [
  { icon: CalendarCheck, title: "Your own booking page", text: "Clients pick a service, a stylist and a free slot — 24/7." },
  { icon: Users, title: "Staff calendars", text: "Each barber or stylist sees their own day and week." },
  { icon: BarChart3, title: "Clear numbers", text: "Weekly revenue and your most popular services at a glance." },
  { icon: Wand2, title: "AI assistant", text: "Client briefings before appointments and friendly reminders." },
];

function Landing() {
  return (
    <div className="min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-5">
        <Logo />
        <div className="flex gap-2">
          <Button variant="ghost" asChild><Link to="/auth">Sign in</Link></Button>
          <Button asChild><Link to="/auth" search={{ mode: "signup" }}>Get started</Link></Button>
        </div>
      </header>
      <main className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-6 md:grid-cols-2 md:pt-12">
        <div>
          <p className="eyebrow">For salons & barbershops</p>
          <h1 className="mt-4 text-5xl font-semibold leading-[1.05] md:text-6xl">
            A full chair, <span className="italic text-copper">without</span> the phone calls.
          </h1>
          <p className="mt-5 max-w-md text-lg text-muted-foreground">
            Set up your salon, staff and services in minutes. Share your booking link and let clients book themselves.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Button size="lg" variant="copper" asChild><Link to="/auth" search={{ mode: "signup" }}>Create your salon — free</Link></Button>
            <Button size="lg" variant="outline" asChild><Link to="/auth">I'm a staff member</Link></Button>
          </div>
        </div>
        <div className="relative">
          <img src={hero} alt="Calm modern salon interior with a barber chair" width={1280} height={1024} className="aspect-[5/4] w-full rounded-3xl object-cover shadow-lift" />
          <div className="surface absolute -bottom-6 left-4 right-4 flex items-center gap-3 p-4 md:left-auto md:right-6 md:w-72">
            <div className="grid size-10 place-items-center rounded-full bg-success-soft text-success"><CalendarCheck className="size-5" /></div>
            <div className="text-sm">
              <p className="font-semibold">New booking · 14:30</p>
              <p className="text-muted-foreground">Skin fade with Emre</p>
            </div>
          </div>
        </div>
      </main>
      <section className="mx-auto grid max-w-6xl gap-4 px-5 py-16 sm:grid-cols-2 lg:grid-cols-4">
        {features.map((f) => (
          <div key={f.title} className="surface p-6">
            <f.icon className="size-6 text-copper" />
            <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm text-muted-foreground">{f.text}</p>
          </div>
        ))}
      </section>
      <footer className="border-t py-8 text-center text-sm text-muted-foreground">© Chairside</footer>
    </div>
  );
}

export function Logo() {
  return (
    <Link to="/" className="flex items-center gap-2">
      <span className="grid size-8 place-items-center rounded-full bg-primary font-display text-lg text-primary-foreground">C</span>
      <span className="font-display text-xl font-semibold">Chairside</span>
    </Link>
  );
}
