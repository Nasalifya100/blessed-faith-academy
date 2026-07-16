-- ===========================================================================
-- Sprint 4: Revoke remaining hard DELETE on operational tables
--
-- File: 20260716150400_revoke_remaining_deletes.sql
--
-- Prefer soft-deactivate (is_active) / archive workflows. Authenticated roles
-- must not hard-delete history or catalogue rows.
-- ===========================================================================

-- Guardians / links / enrolments / applications
drop policy if exists "guardians_delete" on public.guardians;
drop policy if exists "student_guardians_delete" on public.student_guardians;
drop policy if exists "enrollments_delete" on public.student_class_enrollments;
drop policy if exists "applications_delete" on public.applications;

revoke delete on table public.guardians from anon, authenticated;
revoke delete on table public.student_guardians from anon, authenticated;
revoke delete on table public.student_class_enrollments from anon, authenticated;
revoke delete on table public.applications from anon, authenticated;

-- Fee catalogue / requirements
drop policy if exists "fee_items_delete" on public.fee_items;
drop policy if exists "fee_schedules_delete" on public.fee_schedules;
drop policy if exists "requirement_items_delete" on public.requirement_items;
drop policy if exists "student_requirement_checks_delete" on public.student_requirement_checks;

revoke delete on table public.fee_items from anon, authenticated;
revoke delete on table public.fee_schedules from anon, authenticated;
revoke delete on table public.requirement_items from anon, authenticated;
revoke delete on table public.student_requirement_checks from anon, authenticated;

-- Core config (break-glass only via service role / SQL editor)
drop policy if exists "schools_delete" on public.schools;
drop policy if exists "academic_years_delete" on public.academic_years;
drop policy if exists "terms_delete" on public.terms;
drop policy if exists "grade_levels_delete" on public.grade_levels;
drop policy if exists "classes_delete" on public.classes;

revoke delete on table public.schools from anon, authenticated;
revoke delete on table public.academic_years from anon, authenticated;
revoke delete on table public.terms from anon, authenticated;
revoke delete on table public.grade_levels from anon, authenticated;
revoke delete on table public.classes from anon, authenticated;

-- Profiles: deactivate instead of delete
drop policy if exists "profiles_delete_admin" on public.profiles;
revoke delete on table public.profiles from anon, authenticated;
