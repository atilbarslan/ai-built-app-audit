import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type BookingRow = {
  id: string;
  salon_id: string;
  staff_id: string;
  service_id: string | null;
  customer_id: string;
  service_name: string;
  price: number;
  starts_at: string;
  ends_at: string;
  status: string;
  customer: { id: string; name: string; phone: string; email: string | null } | null;
  staff: { id: string; name: string } | null;
};

export function useBookings(opts: { salonId: string; from: Date; to: Date; staffId?: string | undefined; includeCancelled?: boolean }) {
  const { salonId, from, to, staffId, includeCancelled } = opts;
  return useQuery({
    queryKey: ["bookings", salonId, from.toISOString(), to.toISOString(), staffId ?? "all", !!includeCancelled],
    queryFn: async () => {
      let q = supabase
        .from("bookings")
        .select("*, customer:customers(id,name,phone,email), staff:staff(id,name)")
        .eq("salon_id", salonId)
        .gte("starts_at", from.toISOString())
        .lt("starts_at", to.toISOString())
        .order("starts_at");
      if (staffId) q = q.eq("staff_id", staffId);
      if (!includeCancelled) q = q.eq("status", "booked");
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as unknown as BookingRow[];
    },
  });
}

export function useStaffList(salonId: string) {
  return useQuery({
    queryKey: ["staff", salonId],
    queryFn: async () => {
      const { data, error } = await supabase.from("staff").select("*").eq("salon_id", salonId).order("created_at");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useServices(salonId: string) {
  return useQuery({
    queryKey: ["services", salonId],
    queryFn: async () => {
      const { data, error } = await supabase.from("services").select("*").eq("salon_id", salonId).order("name");
      if (error) throw error;
      return data ?? [];
    },
  });
}
