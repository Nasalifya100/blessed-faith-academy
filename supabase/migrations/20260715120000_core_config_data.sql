-- ===========================================================================
-- Phase 1: Core configuration data
--
-- Creates the foundational tables that the whole system depends on:
--   schools, academic_years, terms, grade_levels, classes
-- Then seeds Blessed Faith Academy, its grade levels, the 2026 academic year,
-- its three terms, and one class per grade for 2026.
--
-- Row Level Security is ENABLED on every table now (so data is not publicly
-- readable). The actual role-based access policies are added in Phase 2, once
-- user accounts and roles exist. Until then, view/manage these tables through
-- the Supabase dashboard (which uses your project-owner access).
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Helper: keep updated_at accurate automatically on every UPDATE.
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. schools
--    One row per school. Blessed Faith Academy is the first. Other tables
--    carry school_id so future schools can be added without mixing data.
-- ---------------------------------------------------------------------------
create table public.schools (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  motto      text,
  address    text,
  phone      text,
  email      text,
  logo_url   text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger schools_set_updated_at
before update on public.schools
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. academic_years
--    e.g. "2026". is_current marks the active year for the app.
-- ---------------------------------------------------------------------------
create table public.academic_years (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete restrict,
  name       text not null,
  start_date date,
  end_date   date,
  is_current boolean not null default false,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name)
);

create trigger academic_years_set_updated_at
before update on public.academic_years
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. terms
--    Each year is split into terms (1, 2, 3). Fees, meals and reports will
--    reference terms later.
-- ---------------------------------------------------------------------------
create table public.terms (
  id               uuid primary key default gen_random_uuid(),
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  name             text not null,
  term_number      int  not null check (term_number between 1 and 4),
  start_date       date,
  end_date         date,
  is_current       boolean not null default false,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (academic_year_id, term_number)
);

create trigger terms_set_updated_at
before update on public.terms
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. grade_levels
--    The school's grade catalogue (Baby Class ... Grade 7). sort_order keeps
--    them in sequence. A grade is NEVER stored on a student directly; students
--    connect to grades only via yearly class enrolment (added in Phase 5).
-- ---------------------------------------------------------------------------
create table public.grade_levels (
  id         uuid primary key default gen_random_uuid(),
  school_id  uuid not null references public.schools(id) on delete restrict,
  name       text not null,
  sort_order int  not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (school_id, name),
  unique (school_id, sort_order)
);

create trigger grade_levels_set_updated_at
before update on public.grade_levels
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. classes
--    A grade running in a specific year. The school runs one class per grade,
--    enforced by unique (academic_year_id, grade_level_id).
--    (A homeroom_teacher link is added in Phase 2 once user accounts exist.)
-- ---------------------------------------------------------------------------
create table public.classes (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  grade_level_id   uuid not null references public.grade_levels(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  name             text not null,
  capacity         int check (capacity is null or capacity > 0),
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (academic_year_id, grade_level_id)
);

create trigger classes_set_updated_at
before update on public.classes
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Enable Row Level Security. No policies yet => not readable via the public
-- API key. Policies for each role are added in Phase 2.
-- ---------------------------------------------------------------------------
alter table public.schools        enable row level security;
alter table public.academic_years enable row level security;
alter table public.terms          enable row level security;
alter table public.grade_levels   enable row level security;
alter table public.classes        enable row level security;

-- ===========================================================================
-- SEED DATA
-- ===========================================================================

-- The school
insert into public.schools (name)
values ('Blessed Faith Academy');

-- Grade levels (Baby Class ... Grade 7)
insert into public.grade_levels (school_id, name, sort_order)
select s.id, g.name, g.sort_order
from public.schools s
cross join (values
  ('Baby Class',   1),
  ('Middle Class', 2),
  ('Reception',    3),
  ('Pre-grade',    4),
  ('Grade 1',      5),
  ('Grade 2',      6),
  ('Grade 3',      7),
  ('Grade 4',      8),
  ('Grade 5',      9),
  ('Grade 6',      10),
  ('Grade 7',      11)
) as g(name, sort_order)
where s.name = 'Blessed Faith Academy';

-- Academic year 2026 (PLACEHOLDER dates - confirm with school management)
insert into public.academic_years (school_id, name, start_date, end_date, is_current)
select s.id, '2026', date '2026-01-01', date '2026-12-31', true
from public.schools s
where s.name = 'Blessed Faith Academy';

-- Terms for 2026 (PLACEHOLDER dates - confirm with school management)
insert into public.terms (academic_year_id, name, term_number, start_date, end_date, is_current)
select ay.id, t.name, t.term_number, t.start_date, t.end_date, t.is_current
from public.academic_years ay
join public.schools s on s.id = ay.school_id
cross join (values
  ('Term 1', 1, date '2026-01-13', date '2026-04-10', true),
  ('Term 2', 2, date '2026-05-05', date '2026-08-07', false),
  ('Term 3', 3, date '2026-09-08', date '2026-12-04', false)
) as t(name, term_number, start_date, end_date, is_current)
where s.name = 'Blessed Faith Academy' and ay.name = '2026';

-- One class per grade for 2026 (class name mirrors the grade name)
insert into public.classes (school_id, grade_level_id, academic_year_id, name)
select gl.school_id, gl.id, ay.id, gl.name
from public.grade_levels gl
join public.academic_years ay on ay.school_id = gl.school_id
join public.schools s on s.id = gl.school_id
where s.name = 'Blessed Faith Academy'
  and ay.name = '2026'
  and gl.is_active;
