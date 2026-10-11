create extension if not exists btree_gist;

create table public.salons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  name text not null,
  slug text not null unique,
  address text,
  phone text,
  open_time time not null default '09:00',
  close_time time not null default '19:00',
  open_days int[] not null default '{1,2,3,4,5,6}',
  created_at timestamptz not null default now()
);
create table public.staff (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  user_id uuid,
  name text not null,
  email text,
  role text not null default 'staff' check (role in ('owner','staff')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.staff(user_id);
create index on public.staff(lower(email));
create table public.services (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  duration_min int not null default 30 check (duration_min > 0),
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.customers (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  name text not null,
  phone text not null,
  email text,
  created_at timestamptz not null default now(),
  unique (salon_id, phone)
);
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  staff_id uuid not null references public.staff(id) on delete cascade,
  service_id uuid references public.services(id) on delete set null,
  customer_id uuid not null references public.customers(id) on delete cascade,
  service_name text not null,
  price numeric(10,2) not null default 0,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','cancelled')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  exclude using gist (staff_id with =, tstzrange(starts_at, ends_at) with &&) where (status = 'booked')
);
create index on public.bookings(salon_id, starts_at);
create table public.customer_notes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id) on delete cascade,
  customer_id uuid not null references public.customers(id) on delete cascade,
  author_id uuid not null default auth.uid(),
  author_name text,
  body text not null,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.salons, public.staff, public.services, public.customers, public.bookings, public.customer_notes to authenticated;
grant all on public.salons, public.staff, public.services, public.customers, public.bookings, public.customer_notes to service_role;

alter table public.salons enable row level security;
alter table public.staff enable row level security;
alter table public.services enable row level security;
alter table public.customers enable row level security;
alter table public.bookings enable row level security;
alter table public.customer_notes enable row level security;

create or replace function public.is_salon_owner(_salon uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from salons where id = _salon and owner_id = auth.uid())
$$;
create or replace function public.is_salon_member(_salon uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from salons where id = _salon and owner_id = auth.uid())
      or exists(select 1 from staff where salon_id = _salon and user_id = auth.uid() and active)
$$;

create policy "owner manages salon" on public.salons for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy "members read salon" on public.salons for select to authenticated using (public.is_salon_member(id));

create policy "members read staff" on public.staff for select to authenticated using (public.is_salon_member(salon_id));
create policy "owner manages staff" on public.staff for all to authenticated using (public.is_salon_owner(salon_id)) with check (public.is_salon_owner(salon_id));

create policy "members read services" on public.services for select to authenticated using (public.is_salon_member(salon_id));
create policy "owner manages services" on public.services for all to authenticated using (public.is_salon_owner(salon_id)) with check (public.is_salon_owner(salon_id));

create policy "members manage customers" on public.customers for all to authenticated using (public.is_salon_member(salon_id)) with check (public.is_salon_member(salon_id));

create policy "members read bookings" on public.bookings for select to authenticated using (public.is_salon_member(salon_id));
create policy "owner manages bookings" on public.bookings for all to authenticated using (public.is_salon_owner(salon_id)) with check (public.is_salon_owner(salon_id));

create policy "members read notes" on public.customer_notes for select to authenticated using (public.is_salon_member(salon_id));
create policy "members add notes" on public.customer_notes for insert to authenticated with check (public.is_salon_member(salon_id) and author_id = auth.uid());
create policy "author or owner deletes notes" on public.customer_notes for delete to authenticated using (author_id = auth.uid() or public.is_salon_owner(salon_id));

-- link staff invites to the signed-in user by email
create or replace function public.claim_staff_invites() returns void
language plpgsql security definer set search_path = public as $$
declare _email text;
begin
  select email into _email from auth.users where id = auth.uid();
  if _email is null then return; end if;
  update staff set user_id = auth.uid() where user_id is null and lower(email) = lower(_email);
end $$;
revoke all on function public.claim_staff_invites() from public, anon;
grant execute on function public.claim_staff_invites() to authenticated;

-- create salon + owner staff row
create or replace function public.create_salon(_name text, _slug text, _owner_name text) returns uuid
language plpgsql security definer set search_path = public as $$
declare _id uuid;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  insert into salons(owner_id, name, slug) values (auth.uid(), _name, lower(_slug)) returning id into _id;
  insert into staff(salon_id, user_id, name, email, role)
    values (_id, auth.uid(), coalesce(nullif(_owner_name,''),'Owner'), (select email from auth.users where id = auth.uid()), 'owner');
  return _id;
end $$;
revoke all on function public.create_salon(text,text,text) from public, anon;
grant execute on function public.create_salon(text,text,text) to authenticated;

-- public booking page data
create or replace function public.get_public_salon(_slug text) returns json
language sql stable security definer set search_path = public as $$
  select json_build_object(
    'salon', json_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'address', s.address, 'phone', s.phone,
      'open_time', s.open_time, 'close_time', s.close_time, 'open_days', s.open_days),
    'services', coalesce((select json_agg(json_build_object('id', v.id, 'name', v.name, 'price', v.price, 'duration_min', v.duration_min) order by v.name) from services v where v.salon_id = s.id and v.active), '[]'::json),
    'staff', coalesce((select json_agg(json_build_object('id', t.id, 'name', t.name) order by t.name) from staff t where t.salon_id = s.id and t.active), '[]'::json)
  ) from salons s where s.slug = lower(_slug)
$$;

create or replace function public.get_busy_times(_salon uuid, _from timestamptz, _to timestamptz) returns table(staff_id uuid, starts_at timestamptz, ends_at timestamptz)
language sql stable security definer set search_path = public as $$
  select b.staff_id, b.starts_at, b.ends_at from bookings b
  where b.salon_id = _salon and b.status = 'booked' and b.starts_at < _to and b.ends_at > _from
$$;

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
    on conflict (salon_id, phone) do update set name = excluded.name, email = coalesce(excluded.email, customers.email)
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

grant execute on function public.get_public_salon(text) to anon, authenticated;
grant execute on function public.get_busy_times(uuid, timestamptz, timestamptz) to anon, authenticated;
grant execute on function public.create_public_booking(uuid, uuid, uuid, timestamptz, text, text, text) to anon, authenticated;