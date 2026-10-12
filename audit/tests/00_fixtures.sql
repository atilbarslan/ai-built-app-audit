-- Audit fixtures: fake personas + two salons for the salon-audit-demo test project.
-- No real-person data. All emails use the reserved example.test domain.
-- Users are created directly in auth.users (email pre-confirmed, no email sent)
-- because the project's HTTP admin API (GoTrue) was unreachable during the audit.
--
-- Personas (fixed UUIDs for deterministic tests):
--   A  owner of Salon A
--   A1 staff of Salon A (linked via claim_staff_invites)
--   A2 staff of Salon A (linked)
--   B  owner of Salon B
--   X  registered user, member of no salon
--
-- Re-runnable: clears prior fixture rows first.

begin;

-- 1. clean any prior run (children cascade from salons/users)
-- Full clean of app tables so the seed is deterministic even if another run (or a
-- parallel audit sharing this test project) left different data behind. This is a
-- dedicated test project with only fake data.
delete from public.bookings;
delete from public.customer_notes;
delete from public.customers;
delete from public.services;
delete from public.staff;
delete from public.salons;
delete from auth.identities where identity_data->>'email' like '%@example.test';
delete from auth.users where email like '%@example.test';

-- 2. create auth users (email-confirmed, password set for completeness)
insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user, is_anonymous)
values
  ('00000000-0000-0000-0000-000000000000','11111111-1111-1111-1111-111111111111','authenticated','authenticated','ownera@example.test', extensions.crypt('Test-Passw0rd!1', extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000','22222222-2222-2222-2222-222222222222','authenticated','authenticated','staffa1@example.test', extensions.crypt('Test-Passw0rd!2', extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000','33333333-3333-3333-3333-333333333333','authenticated','authenticated','staffa2@example.test', extensions.crypt('Test-Passw0rd!3', extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000','44444444-4444-4444-4444-444444444444','authenticated','authenticated','ownerb@example.test', extensions.crypt('Test-Passw0rd!4', extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false),
  ('00000000-0000-0000-0000-000000000000','55555555-5555-5555-5555-555555555555','authenticated','authenticated','userx@example.test', extensions.crypt('Test-Passw0rd!5', extensions.gen_salt('bf')), now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, false);

-- GoTrue stores these token columns as '' (empty string), not NULL. SQL-inserted
-- users with NULLs make the password grant 500 ("unexpected_failure"), so normalize
-- them to '' so the personas can actually sign in over HTTP (needed for E2E + a clean
-- email-enumeration test).
update auth.users set
  confirmation_token = '', recovery_token = '', email_change_token_new = '',
  email_change = '', email_change_token_current = '', phone_change = '',
  phone_change_token = '', reauthentication_token = ''
where email like '%@example.test';

-- matching auth.identities rows (GoTrue expects one per email user)
insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
select id::text, id, jsonb_build_object('sub', id::text, 'email', email, 'email_verified', true), 'email', now(), now()
from auth.users where email like '%@example.test';

-- 3. Salon A owned by A, via the real create_salon RPC (as A)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"ownera@example.test"}';
select public.create_salon('Salon A', 'salon-a', 'Owner A');
reset role;

-- 4. Salon B owned by B, via create_salon (as B)
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","email":"ownerb@example.test"}';
select public.create_salon('Salon B', 'salon-b', 'Owner B');
reset role;

-- 5. Owner A invites staff A1 and A2 (as A) -> owner-managed staff rows
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"ownera@example.test"}';
insert into public.staff (salon_id, name, email, role)
select id, 'Stylist A1', 'staffa1@example.test', 'staff' from public.salons where slug='salon-a';
insert into public.staff (salon_id, name, email, role)
select id, 'Stylist A2', 'staffa2@example.test', 'staff' from public.salons where slug='salon-a';
reset role;

-- 6. Link A1 and A2 to their staff rows. (The app flow is now an explicit
-- accept_staff_invite; claim_staff_invites is a no-op after SEC-04. For a
-- deterministic seed we link directly here; the accept flow is covered by its
-- own test in audit/tests/pentest.test.ts.)
update public.staff set user_id = '22222222-2222-2222-2222-222222222222'
  where email = 'staffa1@example.test' and salon_id = (select id from public.salons where slug='salon-a');
update public.staff set user_id = '33333333-3333-3333-3333-333333333333'
  where email = 'staffa2@example.test' and salon_id = (select id from public.salons where slug='salon-a');

-- 7. a couple of services + one real customer/booking in Salon A for later tests
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"ownera@example.test"}';
insert into public.services (salon_id, name, price, duration_min)
select id, 'Haircut', 300, 30 from public.salons where slug='salon-a';
insert into public.services (salon_id, name, price, duration_min)
select id, 'Beard Trim', 150, 15 from public.salons where slug='salon-a';
reset role;

-- a seed customer in Salon B too (for cross-tenant tests)
set local role authenticated;
set local request.jwt.claims = '{"sub":"44444444-4444-4444-4444-444444444444","role":"authenticated","email":"ownerb@example.test"}';
insert into public.services (salon_id, name, price, duration_min)
select id, 'Ladies Cut', 500, 45 from public.salons where slug='salon-b';
insert into public.customers (salon_id, name, phone, email)
select id, 'Existing B Customer', '+905550000001', 'cust-b@example.test' from public.salons where slug='salon-b';
reset role;

-- 8. a customer + booking + note in Salon A (targets for the role matrix)
set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated","email":"ownera@example.test"}';
with s as (select id from public.salons where slug='salon-a')
insert into public.customers (salon_id, name, phone, email)
select s.id, 'Salon A Customer', '+905551110000', 'cust-a@example.test' from s;
with s as (select id from public.salons where slug='salon-a'),
     svc as (select id, name, price, duration_min from public.services where salon_id=(select id from s) and name='Haircut' limit 1),
     st as (select id from public.staff where salon_id=(select id from s) and role='owner' limit 1),
     cu as (select id from public.customers where salon_id=(select id from s) and phone='+905551110000' limit 1)
insert into public.bookings (salon_id, staff_id, service_id, customer_id, service_name, price, starts_at, ends_at)
select (select id from s), (select id from st), (select id from svc), (select id from cu),
       (select name from svc), (select price from svc),
       date_trunc('hour', now()) + interval '2 days',
       date_trunc('hour', now()) + interval '2 days' + make_interval(mins => (select duration_min from svc));
insert into public.customer_notes (salon_id, customer_id, author_id, author_name, body)
select (select id from public.salons where slug='salon-a'),
       (select id from public.customers where salon_id=(select id from public.salons where slug='salon-a') and phone='+905551110000' limit 1),
       '11111111-1111-1111-1111-111111111111', 'Owner A', 'Prefers scissors over clippers.';
reset role;

commit;

-- summary
select 'users' as kind, count(*)::text from auth.users where email like '%@example.test'
union all select 'salons', count(*)::text from public.salons where slug in ('salon-a','salon-b')
union all select 'staff(salon A)', count(*)::text from public.staff st join public.salons s on s.id=st.salon_id where s.slug='salon-a'
union all select 'staff linked', count(*)::text from public.staff where user_id is not null and email like '%@example.test'
union all select 'services', count(*)::text from public.services
union all select 'customers', count(*)::text from public.customers;
