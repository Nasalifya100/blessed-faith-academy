-- ===========================================================================
-- Phase 2 Stage A: Payment allocations SCHEMA + TOOLING (inactive)
--
-- Creates tables, RLS, helpers, diagnostics, and readiness gate.
-- Does NOT:
--   * auto-run historical backfill
--   * activate overpayment / credit recording RPCs
--   * revoke payments INSERT (still uses legacy record_payment)
--
-- Release order:
--   A) this migration
--   B) manual diagnose_finance_pre_allocation()
--   C) manual run_payment_allocation_backfill()  [see 20260719150100]
--   D) manual validate_payment_allocation_invariants()
--   E) 20260719150200 activation migration + app deploy
-- ===========================================================================

-- Readiness gate (per school). Activation sets activated_at.
create table if not exists public.finance_allocation_gates (
  school_id              uuid primary key references public.schools(id) on delete restrict,
  diagnostics_ok_at      timestamptz,
  backfill_completed_at  timestamptz,
  invariants_ok_at       timestamptz,
  activated_at           timestamptz,
  last_diagnostics       jsonb,
  last_backfill          jsonb,
  last_validation        jsonb,
  updated_at             timestamptz not null default now(),
  updated_by             uuid references public.profiles(id) on delete set null
);

comment on table public.finance_allocation_gates is
  'Controlled readiness gate for payment-allocation activation. Backfill must not run from ordinary app clients.';

alter table public.finance_allocation_gates enable row level security;

drop policy if exists "finance_allocation_gates_select" on public.finance_allocation_gates;
create policy "finance_allocation_gates_select"
  on public.finance_allocation_gates
  for select to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.is_administrator()
  );

revoke insert, update, delete on table public.finance_allocation_gates
  from anon, authenticated;
grant select on table public.finance_allocation_gates to authenticated;

create or replace function public.finance_allocations_are_active(p_school_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.finance_allocation_gates as g
    where g.school_id = p_school_id
      and g.activated_at is not null
  );
$$;

revoke all on function public.finance_allocations_are_active(uuid)
  from public, anon;
grant execute on function public.finance_allocations_are_active(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 1. payment_allocations
-- ---------------------------------------------------------------------------
create table if not exists public.payment_allocations (
  id               uuid primary key default gen_random_uuid(),
  school_id        uuid not null references public.schools(id) on delete restrict,
  student_id       uuid not null references public.students(id) on delete restrict,
  payment_id       uuid not null references public.payments(id) on delete restrict,
  charge_id        uuid not null references public.charges(id) on delete restrict,
  amount           numeric(12, 2) not null,
  created_by       uuid references public.profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  reversed_at      timestamptz,
  reversed_by      uuid references public.profiles(id) on delete set null,
  reversal_reason  text,

  constraint payment_allocations_amount_positive check (amount > 0),
  constraint payment_allocations_reversal_consistency check (
    (reversed_at is null and reversed_by is null and reversal_reason is null)
    or (
      reversed_at is not null
      and reversed_by is not null
      and coalesce(trim(reversal_reason), '') <> ''
    )
  )
);

comment on table public.payment_allocations is
  'Links portions of completed payments to charges. Soft-reversed via reversed_at; never hard-deleted by clients. Unallocated completed payment remainder = available pupil credit.';

create index if not exists payment_allocations_school_idx
  on public.payment_allocations (school_id);

create index if not exists payment_allocations_student_idx
  on public.payment_allocations (student_id, created_at);

create index if not exists payment_allocations_payment_idx
  on public.payment_allocations (payment_id)
  where reversed_at is null;

create index if not exists payment_allocations_charge_idx
  on public.payment_allocations (charge_id)
  where reversed_at is null;

create index if not exists payment_allocations_created_idx
  on public.payment_allocations (created_at);

create index if not exists payment_allocations_active_student_idx
  on public.payment_allocations (student_id)
  where reversed_at is null;

create index if not exists payment_allocations_payment_all_idx
  on public.payment_allocations (payment_id);

-- ---------------------------------------------------------------------------
-- 2. finance_event_audits (append-only)
-- ---------------------------------------------------------------------------
create table if not exists public.finance_event_audits (
  id             uuid primary key default gen_random_uuid(),
  school_id      uuid not null references public.schools(id) on delete restrict,
  student_id     uuid references public.students(id) on delete set null,
  event_type     text not null,
  payment_id     uuid references public.payments(id) on delete set null,
  charge_id      uuid references public.charges(id) on delete set null,
  allocation_id  uuid references public.payment_allocations(id) on delete set null,
  amount         numeric(12, 2),
  actor_id       uuid references public.profiles(id) on delete set null,
  reason         text,
  metadata       jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),

  constraint finance_event_audits_event_type_check check (
    event_type in (
      'payment_recorded',
      'allocation_created',
      'advance_credit_created',
      'credit_applied',
      'payment_voided',
      'allocations_reversed',
      'historical_backfill'
    )
  )
);

create index if not exists finance_event_audits_school_created_idx
  on public.finance_event_audits (school_id, created_at desc);

create index if not exists finance_event_audits_student_created_idx
  on public.finance_event_audits (student_id, created_at desc);

create index if not exists finance_event_audits_payment_idx
  on public.finance_event_audits (payment_id, created_at desc);

comment on table public.finance_event_audits is
  'Append-only finance events. No secrets or payment credentials stored.';

-- ---------------------------------------------------------------------------
-- 3. RLS / grants — clients select only; writes via SECURITY DEFINER RPCs
-- ---------------------------------------------------------------------------
alter table public.payment_allocations enable row level security;
alter table public.finance_event_audits enable row level security;

drop policy if exists "payment_allocations_select" on public.payment_allocations;
create policy "payment_allocations_select"
  on public.payment_allocations
  for select
  to authenticated
  using (school_id = public.current_user_school_id());

drop policy if exists "finance_event_audits_select" on public.finance_event_audits;
create policy "finance_event_audits_select"
  on public.finance_event_audits
  for select
  to authenticated
  using (
    school_id = public.current_user_school_id()
    and public.can_manage_fees()
  );

revoke insert, update, delete on table public.payment_allocations
  from anon, authenticated;
revoke insert, update, delete on table public.finance_event_audits
  from anon, authenticated;

grant select on table public.payment_allocations to authenticated;
grant select on table public.finance_event_audits to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Helper: active allocation sums
-- ---------------------------------------------------------------------------
create or replace function public.payment_active_allocated(p_payment_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(pa.amount), 0)::numeric(12, 2)
  from public.payment_allocations as pa
  where pa.payment_id = p_payment_id
    and pa.reversed_at is null;
$$;

create or replace function public.charge_active_allocated(p_charge_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(sum(pa.amount), 0)::numeric(12, 2)
  from public.payment_allocations as pa
  join public.payments as p on p.id = pa.payment_id
  where pa.charge_id = p_charge_id
    and pa.reversed_at is null
    and p.status = 'completed'::public.payment_status;
$$;

create or replace function public.charge_remaining_balance(p_charge_id uuid)
returns numeric
language sql
stable
security invoker
set search_path = public
as $$
  select greatest(
    0,
    (
      select c.amount - public.charge_active_allocated(c.id)
      from public.charges as c
      where c.id = p_charge_id
        and c.status not in (
          'cancelled'::public.charge_status,
          'waived'::public.charge_status
        )
    )
  )::numeric(12, 2);
$$;

-- ---------------------------------------------------------------------------
-- 5. Charge eligibility / oldest-first ordering (shared)
-- ---------------------------------------------------------------------------
create or replace function public.log_finance_event(
  p_school_id uuid,
  p_student_id uuid,
  p_event_type text,
  p_payment_id uuid,
  p_charge_id uuid,
  p_allocation_id uuid,
  p_amount numeric,
  p_actor_id uuid,
  p_reason text,
  p_metadata jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.finance_event_audits (
    school_id,
    student_id,
    event_type,
    payment_id,
    charge_id,
    allocation_id,
    amount,
    actor_id,
    reason,
    metadata
  ) values (
    p_school_id,
    p_student_id,
    p_event_type,
    p_payment_id,
    p_charge_id,
    p_allocation_id,
    p_amount,
    p_actor_id,
    nullif(trim(coalesce(p_reason, '')), ''),
    coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.log_finance_event(
  uuid, uuid, text, uuid, uuid, uuid, numeric, uuid, text, jsonb
) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. Allocate unallocated remainder of one completed payment (FIFO charges)
-- ---------------------------------------------------------------------------
create or replace function public.allocate_payment_to_charges(
  p_payment_id uuid,
  p_actor_id uuid default null,
  p_source text default 'payment'
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_payment public.payments%rowtype;
  v_remaining numeric(12, 2);
  v_alloc numeric(12, 2) := 0;
  v_apply numeric(12, 2);
  v_charge record;
  v_allocation_id uuid;
  v_charge_remaining numeric(12, 2);
begin
  select * into v_payment
  from public.payments as p
  where p.id = p_payment_id
  for update of p;

  if v_payment.id is null then
    raise exception 'Payment was not found.';
  end if;

  if v_payment.status <> 'completed'::public.payment_status then
    raise exception 'Only completed payments can be allocated.';
  end if;

  v_remaining := (
    v_payment.amount - public.payment_active_allocated(v_payment.id)
  )::numeric(12, 2);

  if v_remaining < 0 then
    raise exception
      'Payment % is over-allocated (active allocations exceed payment amount). Blocking invariant.',
      v_payment.id;
  end if;

  if v_remaining = 0 then
    return 0;
  end if;

  -- Lock eligible charges oldest-first.
  for v_charge in
    select
      c.id,
      c.amount,
      c.student_id,
      c.school_id
    from public.charges as c
    join public.academic_years as ay on ay.id = c.academic_year_id
    left join public.terms as t on t.id = c.term_id
    where c.school_id = v_payment.school_id
      and c.student_id = v_payment.student_id
      and c.status not in (
        'cancelled'::public.charge_status,
        'waived'::public.charge_status
      )
    order by
      coalesce(ay.start_date, ay.created_at::date) asc nulls last,
      coalesce(t.start_date, (date '2000-01-01' + ((coalesce(t.term_number, 1) - 1) * 90))) asc nulls last,
      c.created_at asc,
      c.id asc
    for update of c
  loop
    exit when v_remaining <= 0;

    v_charge_remaining := (
      v_charge.amount - public.charge_active_allocated(v_charge.id)
    )::numeric(12, 2);

    if v_charge_remaining <= 0 then
      continue;
    end if;

    v_apply := least(v_remaining, v_charge_remaining);

    insert into public.payment_allocations (
      school_id,
      student_id,
      payment_id,
      charge_id,
      amount,
      created_by
    ) values (
      v_payment.school_id,
      v_payment.student_id,
      v_payment.id,
      v_charge.id,
      v_apply,
      p_actor_id
    )
    returning id into v_allocation_id;

    perform public.log_finance_event(
      v_payment.school_id,
      v_payment.student_id,
      'allocation_created',
      v_payment.id,
      v_charge.id,
      v_allocation_id,
      v_apply,
      p_actor_id,
      null,
      jsonb_build_object('source', p_source)
    );

    v_alloc := (v_alloc + v_apply)::numeric(12, 2);
    v_remaining := (v_remaining - v_apply)::numeric(12, 2);
  end loop;

  return v_alloc;
end;
$$;

revoke all on function public.allocate_payment_to_charges(uuid, uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. Student finance summary — GATED
--     Before activation: legacy outstanding = charges − payments, credit = 0
--     After activation: allocation-based outstanding + derived credit
-- ---------------------------------------------------------------------------
create or replace function public.get_student_finance_summary(p_student_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_current_year_id uuid;
  v_total_charges numeric(12, 2);
  v_total_payments numeric(12, 2);
  v_total_allocated numeric(12, 2);
  v_available_credit numeric(12, 2);
  v_outstanding numeric(12, 2);
  v_bf_outstanding numeric(12, 2);
  v_cy_outstanding numeric(12, 2);
  v_cy_charges numeric(12, 2);
  v_active boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  if not exists (
    select 1
    from public.students as s
    where s.id = p_student_id
      and s.school_id = v_school_id
  ) then
    raise exception 'Student was not found.';
  end if;

  v_active := public.finance_allocations_are_active(v_school_id);

  select ay.id
  into v_current_year_id
  from public.academic_years as ay
  where ay.school_id = v_school_id
    and ay.is_current
  limit 1;

  select coalesce(sum(c.amount), 0)
  into v_total_charges
  from public.charges as c
  where c.student_id = p_student_id
    and c.school_id = v_school_id
    and c.status not in (
      'cancelled'::public.charge_status,
      'waived'::public.charge_status
    );

  select coalesce(sum(p.amount), 0)
  into v_total_payments
  from public.payments as p
  where p.student_id = p_student_id
    and p.school_id = v_school_id
    and p.status = 'completed'::public.payment_status;

  if not v_active then
    -- Legacy path: prevent historical payments appearing as "full credit".
    v_total_allocated := least(v_total_payments, v_total_charges)::numeric(12, 2);
    v_available_credit := 0;
    v_outstanding := greatest(0, v_total_charges - v_total_payments)::numeric(12, 2);

    if v_current_year_id is null then
      v_cy_charges := 0;
      v_cy_outstanding := 0;
      v_bf_outstanding := v_outstanding;
    else
      select coalesce(sum(c.amount), 0)
      into v_cy_charges
      from public.charges as c
      where c.student_id = p_student_id
        and c.school_id = v_school_id
        and c.academic_year_id = v_current_year_id
        and c.status not in (
          'cancelled'::public.charge_status,
          'waived'::public.charge_status
        );

      select coalesce(sum(c.amount), 0)
      into v_bf_outstanding
      from public.charges as c
      where c.student_id = p_student_id
        and c.school_id = v_school_id
        and c.academic_year_id is distinct from v_current_year_id
        and c.status not in (
          'cancelled'::public.charge_status,
          'waived'::public.charge_status
        );

      -- Approximate year split under legacy model (payments lifetime).
      v_cy_outstanding := greatest(
        0,
        least(v_cy_charges, v_outstanding)
      )::numeric(12, 2);
      v_bf_outstanding := greatest(
        0,
        v_outstanding - v_cy_outstanding
      )::numeric(12, 2);
    end if;

    return jsonb_build_object(
      'student_id', p_student_id,
      'allocations_active', false,
      'total_active_charges', v_total_charges,
      'total_completed_payments', v_total_payments,
      'total_allocated', v_total_allocated,
      'available_credit', v_available_credit,
      'outstanding_balance', v_outstanding,
      'brought_forward_outstanding', v_bf_outstanding,
      'current_year_charges', v_cy_charges,
      'current_year_outstanding', v_cy_outstanding,
      'net_account_position', v_outstanding,
      'current_academic_year_id', v_current_year_id
    );
  end if;

  select coalesce(sum(pa.amount), 0)
  into v_total_allocated
  from public.payment_allocations as pa
  join public.payments as p on p.id = pa.payment_id
  where pa.student_id = p_student_id
    and pa.school_id = v_school_id
    and pa.reversed_at is null
    and p.status = 'completed'::public.payment_status;

  v_available_credit := greatest(0, v_total_payments - v_total_allocated)::numeric(12, 2);

  select coalesce(sum(
    greatest(0, c.amount - public.charge_active_allocated(c.id))
  ), 0)
  into v_outstanding
  from public.charges as c
  where c.student_id = p_student_id
    and c.school_id = v_school_id
    and c.status not in (
      'cancelled'::public.charge_status,
      'waived'::public.charge_status
    );

  if v_current_year_id is null then
    v_cy_charges := 0;
    v_cy_outstanding := 0;
    v_bf_outstanding := v_outstanding;
  else
    select coalesce(sum(c.amount), 0)
    into v_cy_charges
    from public.charges as c
    where c.student_id = p_student_id
      and c.school_id = v_school_id
      and c.academic_year_id = v_current_year_id
      and c.status not in (
        'cancelled'::public.charge_status,
        'waived'::public.charge_status
      );

    select coalesce(sum(
      greatest(0, c.amount - public.charge_active_allocated(c.id))
    ), 0)
    into v_cy_outstanding
    from public.charges as c
    where c.student_id = p_student_id
      and c.school_id = v_school_id
      and c.academic_year_id = v_current_year_id
      and c.status not in (
        'cancelled'::public.charge_status,
        'waived'::public.charge_status
      );

    select coalesce(sum(
      greatest(0, c.amount - public.charge_active_allocated(c.id))
    ), 0)
    into v_bf_outstanding
    from public.charges as c
    where c.student_id = p_student_id
      and c.school_id = v_school_id
      and c.academic_year_id is distinct from v_current_year_id
      and c.status not in (
        'cancelled'::public.charge_status,
        'waived'::public.charge_status
      );
  end if;

  return jsonb_build_object(
    'student_id', p_student_id,
    'allocations_active', true,
    'total_active_charges', v_total_charges,
    'total_completed_payments', v_total_payments,
    'total_allocated', v_total_allocated,
    'available_credit', v_available_credit,
    'outstanding_balance', v_outstanding,
    'brought_forward_outstanding', v_bf_outstanding,
    'current_year_charges', v_cy_charges,
    'current_year_outstanding', v_cy_outstanding,
    'net_account_position', (v_outstanding - v_available_credit)::numeric(12, 2),
    'current_academic_year_id', v_current_year_id
  );
end;
$$;

revoke all on function public.get_student_finance_summary(uuid) from public;
revoke all on function public.get_student_finance_summary(uuid) from anon;
grant execute on function public.get_student_finance_summary(uuid) to authenticated;

comment on function public.get_student_finance_summary(uuid) is
  'Pupil finance summary. Uses legacy charges−payments until finance_allocation_gates.activated_at is set; then allocation-based credit/outstanding.';
