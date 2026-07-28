-- ===========================================================================
-- Phase 2D.2 — Report card capabilities
-- Extends has_academic_capability with REPORT_CARDS_* defaults.
-- ===========================================================================

create or replace function public.has_academic_capability(p_capability text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role public.staff_role;
  v_cap text := upper(btrim(coalesce(p_capability, '')));
begin
  if auth.uid() is null then
    return false;
  end if;

  select role into v_role
  from public.profiles
  where id = auth.uid() and is_active;

  if not found then
    return false;
  end if;

  if v_role = 'administrator'::public.staff_role then
    return true;
  end if;

  if v_role = 'headteacher'::public.staff_role then
    if v_cap in (
      'ACADEMIC_CONFIGURATION_VIEW',
      'SUBJECTS_MANAGE',
      'SUBJECT_OFFERINGS_MANAGE',
      'TEACHING_ASSIGNMENTS_MANAGE',
      'GRADING_SCHEMES_MANAGE',
      'ASSESSMENT_TYPES_MANAGE',
      'ASSESSMENT_WEIGHTS_MANAGE',
      'ACADEMIC_CALENDAR_MANAGE',
      'ACADEMIC_SETTINGS_MANAGE',
      'EXAM_VIEW',
      'EXAM_ROOMS_MANAGE',
      'EXAM_PERIODS_MANAGE',
      'EXAMS_MANAGE',
      'EXAM_SCHEDULE_MANAGE',
      'EXAM_TEMPLATES_MANAGE',
      'GRADEBOOK_ENTER',
      'GRADEBOOK_VIEW_ALL',
      'GRADEBOOK_REOPEN',
      'GRADEBOOK_CORRECT',
      'GRADEBOOK_LOCK',
      'RESULTS_VIEW',
      'RESULTS_VIEW_ALL',
      'RESULTS_RECALCULATE',
      'PROMOTION_POLICIES_MANAGE',
      'REPORT_CARDS_VIEW',
      'REPORT_CARDS_VIEW_ALL',
      'REPORT_CARDS_EDIT_REMARKS',
      'REPORT_CARDS_REVIEW',
      'REPORT_CARDS_APPROVE',
      'REPORT_CARDS_PUBLISH',
      'REPORT_CARDS_PRINT',
      'REPORT_CARD_SETTINGS_MANAGE'
    ) then
      return true;
    end if;
  end if;

  if v_cap in ('ACADEMIC_CONFIGURATION_VIEW', 'EXAM_VIEW') then
    return v_role in (
      'teacher'::public.staff_role,
      'secretary'::public.staff_role,
      'bursar'::public.staff_role,
      'headteacher'::public.staff_role
    );
  end if;

  if v_cap = 'GRADEBOOK_ENTER' then
    return v_role = 'teacher'::public.staff_role;
  end if;

  if v_cap = 'RESULTS_VIEW' then
    return v_role = 'teacher'::public.staff_role;
  end if;

  -- Teachers: scoped report-card view, remarks, and print.
  if v_cap in (
    'REPORT_CARDS_VIEW',
    'REPORT_CARDS_EDIT_REMARKS',
    'REPORT_CARDS_PRINT'
  ) then
    return v_role = 'teacher'::public.staff_role;
  end if;

  -- Secretary/bursar: no default report-card access (marks-sensitive documents).
  -- Grant via academic_capabilities when school policy requires it.

  return exists (
    select 1
    from public.academic_capabilities c
    where c.profile_id = auth.uid()
      and c.capability = v_cap
      and c.is_active
      and c.school_id = public.current_user_school_id()
  );
end;
$$;

revoke all on function public.has_academic_capability(text) from public;
grant execute on function public.has_academic_capability(text) to authenticated;

comment on function public.has_academic_capability(text) is
  'Academic/exam/gradebook/results/report-card capability defaults by role plus optional academic_capabilities grants.';
