-- Audit hardening migration (Asama 3).
-- Applied on top of 0000_migration.sql. 0000 is left untouched so the BEFORE
-- state is preserved. Every statement here is idempotent (create or replace /
-- if not exists / drop policy if exists) so the file can be re-applied safely.
--
-- Each block is tagged with the finding id it addresses.

-- =====================================================================
-- BH-01 / SE-02 : salons need a time zone so booking rules can be enforced
-- in the SALON's local time (not the visitor's browser). Default Istanbul,
-- matching the app's existing assumption.
-- =====================================================================
alter table public.salons add column if not exists timezone text not null default 'Europe/Istanbul';

-- get_public_salon must expose timezone so the booking page computes slots in it.
create or replace function public.get_public_salon(_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'salon', json_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'address', s.address, 'phone', s.phone,
      'open_time', s.open_time, 'close_time', s.close_time, 'open_days', s.open_days, 'timezone', s.timezone),
    'services', coalesce((select json_agg(json_build_object('id', v.id, 'name', v.name, 'price', v.price, 'duration_min', v.duration_min) order by v.name) from services v where v.salon_id = s.id and v.active), '[]'::json),
    'staff', coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name) order by t.name) from staff t where t.salon_id = s.id and t.active), '[]'::json)
  ) from salons s where s.slug = lower(_slug)
$$;

-- =====================================================================
-- SEC-01 : a public booking must NOT overwrite an existing customer's name/email.
-- BH-01 : enforce the salon's open days, open hours, a 21-day advance window and
--         5-minute slot alignment server-side, all evaluated in the salon's time
--         zone. (The browser UI alone could be bypassed by calling the RPC.)
-- SEC-02 : bound the name/phone/email length and check the email shape.
-- =====================================================================
create or replace function public.create_public_booking(_salon uuid, _service uuid, _staff uuid, _starts timestamptz, _name text, _phone text, _email text)
returns uuid language plpgsql security definer set search_path = public as $$
declare _svc services%rowtype; _sal salons%rowtype; _cust uuid; _id uuid;
        _local timestamp; _end_local timestamp; _ends timestamptz;
begin
  -- SEC-02: input bounds + format
  if length(trim(coalesce(_name,''))) < 2 or length(trim(coalesce(_phone,''))) < 6 then raise exception 'Please enter your name and phone number'; end if;
  if length(coalesce(_name,'')) > 120 then raise exception 'Name is too long'; end if;
  if length(coalesce(_phone,'')) > 32 then raise exception 'Phone number is too long'; end if;
  if nullif(trim(coalesce(_email,'')),'') is not null then
    if length(_email) > 200 then raise exception 'Email is too long'; end if;
    if _email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then raise exception 'Please enter a valid email'; end if;
  end if;
  if trim(coalesce(_phone,'')) !~ '^[0-9 +()\-]+$' then raise exception 'Please enter a valid phone number'; end if;

  if _starts < now() then raise exception 'That time is in the past'; end if;

  select * into _svc from services where id = _service and salon_id = _salon and active;
  if not found then raise exception 'Service not found'; end if;
  if not exists(select 1 from staff where id = _staff and salon_id = _salon and active) then raise exception 'Staff member not found'; end if;
  select * into _sal from salons where id = _salon;

  _ends := _starts + make_interval(mins => _svc.duration_min);

  -- BH-01: advance-booking window (21 days)
  if _starts > now() + interval '21 days' then raise exception 'That date is too far ahead'; end if;

  -- evaluate the requested time in the salon's own zone
  _local := _starts at time zone _sal.timezone;
  _end_local := _ends at time zone _sal.timezone;

  -- BH-01: open day (1=Mon..7=Sun), must match the start's weekday in salon tz
  if not (extract(isodow from _local)::int = any(_sal.open_days)) then
    raise exception 'The salon is closed that day';
  end if;

  -- BH-01: within opening hours, and the whole appointment ends on the same day before close
  if _local::time < _sal.open_time
     or _end_local::time > _sal.close_time
     or _end_local::date <> _local::date then
    raise exception 'That time is outside opening hours';
  end if;

  -- BH-01: slot alignment (no 03:17:33 style times); allow the UI's 15-min grid
  if extract(second from _local) <> 0 or (extract(minute from _local)::int % 5) <> 0 then
    raise exception 'Please pick a valid time slot';
  end if;

  insert into customers(salon_id, name, phone, email) values (_salon, trim(_name), trim(_phone), nullif(trim(_email),''))
    on conflict (salon_id, phone) do update
      -- SEC-01: keep the stored identity; only fill empty fields.
      set name  = coalesce(nullif(customers.name, ''), excluded.name),
          email = coalesce(customers.email, excluded.email)
    returning id into _cust;
  begin
    insert into bookings(salon_id, staff_id, service_id, customer_id, service_name, price, starts_at, ends_at)
      values (_salon, _staff, _service, _cust, _svc.name, _svc.price, _starts, _ends)
      returning id into _id;
  exception when exclusion_violation then
    raise exception 'Sorry, that time was just taken. Please pick another slot.';
  end;
  return _id;
end $$;

-- =====================================================================
-- SEC-03 : match the product rule "staff see their own calendar".
--  * customers: staff may READ (needed to view history and add notes),
--    but only the OWNER may insert/update/delete.
--  * bookings: the OWNER sees all; a staff member sees only bookings
--    assigned to their own staff row.
-- Customer deletes are now owner-only (the FK cascade still removes that
-- customer's bookings/notes). A soft-delete (active flag) would preserve
-- history and is recommended as a follow-up; left out here to keep the
-- change minimal and because it also needs UI/query changes.
-- =====================================================================
drop policy if exists "members manage customers" on public.customers;
drop policy if exists "members read customers"   on public.customers;
drop policy if exists "owner manages customers"  on public.customers;
create policy "members read customers" on public.customers
  for select to authenticated using (public.is_salon_member(salon_id));
create policy "owner manages customers" on public.customers
  for all to authenticated using (public.is_salon_owner(salon_id)) with check (public.is_salon_owner(salon_id));

-- bookings: replace salon-wide staff read with own-only read; owner keeps full access
drop policy if exists "members read bookings"   on public.bookings;
drop policy if exists "staff reads own bookings" on public.bookings;
create policy "staff reads own bookings" on public.bookings
  for select to authenticated using (
    exists (select 1 from public.staff st
            where st.id = bookings.staff_id and st.user_id = auth.uid() and st.active)
  );
-- ("owner manages bookings" from 0000 still grants the owner all access incl. select)
