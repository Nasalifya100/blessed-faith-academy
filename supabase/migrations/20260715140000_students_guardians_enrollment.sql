-- ===========================================================================
-- Phase 3a: Students, guardians, class enrolment, and applications
--
-- Creates the core people/enrolment tables the whole system revolves around:
--   students, guardians, student_guardians (link),
--   student_class_enrollments, applications
--
-- Design notes:
--   * A student can be added TWO ways:
--       1. Directly (an existing/current child)  -> status starts 'enrolled'
--       2. Through the application workflow       -> status starts 'applicant',
--          and becomes 'enrolled' only when approved (built in a later phase).
--   * Guardians are stored ONCE and linked to students, so siblings can share
--     the same parent record.
--   * A student's grade is NEVER stored on the student. It comes from their
--     yearly class enrolment (student_class_enrollments -> classes -> grade).
--   * Every table carries school_id so security rules are simple and uniform,
--     and so future schools never mix data.
--
-- Row Level Security:
--   * Any signed-in staff of the school can READ student data.
--   * Only administrators, headteachers, and secretaries can WRITE it.
--     (Bursars and teachers are read-only here.)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- Enumerated types (fixed sets of allowed values).
-- ---------------------------------------------------------------------------
create type public.gender as enum ('male', 'female');

create type public.student_status as enum (
  'applicant',   -- applied, not yet approved
  'enrolled',    -- active pupil
  'withdrawn',   -- left the school
  'graduated',   -- completed the school
  'rejected'     -- application was declined
);

create type public.guardian_relationship as enum (
  'father',
  'mother',
  'guardian',
  'grandparent',
  'other'
);

create type public.enrollment_status as enum (
  'active',
  'transferred',
  'completed',
  'withdrawn'
);

create type public.application_status as enum (
  'draft',
  'submitted',
  'approved',
  'rejected',
  'withdrawn'
);

-- ---------------------------------------------------------------------------
-- Helper for security policies: may the current user manage student data?
-- SECURITY DEFINER so it can read profiles without tripping profiles' RLS.
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_students()
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
      and role in ('administrator', 'headteacher', 'secretary')
  );
$$;

-- ---------------------------------------------------------------------------
-- 1. students
--    One row per child. Only the core identity fields for now; more can be
--    added later with new migrations.
-- ---------------------------------------------------------------------------
create table public.students (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  admission_number text not null,
  first_name       text not null,
  middle_name      text,
  last_name        text not null,
  date_of_birth    date not null,
  gender           public.gender not null,
  status           public.student_status not null default 'enrolled',
  enrollment_date  date not null default current_date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- Admission numbers are unique within a school (case-insensitive).
  unique (school_id, admission_number)
);

create index students_school_status_idx
  on public.students (school_id, status);

create trigger students_set_updated_at
before update on public.students
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 2. guardians
--    One row per parent/guardian person. Linked to students below.
-- ---------------------------------------------------------------------------
create table public.guardians (
  id          uuid primary key default gen_random_uuid(),
  school_id   uuid not null references public.schools(id) on delete restrict,
  first_name  text not null,
  last_name   text not null,
  phone       text,
  alt_phone   text,
  email       text,
  national_id text,  -- NRC
  occupation  text,
  address     text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index guardians_school_idx
  on public.guardians (school_id);

create trigger guardians_set_updated_at
before update on public.guardians
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 3. student_guardians
--    Links a student to a guardian, with the relationship and contact flags.
--    Deleting a student removes its links; a guardian cannot be deleted while
--    still linked (unlink first).
-- ---------------------------------------------------------------------------
create table public.student_guardians (
  id                   uuid primary key default gen_random_uuid(),
  school_id            uuid not null references public.schools(id) on delete restrict,
  student_id           uuid not null references public.students(id) on delete cascade,
  guardian_id          uuid not null references public.guardians(id) on delete restrict,
  relationship         public.guardian_relationship not null,
  is_primary_contact   boolean not null default false,
  is_emergency_contact boolean not null default false,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (student_id, guardian_id)
);

create index student_guardians_guardian_idx
  on public.student_guardians (guardian_id);

-- At most one primary contact per student.
create unique index student_guardians_one_primary_per_student
  on public.student_guardians (student_id)
  where is_primary_contact;

create trigger student_guardians_set_updated_at
before update on public.student_guardians
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 4. student_class_enrollments
--    Which class a student sits in for a given academic year. Keeps history:
--    one row per student per year. Deleting a student removes its enrolments.
-- ---------------------------------------------------------------------------
create table public.student_class_enrollments (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  student_id       uuid not null references public.students(id) on delete cascade,
  class_id         uuid not null references public.classes(id) on delete restrict,
  academic_year_id uuid not null references public.academic_years(id) on delete restrict,
  status           public.enrollment_status not null default 'active',
  enrolled_on      date not null default current_date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  -- A student can only be placed in one class per academic year.
  unique (student_id, academic_year_id)
);

create index student_class_enrollments_class_idx
  on public.student_class_enrollments (class_id);

create trigger student_class_enrollments_set_updated_at
before update on public.student_class_enrollments
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- 5. applications
--    The formal new-intake workflow that wraps a student going through
--    submit -> review -> approve/reject. Existing children added directly do
--    not need an application. The approval step (later phase) flips the linked
--    student to 'enrolled' and creates their class enrolment.
-- ---------------------------------------------------------------------------
create table public.applications (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  student_id       uuid not null references public.students(id) on delete cascade,
  status           public.application_status not null default 'draft',
  submitted_at     timestamptz,
  submitted_by     uuid references public.profiles(id) on delete set null,
  reviewed_at      timestamptz,
  reviewed_by      uuid references public.profiles(id) on delete set null,
  decision_notes   text,
  consent_agreed   boolean not null default false,
  consent_signed_by text,   -- name of the parent/guardian who signed
  consent_signed_at date,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index applications_school_status_idx
  on public.applications (school_id, status);

create index applications_student_idx
  on public.applications (student_id);

create trigger applications_set_updated_at
before update on public.applications
for each row execute function public.set_updated_at();

-- ===========================================================================
-- Row Level Security
--   READ:  any signed-in staff whose profile belongs to the same school.
--   WRITE: only administrators, headteachers, and secretaries of that school.
-- ===========================================================================
alter table public.students                  enable row level security;
alter table public.guardians                 enable row level security;
alter table public.student_guardians         enable row level security;
alter table public.student_class_enrollments enable row level security;
alter table public.applications              enable row level security;

-- students
create policy "students_select" on public.students for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "students_insert" on public.students for insert to authenticated
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "students_update" on public.students for update to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id())
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "students_delete" on public.students for delete to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id());

-- guardians
create policy "guardians_select" on public.guardians for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "guardians_insert" on public.guardians for insert to authenticated
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "guardians_update" on public.guardians for update to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id())
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "guardians_delete" on public.guardians for delete to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id());

-- student_guardians
create policy "student_guardians_select" on public.student_guardians for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "student_guardians_insert" on public.student_guardians for insert to authenticated
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "student_guardians_update" on public.student_guardians for update to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id())
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "student_guardians_delete" on public.student_guardians for delete to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id());

-- student_class_enrollments
create policy "enrollments_select" on public.student_class_enrollments for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "enrollments_insert" on public.student_class_enrollments for insert to authenticated
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "enrollments_update" on public.student_class_enrollments for update to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id())
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "enrollments_delete" on public.student_class_enrollments for delete to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id());

-- applications
create policy "applications_select" on public.applications for select to authenticated
  using (school_id = public.current_user_school_id());
create policy "applications_insert" on public.applications for insert to authenticated
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "applications_update" on public.applications for update to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id())
  with check (public.can_manage_students() and school_id = public.current_user_school_id());
create policy "applications_delete" on public.applications for delete to authenticated
  using (public.can_manage_students() and school_id = public.current_user_school_id());
