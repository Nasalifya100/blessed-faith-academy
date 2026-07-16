-- ===========================================================================
-- Sprint 4: Normalize admission numbers on write
--
-- File: 20260716150100_admission_normalize_on_write.sql
--
-- Fails if case-insensitive duplicates exist (no silent merge).
-- Stores admission_number as upper(trim(...)) via trigger.
-- Confirms unique index on (school_id, lower(admission_number)).
-- ===========================================================================

do $$
declare
  v_count int;
begin
  select count(*)
  into v_count
  from (
    select 1
    from public.students
    group by school_id, lower(admission_number)
    having count(*) > 1
  ) as d;

  if v_count > 0 then
    raise exception
      'Cannot normalize admission numbers: % case-insensitive duplicate group(s) exist. Run the Sprint 4 detection query in OPERATIONS.md and resolve manually first.',
      v_count;
  end if;
end;
$$;

-- Ensure case-insensitive uniqueness (safe if Sprint 3 already applied).
create unique index if not exists students_school_admission_number_lower_uidx
  on public.students (school_id, lower(admission_number));

create or replace function public.normalize_admission_number()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.admission_number := upper(trim(new.admission_number));
  if new.admission_number = '' then
    raise exception 'Admission number is required.';
  end if;
  return new;
end;
$$;

drop trigger if exists students_normalize_admission_number on public.students;
create trigger students_normalize_admission_number
before insert or update of admission_number on public.students
for each row
execute function public.normalize_admission_number();

comment on function public.normalize_admission_number() is
  'Canonicalizes admission_number to upper(trim(...)) before write.';

-- Best-effort normalize existing rows that are unique under lower().
update public.students
set admission_number = upper(trim(admission_number))
where admission_number is distinct from upper(trim(admission_number));
