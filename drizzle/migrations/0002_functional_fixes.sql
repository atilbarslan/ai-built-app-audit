-- Functional fixes from the requirements review.
-- Applied on top of 0000_migration.sql and 0001_audit_hardening.sql (both untouched).
-- Idempotent (create or replace), so the file can be re-applied safely.
--
-- Each block is tagged with the finding id it addresses.

-- =====================================================================
-- FN-01 : a client's visit history for every member of the salon.
-- SEC-03 (0001) scoped the bookings table so a stylist reads only their own
-- appointments. That is right for the calendar, but the client page and the
-- two AI helpers read the same table, so a stylist saw only their own visits
-- with a client: "Visits 0", an AI briefing without the client's history, and
-- a reminder that missed an appointment booked with a colleague.
-- This function returns one client's full history to members of that client's
-- salon only. Prices are returned to the owner only (staff never saw revenue).
-- The bookings table policies are unchanged, so the calendar stays "own only".
-- =====================================================================
create or replace function public.get_customer_history(_customer uuid)
returns table(id uuid, starts_at timestamptz, ends_at timestamptz, service_name text, status text,
              staff_name text, booked_name text, price numeric)
language sql stable security definer set search_path = public as $$
  select b.id, b.starts_at, b.ends_at, b.service_name, b.status, st.name, b.booked_name,
         case when public.is_salon_owner(b.salon_id) then b.price end
  from bookings b
  join customers c on c.id = b.customer_id and c.salon_id = b.salon_id
  left join staff st on st.id = b.staff_id
  where b.customer_id = _customer
    and public.is_salon_member(c.salon_id)
  order by b.starts_at desc
$$;
revoke all on function public.get_customer_history(uuid) from public, anon;
grant execute on function public.get_customer_history(uuid) to authenticated;
