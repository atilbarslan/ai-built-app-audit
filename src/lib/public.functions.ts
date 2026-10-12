import { createServerFn } from "@tanstack/react-start";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export type PublicSalon = {
  salon: {
    id: string;
    name: string;
    slug: string;
    address: string | null;
    phone: string | null;
    open_time: string;
    close_time: string;
    open_days: number[];
    timezone: string;
  };
  services: { id: string; name: string; price: number; duration_min: number }[];
  staff: { id: string; name: string }[];
};

export const getPublicSalon = createServerFn({ method: "GET" })
  .inputValidator((d: { slug: string }) => ({ slug: String(d.slug).slice(0, 60) }))
  .handler(async ({ data }) => {
    const key = process.env["SUPABASE_PUBLISHABLE_KEY"]!;
    const sb = createClient<Database>(process.env["SUPABASE_URL"]!, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: {
        fetch: (input, init) => {
          const h = new Headers(init?.headers);
          if (key.startsWith("sb_") && h.get("Authorization") === `Bearer ${key}`) h.delete("Authorization");
          h.set("apikey", key);
          return fetch(input, { ...init, headers: h });
        },
      },
    });
    const { data: res, error } = await sb.rpc("get_public_salon", { _slug: data.slug });
    if (error) {
      console.error(error);
      throw new Error("Could not load salon");
    }
    return (res as unknown as PublicSalon) ?? null;
  });
