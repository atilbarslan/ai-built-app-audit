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
-- SEC-01 residual: the name entered on each public booking (may differ from the
-- stored customer name when someone reuses a known phone).
alter table public.bookings add column if not exists booked_name text;

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
        _local timestamp; _end_local timestamp; _ends timestamptz; _phone_norm text;
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
  _phone_norm := public.normalize_phone(_phone); -- Item 12: canonical phone for dedupe/storage

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

  -- BH-01: slot must sit on the salon's 15-minute grid, anchored at open_time
  -- (matches the booking UI's 15-minute step exactly).
  if extract(second from _local) <> 0
     or (extract(epoch from (_local::time - _sal.open_time)) / 60)::int % 15 <> 0 then
    raise exception 'Please pick a valid time slot';
  end if;

  -- BH-02: per-phone cap on upcoming bookings (stops one person flooding the book)
  if (select count(*) from bookings b join customers c on c.id = b.customer_id
        where c.salon_id = _salon and c.phone = _phone_norm
          and b.status = 'booked' and b.starts_at > now()) >= 5 then
    raise exception 'You already have several upcoming bookings. Please contact the salon.';
  end if;

  -- BH-02: per-salon burst quota (stops a script creating many bookings at once).
  -- IP-based limiting and CAPTCHA cannot live here because the booking RPC is
  -- called straight from the browser; those stay recommendations in AUDIT.md.
  if (select count(*) from bookings where salon_id = _salon
        and created_at > now() - interval '1 minute') >= 10 then
    raise exception 'Too many bookings right now. Please try again shortly.';
  end if;

  insert into customers(salon_id, name, phone, email) values (_salon, trim(_name), _phone_norm, nullif(trim(_email),''))
    on conflict (salon_id, phone) do update
      -- SEC-01: keep the stored identity; only fill empty fields.
      set name  = coalesce(nullif(customers.name, ''), excluded.name),
          email = coalesce(customers.email, excluded.email)
    returning id into _cust;
  begin
    -- SEC-01 residual: record the name entered at booking time. When it differs
    -- from the stored customer name, staff can see the booking may be from someone
    -- else reusing a known phone (the customer record itself is never overwritten).
    insert into bookings(salon_id, staff_id, service_id, customer_id, service_name, price, starts_at, ends_at, booked_name)
      values (_salon, _staff, _service, _cust, _svc.name, _svc.price, _starts, _ends, trim(_name))
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

-- =====================================================================
-- SEC-04 : staff invites must be ACCEPTED explicitly, not auto-linked by
-- email on login. Replace the auto-claim with (a) a list of pending invites
-- for the signed-in user and (b) an accept RPC guarded by the email match.
-- =====================================================================

-- stop auto-claiming on login (keep the name a no-op for backward-compat)
create or replace function public.claim_staff_invites() returns void
language plpgsql security definer set search_path = public as $$
begin
  return; -- SEC-04: no automatic linking; use accept_staff_invite instead
end $$;

-- pending invites for the current user (matched by email), as json
create or replace function public.list_staff_invites() returns json
language sql stable security definer set search_path = public as $$
  select coalesce(
    json_agg(json_build_object('staff_id', st.id, 'salon_id', st.salon_id, 'salon_name', s.name) order by s.name),
    '[]'::json)
  from staff st join salons s on s.id = st.salon_id
  where st.user_id is null and st.active
    and lower(st.email) = lower((select email from auth.users where id = auth.uid()))
$$;
revoke all on function public.list_staff_invites() from public, anon;
grant execute on function public.list_staff_invites() to authenticated;

-- accept a specific invite; links ONLY if it is addressed to the caller's email
create or replace function public.accept_staff_invite(_staff uuid) returns boolean
language plpgsql security definer set search_path = public as $$
declare _email text; _n int;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select email into _email from auth.users where id = auth.uid();
  update staff set user_id = auth.uid()
    where id = _staff and user_id is null and lower(email) = lower(_email);
  get diagnostics _n = row_count;
  return _n > 0;
end $$;
revoke all on function public.accept_staff_invite(uuid) from public, anon;
grant execute on function public.accept_staff_invite(uuid) to authenticated;

-- =====================================================================
-- SEC-07 : sanitize the slug in create_salon (the UI slugify is bypassable by
-- calling the RPC directly) and enforce a safe slug shape on the table so the
-- settings UPDATE path is covered too.
-- Also: non-negative price integrity on services/bookings (revenue correctness).
-- =====================================================================
create or replace function public.create_salon(_name text, _slug text, _owner_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare _id uuid; _clean text;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  -- normalize: lowercase, non-alphanumeric runs -> '-', trim '-', cap length
  _clean := trim(both '-' from regexp_replace(lower(coalesce(_slug,'')), '[^a-z0-9]+', '-', 'g'));
  _clean := left(_clean, 40);
  if length(_clean) < 1 then raise exception 'Please choose a valid booking link'; end if;
  if length(trim(coalesce(_name,''))) < 1 or length(_name) > 120 then raise exception 'Please enter a salon name'; end if;
  insert into salons(owner_id, name, slug) values (auth.uid(), trim(_name), _clean) returning id into _id;
  insert into staff(salon_id, user_id, name, email, role)
    values (_id, auth.uid(), coalesce(nullif(_owner_name,''),'Owner'), (select email from auth.users where id = auth.uid()), 'owner');
  return _id;
end $$;
revoke all on function public.create_salon(text,text,text) from public, anon;
grant execute on function public.create_salon(text,text,text) to authenticated;

-- defense-in-depth: valid slug shape enforced for every write path
alter table public.salons drop constraint if exists salons_slug_format;
alter table public.salons add constraint salons_slug_format check (slug ~ '^[a-z0-9-]+$');

-- integrity: prices cannot be negative
alter table public.services drop constraint if exists services_price_nonneg;
alter table public.services add constraint services_price_nonneg check (price >= 0);
alter table public.bookings drop constraint if exists bookings_price_nonneg;
alter table public.bookings add constraint bookings_price_nonneg check (price >= 0);

-- =====================================================================
-- SEC-08 : the RLS helpers is_salon_owner/is_salon_member were EXECUTE-able by
-- anon/public (harmless but unnecessary). Restrict to authenticated. RLS still
-- works because every policy using them is `to authenticated`.
-- =====================================================================
revoke all on function public.is_salon_owner(uuid)  from public, anon;
revoke all on function public.is_salon_member(uuid) from public, anon;
grant execute on function public.is_salon_owner(uuid)  to authenticated;
grant execute on function public.is_salon_member(uuid) to authenticated;

-- =====================================================================
-- Item 11 : defense-in-depth - the Supabase defaults grant anon table-level
-- privileges, so RLS was the ONLY thing stopping anonymous reads/writes. The
-- public booking RPCs are SECURITY DEFINER (they run as the owner), so anon
-- does not need any direct table privilege. Revoke them so a future RLS mistake
-- cannot expose data to anon.
-- =====================================================================
revoke all on public.salons, public.staff, public.services,
               public.customers, public.bookings, public.customer_notes
  from anon;

-- =====================================================================
-- Item 12 : phone normalization. Customers are keyed by (salon_id, phone); the
-- same person typing "0555 111 22 33", "+90 555 111 2233" or "00905551112233"
-- must map to ONE customer. Normalize to +90 E.164-ish before storing/looking up.
-- =====================================================================
create or replace function public.normalize_phone(_p text) returns text
language sql immutable set search_path = public as $$
  with s as (select regexp_replace(coalesce(_p,''), '[^0-9+]', '', 'g') as d)
  select case
    when d like '00%'     then '+' || substring(d from 3)      -- 0090... -> +90...
    when left(d,1) = '+'  then d                                -- already +CC
    when left(d,1) = '0'  then '+90' || substring(d from 2)     -- Turkish local 0xxx
    when length(d) > 0    then '+90' || d                       -- bare local digits
    else d
  end from s
$$;
