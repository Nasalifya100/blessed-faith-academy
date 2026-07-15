-- ===========================================================================
-- Sprint 2 (Security): harden handle_new_user — no metadata role escalation
--
-- File: 20260716100000_harden_handle_new_user.sql
--
-- SECURITY: Never trust auth.users.raw_user_meta_data->>'role'.
-- New profiles always start as least-privilege 'teacher'.
-- Administrators assign the real role via profiles UPDATE after createUser.
-- ===========================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid;
begin
  select s.id
  into v_school_id
  from public.schools as s
  order by s.created_at
  limit 1;

  insert into public.profiles (id, full_name, role, school_id)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'full_name', ''), new.email),
    'teacher'::public.staff_role,
    v_school_id
  );

  return new;
end;
$$;

comment on function public.handle_new_user() is
  'SECURITY DEFINER: creates profiles on auth signup. Ignores metadata role; always inserts teacher. search_path=public.';
