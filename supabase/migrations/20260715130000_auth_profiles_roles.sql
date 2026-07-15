-- ===========================================================================
-- Phase 2a: Authentication, staff profiles, roles, and Row Level Security
--
-- Adds:
--   * staff_role enum (the five roles)
--   * profiles table (1:1 with Supabase auth.users)
--   * a trigger that auto-creates a profile when an auth user is created
--   * helper functions used by security policies
--   * RLS policies for profiles and the Phase 1 config tables
--   * homeroom_teacher_id on classes (now that profiles exist)
--
-- After running this, create your first user in the Supabase dashboard
-- (Authentication -> Users -> Add user), then promote them to administrator
-- with the statement shown at the bottom of this file.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- The five staff roles.
-- ---------------------------------------------------------------------------
create type public.staff_role as enum (
  'administrator',
  'headteacher',
  'bursar',
  'secretary',
  'teacher'
);

-- ---------------------------------------------------------------------------
-- profiles: one row per staff member, linked to Supabase auth.users.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  school_id  uuid references public.schools(id) on delete restrict,
  full_name  text not null,
  role       public.staff_role not null default 'secretary',
  phone      text,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Auto-create a profile whenever a new auth user is added. Runs as the table
-- owner (security definer), so it works regardless of RLS. The role and name
-- can be provided via user metadata; otherwise sensible defaults are used and
-- the user is attached to the (currently only) school.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, school_id)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email),
    coalesce((new.raw_user_meta_data->>'role')::public.staff_role, 'secretary'),
    (select id from public.schools order by created_at limit 1)
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Helper functions used inside RLS policies. They are SECURITY DEFINER so they
-- can read profiles without triggering the profiles RLS policies (which would
-- otherwise cause infinite recursion).
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.staff_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.current_user_school_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select school_id from public.profiles where id = auth.uid();
$$;

create or replace function public.is_administrator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'administrator' and is_active
  );
$$;

-- ---------------------------------------------------------------------------
-- Now that profiles exist, link a homeroom teacher to a class (optional).
-- ---------------------------------------------------------------------------
alter table public.classes
  add column homeroom_teacher_id uuid references public.profiles(id) on delete set null;

-- ---------------------------------------------------------------------------
-- RLS: profiles
-- ---------------------------------------------------------------------------
alter table public.profiles enable row level security;

-- Everyone can read their own profile.
create policy "profiles_select_own"
on public.profiles for select
to authenticated
using (id = auth.uid());

-- Administrators can read all profiles in their school.
create policy "profiles_select_admin"
on public.profiles for select
to authenticated
using (public.is_administrator() and school_id = public.current_user_school_id());

-- Administrators can create/update/delete profiles.
create policy "profiles_insert_admin"
on public.profiles for insert
to authenticated
with check (public.is_administrator());

create policy "profiles_update_admin"
on public.profiles for update
to authenticated
using (public.is_administrator())
with check (public.is_administrator());

create policy "profiles_delete_admin"
on public.profiles for delete
to authenticated
using (public.is_administrator());

-- ---------------------------------------------------------------------------
-- RLS: config tables. Any logged-in staff may READ; only administrators may
-- INSERT/UPDATE/DELETE. (Multi-school scoping can be tightened later.)
-- ---------------------------------------------------------------------------

-- schools
create policy "schools_select" on public.schools for select to authenticated using (true);
create policy "schools_insert" on public.schools for insert to authenticated with check (public.is_administrator());
create policy "schools_update" on public.schools for update to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "schools_delete" on public.schools for delete to authenticated using (public.is_administrator());

-- academic_years
create policy "academic_years_select" on public.academic_years for select to authenticated using (true);
create policy "academic_years_insert" on public.academic_years for insert to authenticated with check (public.is_administrator());
create policy "academic_years_update" on public.academic_years for update to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "academic_years_delete" on public.academic_years for delete to authenticated using (public.is_administrator());

-- terms
create policy "terms_select" on public.terms for select to authenticated using (true);
create policy "terms_insert" on public.terms for insert to authenticated with check (public.is_administrator());
create policy "terms_update" on public.terms for update to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "terms_delete" on public.terms for delete to authenticated using (public.is_administrator());

-- grade_levels
create policy "grade_levels_select" on public.grade_levels for select to authenticated using (true);
create policy "grade_levels_insert" on public.grade_levels for insert to authenticated with check (public.is_administrator());
create policy "grade_levels_update" on public.grade_levels for update to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "grade_levels_delete" on public.grade_levels for delete to authenticated using (public.is_administrator());

-- classes
create policy "classes_select" on public.classes for select to authenticated using (true);
create policy "classes_insert" on public.classes for insert to authenticated with check (public.is_administrator());
create policy "classes_update" on public.classes for update to authenticated using (public.is_administrator()) with check (public.is_administrator());
create policy "classes_delete" on public.classes for delete to authenticated using (public.is_administrator());

-- ===========================================================================
-- AFTER creating your first user in the dashboard, promote them to admin by
-- running ONE of the following (replace the email), then re-run:
--
--   update public.profiles
--   set role = 'administrator'
--   where id = (select id from auth.users where email = 'you@example.com');
-- ===========================================================================
