import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Me = {
  userId: string;
  email: string;
  salon: Tables<"salons"> | null;
  myStaff: Tables<"staff"> | null;
  isOwner: boolean;
};

export const meQueryKey = ["me"];

async function fetchMe(): Promise<Me | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  await supabase.rpc("claim_staff_invites");
  const { data: owned } = await supabase
    .from("salons")
    .select("*")
    .eq("owner_id", user.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  const { data: staffRows } = await supabase
    .from("staff")
    .select("*")
    .eq("user_id", user.id)
    .eq("active", true);
  let salon = owned ?? null;
  if (!salon && staffRows?.length) {
    const r = await supabase.from("salons").select("*").eq("id", staffRows[0].salon_id).maybeSingle();
    salon = r.data ?? null;
  }
  const myStaff = staffRows?.find((s) => s.salon_id === salon?.id) ?? null;
  return {
    userId: user.id,
    email: user.email ?? "",
    salon,
    myStaff,
    isOwner: !!owned && salon?.id === owned.id,
  };
}

export function useMe() {
  return useQuery({ queryKey: meQueryKey, queryFn: fetchMe, staleTime: 60_000 });
}

/** Use inside the signed-in area where salon is guaranteed. */
export function useSalon() {
  const { data } = useMe();
  return data as Me & { salon: Tables<"salons"> };
}
