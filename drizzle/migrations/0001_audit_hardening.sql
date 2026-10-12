-- Audit hardening migration (Asama 3).
-- Applied on top of 0000_migration.sql. 0000 is left untouched so the BEFORE
-- state is preserved. Every statement here is idempotent (create or replace /
-- if not exists / drop policy if exists) so the file can be re-applied safely.
--
-- Each block is tagged with the finding id it addresses.

-- =====================================================================
-- SEC-01 : A public booking must NOT overwrite an existing customer's
-- name/email. On a phone collision, keep the existing identity and only
-- fill fields that are currently empty.
-- =====================================================================
create or replace function public.create_public_booking(_salon uuid, _service uuid, _staff uuid, _starts timestamptz, _name text, _phone text, _email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _svc services%rowtype; _cust uuid; _id uuid;
begin
  if length(trim(coalesce(_name,''))) < 2 or length(trim(coalesce(_phone,''))) < 6 then raise exception 'Please enter your name and phone number'; end if;
  if _starts < now() then raise exception 'That time is in the past'; end if;
  select * into _svc from services where id = _service and salon_id = _salon and active;
  if not found then raise exception 'Service not found'; end if;
  if not exists(select 1 from staff where id = _staff and salon_id = _salon and active) then raise exception 'Staff member not found'; end if;
  insert into customers(salon_id, name, phone, email) values (_salon, trim(_name), trim(_phone), nullif(trim(_email),''))
    on conflict (salon_id, phone) do update
      -- SEC-01: do not let a public booking rewrite an existing customer.
      -- Keep the stored name/email; only fill when the stored value is empty.
      set name  = coalesce(nullif(customers.name, ''), excluded.name),
          email = coalesce(customers.email, excluded.email)
    returning id into _cust;
  begin
    insert into bookings(salon_id, staff_id, service_id, customer_id, service_name, price, starts_at, ends_at)
      values (_salon, _staff, _service, _cust, _svc.name, _svc.price, _starts, _starts + make_interval(mins => _svc.duration_min))
      returning id into _id;
  exception when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another slot.';
  end;
  return _id;
end $$;
