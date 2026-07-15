-- ===========================================================================
-- Phase 9b: Ensure starter school rules exist (any school without rules)
-- Fixes 9a seed that only matched name = 'Blessed Faith Academy' exactly.
-- ===========================================================================

insert into public.school_rules (school_id, title, body, sort_order)
select s.id, r.title, r.body, r.sort_order
from public.schools s
cross join (values
  (
    'Punctuality',
    'Pupils must arrive at school on time and attend all lessons unless excused.',
    10
  ),
  (
    'School uniform',
    'The correct school uniform must be worn on all school days as directed by the school.',
    20
  ),
  (
    'Respect',
    'Pupils must show respect to teachers, staff, visitors, and fellow pupils at all times.',
    30
  ),
  (
    'Behaviour in class',
    'Pupils must listen to teachers, complete assigned work, and not disrupt lessons.',
    40
  ),
  (
    'Care of property',
    'School property and the belongings of others must be treated with care. Damage or theft will be taken seriously.',
    50
  ),
  (
    'Safety',
    'Pupils must follow safety instructions and must not leave the school grounds without permission.',
    60
  ),
  (
    'Discipline',
    'Pupils who break school rules may face appropriate disciplinary action as decided by the school.',
    70
  )
) as r(title, body, sort_order)
where not exists (
  select 1 from public.school_rules sr where sr.school_id = s.id
);
