-- ===========================================================================
-- Phase 4a: Fees, charges, payments, and requirements catalogue
--
-- Blessed Faith Academy fee rules (confirmed for 2026):
--   * Class fees (Sheet 1): Early childhood / Pre-grade K1,200;
--     Lower Primary 1–4 K1,150; Upper Primary 5–7 K1,150 (per term)
--   * Extras (all apply): Report book K10; PTA K150/year; Maintenance K50
--   * Meals (optional, Sheet 1): Weekly K150; Monthly K500; Termly K1,400
--   * Uniforms: optional priced items
--   * Requirements: checklist of items parents bring (NOT billed as money)
--
-- Currency: Zambian Kwacha (ZMW). Payment methods: mobile money and bank
-- transfer only (no cash). Payments apply to the student's overall balance
-- (charges minus payments); per-item allocation can be added later.
--
-- Tables:
--   fee_items, fee_schedules, charges, payments, requirement_items
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.fee_category as enum (
  'tuition',
  'extra',
  'meal',
  'uniform'
);

create type public.billing_frequency as enum (
  'term',
  'year',
  'once',
  'monthly',
  'weekly'
);

create type public.payment_method as enum (
  'mobile_money',
  'bank_transfer'
);

create type public.charge_status as enum (
  'outstanding',
  'paid',
  'waived',
  'cancelled'
);

create type public.payment_status as enum (
  'completed',
  'voided'
);

create type public.requirement_band as enum (
  'preschool',   -- Baby / Middle / Reception / Pre-grade
  'lower',       -- Grade 1–4
  'upper',       -- Grade 5–7
  'all'
);

-- ---------------------------------------------------------------------------
-- Helpers: who may manage fees / record payments
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_fees()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_active
      and role in ('administrator', 'bursar', 'headteacher')
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. fee_items — catalogue of chargeable things
-- ---------------------------------------------------------------------------
create table public.fee_items (
  id                uuid primary key default gen_random_uuid(),
  school_id         uuid not null references public.schools(id) on delete restrict,
  code              text not null,
  name              text not null,
  category          public.fee_category not null,
  billing_frequency public.billing_frequency not null default 'term',
  is_optional       boolean not null default false,
  is_active         boolean not null default true,
  sort_order        int not null default 0,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (school_id, code)
);

create trigger fee_items_set_updated_at
before update on public.fee_items
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. fee_schedules — amount for an item in a year (optionally per grade/term)
--    grade_level_id null = applies to all grades
--    term_id null = annual / once / not term-specific
-- ---------------------------------------------------------------------------
create table public.fee_schedules (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  fee_item_id      uuid not null references public.fee_items(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  grade_level_id   uuid references public.grade_levels(id) on delete restrict,
  term_id          uuid references public.terms(id) on delete restrict,
  amount           numeric(12, 2) not null check (amount >= 0),
  currency         text not null default 'ZMW',
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index fee_schedules_lookup_idx
  on public.fee_schedules (school_id, academic_year_id, fee_item_id);

create trigger fee_schedules_set_updated_at
before update on public.fee_schedules
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. charges — what a student owes
-- ---------------------------------------------------------------------------
create table public.charges (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  student_id       uuid not null references public.students(id) on delete restrict,
  fee_item_id      uuid not null references public.fee_items(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  term_id          uuid references public.terms(id) on delete restrict,
  amount           numeric(12, 2) not null check (amount >= 0),
  currency         text not null default 'ZMW',
  description      text,
  status           public.charge_status not null default 'outstanding',
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index charges_student_idx
  on public.charges (student_id, academic_year_id);

create trigger charges_set_updated_at
before update on public.charges
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. payments — money received (applied to overall balance)
-- ---------------------------------------------------------------------------
create table public.payments (
  id              uuid primary key default gen_random_uuid(),
  school_id       uuid not null references public.schools(id) on delete restrict,
  student_id      uuid not null references public.students(id) on delete restrict,
  amount          numeric(12, 2) not null check (amount > 0),
  currency        text not null default 'ZMW',
  method          public.payment_method not null default 'mobile_money',
  reference_number text,
  receipt_number  text not null,
  paid_on         date not null default current_date,
  notes           text,
  status          public.payment_status not null default 'completed',
  recorded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (school_id, receipt_number)
);

create index payments_student_idx
  on public.payments (student_id, paid_on);

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

-- Per-school receipt number prefix (e.g. BFA-R)
alter table public.schools
  add column if not exists receipt_prefix text;

update public.schools
set receipt_prefix = 'BFA-R'
where name = 'Blessed Faith Academy'
  and receipt_prefix is null;

-- Suggest the next receipt number, e.g. BFA-R-2026-0001
create or replace function public.suggest_receipt_number()
returns text
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_prefix    text;
  v_year      text;
  v_head      text;
  v_seq       int;
begin
  if v_school_id is null then
    return null;
  end if;

  select coalesce(receipt_prefix, 'R') into v_prefix
  from public.schools where id = v_school_id;

  select name into v_year
  from public.academic_years
  where school_id = v_school_id and is_current
  limit 1;

  if v_year is null then
    v_year := to_char(current_date, 'YYYY');
  end if;

  v_head := v_prefix || '-' || v_year;

  select coalesce(max((regexp_replace(receipt_number, '^.*-', ''))::int), 0) + 1
  into v_seq
  from public.payments
  where school_id = v_school_id
    and receipt_number ~ ('^' || v_head || '-[0-9]+$');

  return v_head || '-' || lpad(v_seq::text, 4, '0');
end;
$$;

-- ---------------------------------------------------------------------------
-- 5. requirement_items — checklist catalogue (NOT money)
-- ---------------------------------------------------------------------------
create table public.requirement_items (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete restrict,
  name       text not null,
  band       public.requirement_band not null default 'all',
  quantity   text,
  sort_order int not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index requirement_items_school_idx
  on public.requirement_items (school_id, band);

create trigger requirement_items_set_updated_at
before update on public.requirement_items
for each row execute function public.set_updated_at();

-- ===========================================================================
-- Row Level Security
--   READ:  signed-in staff of the school
--   WRITE: administrators, bursars, headteachers (can_manage_fees)
-- ===========================================================================
alter table public.fee_items         enable row level security;
alter table public.fee_schedules     enable row level security;
alter table public.charges           enable row level security;
alter table public.payments          enable row level security;
alter table public.requirement_items enable row level security;

-- fee_items
create policy "fee_items_select" on public.fee_items for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "fee_items_insert" on public.fee_items for insert to authenticated
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "fee_items_update" on public.fee_items for update to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id())
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "fee_items_delete" on public.fee_items for delete to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id());

-- fee_schedules
create policy "fee_schedules_select" on public.fee_schedules for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "fee_schedules_insert" on public.fee_schedules for insert to authenticated
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "fee_schedules_update" on public.fee_schedules for update to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id())
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "fee_schedules_delete" on public.fee_schedules for delete to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id());

-- charges
create policy "charges_select" on public.charges for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "charges_insert" on public.charges for insert to authenticated
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "charges_update" on public.charges for update to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id())
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "charges_delete" on public.charges for delete to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id());

-- payments
create policy "payments_select" on public.payments for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "payments_insert" on public.payments for insert to authenticated
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "payments_update" on public.payments for update to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id())
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "payments_delete" on public.payments for delete to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id());

-- requirement_items
create policy "requirement_items_select" on public.requirement_items for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "requirement_items_insert" on public.requirement_items for insert to authenticated
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "requirement_items_update" on public.requirement_items for update to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id())
  with check (public.can_manage_fees() and school_id = public.current_user_school_id());
create policy "requirement_items_delete" on public.requirement_items for delete to authenticated
  using (public.can_manage_fees() and school_id = public.current_user_school_id());

-- ===========================================================================
-- SEED: 2026 fee catalogue and schedules for Blessed Faith Academy
-- ===========================================================================

-- Fee items
insert into public.fee_items (school_id, code, name, category, billing_frequency, is_optional, sort_order)
select s.id, i.code, i.name, i.category::public.fee_category, i.freq::public.billing_frequency, i.optional, i.sort_order
from public.schools s
cross join (values
  ('TUITION',           'School fees (tuition)',     'tuition', 'term',    false, 10),
  ('REPORT_BOOK',       'Report book',               'extra',   'year',    false, 20),
  ('PTA',               'PTA fee',                   'extra',   'year',    false, 30),
  ('MAINTENANCE',       'Maintenance fee',           'extra',   'year',    false, 40),
  ('MEAL_WEEKLY',       'Meal allowance (weekly)',   'meal',    'weekly',  true,  50),
  ('MEAL_MONTHLY',      'Meal allowance (monthly)',  'meal',    'monthly', true,  51),
  ('MEAL_TERMLY',       'Meal allowance (termly)',   'meal',    'term',    true,  52),
  ('UNIFORM_GYM_SET',   'Gym dress / trouser & shirt','uniform','once',    true,  60),
  ('UNIFORM_SOCKS',     'Socks',                     'uniform', 'once',    true,  61),
  ('UNIFORM_TRACKSUIT', 'Track suit',                'uniform', 'once',    true,  62),
  ('UNIFORM_JERSEY',    'Jersey',                    'uniform', 'once',    true,  63),
  ('UNIFORM_WHITE_SHIRT','White shirt',              'uniform', 'once',    true,  64),
  ('UNIFORM_PE',        'P.E. / short & T-shirt',    'uniform', 'once',    true,  65)
) as i(code, name, category, freq, optional, sort_order)
where s.name = 'Blessed Faith Academy';

-- Tuition schedules by grade for 2026 (amount is per term)
insert into public.fee_schedules (school_id, fee_item_id, academic_year_id, grade_level_id, amount)
select s.id, fi.id, ay.id, gl.id, t.amount
from public.schools s
join public.academic_years ay on ay.school_id = s.id and ay.name = '2026'
join public.fee_items fi on fi.school_id = s.id and fi.code = 'TUITION'
join public.grade_levels gl on gl.school_id = s.id
join (values
  ('Baby Class',   1200.00),
  ('Middle Class', 1200.00),
  ('Reception',    1200.00),
  ('Pre-grade',    1200.00),
  ('Grade 1',      1150.00),
  ('Grade 2',      1150.00),
  ('Grade 3',      1150.00),
  ('Grade 4',      1150.00),
  ('Grade 5',      1150.00),
  ('Grade 6',      1150.00),
  ('Grade 7',      1150.00)
) as t(grade_name, amount) on t.grade_name = gl.name
where s.name = 'Blessed Faith Academy';

-- School-wide extras and optional items for 2026 (no grade filter)
insert into public.fee_schedules (school_id, fee_item_id, academic_year_id, amount)
select s.id, fi.id, ay.id, t.amount
from public.schools s
join public.academic_years ay on ay.school_id = s.id and ay.name = '2026'
join public.fee_items fi on fi.school_id = s.id
join (values
  ('REPORT_BOOK',       10.00),
  ('PTA',              150.00),
  ('MAINTENANCE',       50.00),
  ('MEAL_WEEKLY',      150.00),
  ('MEAL_MONTHLY',     500.00),
  ('MEAL_TERMLY',     1400.00),
  ('UNIFORM_GYM_SET',  160.00),
  ('UNIFORM_SOCKS',     40.00),
  ('UNIFORM_TRACKSUIT',280.00),
  ('UNIFORM_JERSEY',   240.00),
  ('UNIFORM_WHITE_SHIRT',100.00),
  ('UNIFORM_PE',       180.00)
) as t(code, amount) on t.code = fi.code
where s.name = 'Blessed Faith Academy';

-- Requirements checklist (Sheet 1) — not charged
insert into public.requirement_items (school_id, name, band, quantity, sort_order)
select s.id, r.name, r.band::public.requirement_band, r.quantity, r.sort_order
from public.schools s
cross join (values
  ('Boom paste',              'preschool', '2', 10),
  ('Ream of paper',           'preschool', '1', 20),
  ('Dettol soap',             'preschool', '2', 30),
  ('Tissues',                 'preschool', '4', 40),
  ('Hand wash',               'preschool', '2', 50),
  ('Tissues',                 'lower',     '4', 10),
  ('Boom paste',              'lower',     '2', 20),
  ('Ream of paper',           'lower',     '1', 30),
  ('Hand wash',               'lower',     '2', 40),
  ('Dettol soap',             'lower',     '2', 50),
  ('Ream of paper',           'upper',     '1', 10),
  ('Boom paste',              'upper',     '2', 20),
  ('Dettol soap',             'upper',     '2', 30),
  ('Hand wash',               'upper',     '2', 40)
) as r(name, band, quantity, sort_order)
where s.name = 'Blessed Faith Academy';
