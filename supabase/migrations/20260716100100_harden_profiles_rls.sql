-- ===========================================================================
-- Sprint 2 (Security): school-scope profile write RLS
--
-- File: 20260716100100_harden_profiles_rls.sql
-- ===========================================================================

drop policy if exists "profiles_insert_admin" on public.profiles;
drop policy if exists "profiles_update_admin" on public.profiles;
drop policy if exists "profiles_delete_admin" on public.profiles;

create policy "profiles_insert_admin"
on public.profiles for insert
to authenticated
with check (
  public.is_administrator()
  and school_id = public.current_user_school_id()
);

create policy "profiles_update_admin"
on public.profiles for update
to authenticated
using (
  public.is_administrator()
  and school_id = public.current_user_school_id()
)
with check (
  public.is_administrator()
  and school_id = public.current_user_school_id()
);

-- Prefer deactivate (is_active) over hard delete; keep delete school-scoped
-- for emergency cleanup only.
create policy "profiles_delete_admin"
on public.profiles for delete
to authenticated
using (
  public.is_administrator()
  and school_id = public.current_user_school_id()
);
