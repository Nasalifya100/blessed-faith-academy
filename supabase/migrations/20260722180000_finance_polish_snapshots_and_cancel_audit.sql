-- ===========================================================================
-- Finance polish: payment snapshots + optional-charge cancel audit
-- Does NOT change allocation maths / FIFO / credit derivation rules.
-- ===========================================================================

-- 1. Immutable payment finance snapshots (one row per payment)
create table if not exists public.payment_finance_snapshots (
  payment_id uuid primary key references public.payments(id) on delete cascade,
  school_id uuid not null references public.schools(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  balance_before numeric(12, 2) not null,
  balance_after numeric(12, 2) not null,
  available_credit_before numeric(12, 2) not null,
  available_credit_after numeric(12, 2) not null,
  allocated_amount numeric(12, 2) not null,
  outstanding_after numeric(12, 2) not null,
  credit_created numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  constraint payment_finance_snapshots_amounts_non_negative check (
    balance_before >= 0
    and balance_after >= 0
    and available_credit_before >= 0
    and available_credit_after >= 0
    and allocated_amount >= 0
    and outstanding_after >= 0
    and credit_created >= 0
  )
);

create index if not exists payment_finance_snapshots_student_idx
  on public.payment_finance_snapshots (student_id, created_at desc);

comment on table public.payment_finance_snapshots is
  'Immutable receipt/payment financial snapshot written once at payment time. Never recalculated.';

alter table public.payment_finance_snapshots enable row level security;

drop policy if exists "payment_finance_snapshots_select" on public.payment_finance_snapshots;
create policy "payment_finance_snapshots_select"
  on public.payment_finance_snapshots
  for select
  to authenticated
  using (school_id = public.current_user_school_id());

revoke insert, update, delete on table public.payment_finance_snapshots
  from public, anon, authenticated;
grant select on table public.payment_finance_snapshots to authenticated;

-- 2. Allow optional_charge_cancelled audit event type
alter table public.finance_event_audits
  drop constraint if exists finance_event_audits_event_type_check;

alter table public.finance_event_audits
  add constraint finance_event_audits_event_type_check check (
    event_type in (
      'payment_recorded',
      'allocation_created',
      'advance_credit_created',
      'credit_applied',
      'payment_voided',
      'allocations_reversed',
      'historical_backfill',
      'optional_charge_cancelled'
    )
  );

-- 3. record_payment: capture before/after snapshots (allocation call unchanged)
create or replace function public.record_payment(
  p_student_id       uuid,
  p_amount           numeric,
  p_method           public.payment_method,
  p_idempotency_key  uuid,
  p_reference_number text default null,
  p_paid_on          date default ((now() at time zone 'Africa/Lusaka')::date),
  p_notes            text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id uuid := public.current_user_school_id();
  v_active boolean;
  v_prefix text;
  v_year text;
  v_head text;
  v_seq int;
  v_receipt_number text;
  v_payment_id uuid;
  v_outstanding_before numeric(12, 2);
  v_outstanding_after numeric(12, 2);
  v_credit_before numeric(12, 2) := 0;
  v_amount_allocated numeric(12, 2) := 0;
  v_credit_created numeric(12, 2) := 0;
  v_available_credit_after numeric(12, 2) := 0;
  v_summary jsonb;
  v_amount numeric(12, 2) := round(p_amount, 2);
  v_charged numeric(12, 2);
  v_paid numeric(12, 2);
begin
  if not public.can_manage_fees() then
    raise exception 'You are not authorized to record payments.';
  end if;
  if auth.uid() is null then
    raise exception 'You must be signed in to record a payment.';
  end if;
  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;
  if p_idempotency_key is null then
    raise exception 'An idempotency key is required to record a payment.';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'Payment amount must be greater than zero.';
  end if;
  if v_amount <> p_amount then
    raise exception 'Payment amount must have at most two decimal places.';
  end if;

  v_active := public.finance_allocations_are_active(v_school_id);

  select p.id into v_payment_id
  from public.payments as p
  where p.school_id = v_school_id and p.idempotency_key = p_idempotency_key;
  if v_payment_id is not null then
    v_summary := public.get_student_finance_summary(
      (select student_id from public.payments where id = v_payment_id)
    );
    return jsonb_build_object(
      'payment_id', v_payment_id,
      'receipt_number', (select receipt_number from public.payments where id = v_payment_id),
      'amount_received', (select amount from public.payments where id = v_payment_id),
      'amount_allocated', public.payment_active_allocated(v_payment_id),
      'credit_created', greatest(
        0,
        (select amount from public.payments where id = v_payment_id)
          - public.payment_active_allocated(v_payment_id)
      ),
      'outstanding_before', (
        select s.balance_before from public.payment_finance_snapshots s
        where s.payment_id = v_payment_id
      ),
      'outstanding_after', coalesce(
        (select s.outstanding_after from public.payment_finance_snapshots s
         where s.payment_id = v_payment_id),
        (v_summary->>'outstanding_balance')::numeric
      ),
      'available_credit_after', coalesce(
        (select s.available_credit_after from public.payment_finance_snapshots s
         where s.payment_id = v_payment_id),
        (v_summary->>'available_credit')::numeric
      ),
      'replay', true,
      'allocations_active', v_active
    );
  end if;

  if not exists (
    select 1 from public.students s
    where s.id = p_student_id and s.school_id = v_school_id
      and s.status = 'enrolled'::public.student_status
  ) then
    raise exception 'Student was not found or is not enrolled.';
  end if;

  perform pg_advisory_xact_lock(
    hashtext(v_school_id::text || ':' || p_student_id::text)
  );

  v_summary := public.get_student_finance_summary(p_student_id);
  v_outstanding_before := (v_summary->>'outstanding_balance')::numeric(12, 2);
  v_credit_before := coalesce((v_summary->>'available_credit')::numeric(12, 2), 0);

  if not v_active then
    select coalesce(sum(c.amount), 0) into v_charged
    from public.charges c
    where c.student_id = p_student_id and c.school_id = v_school_id
      and c.status not in ('cancelled'::public.charge_status, 'waived'::public.charge_status);
    select coalesce(sum(p.amount), 0) into v_paid
    from public.payments p
    where p.student_id = p_student_id and p.school_id = v_school_id
      and p.status = 'completed'::public.payment_status;
    v_outstanding_before := (v_charged - v_paid)::numeric(12, 2);
    v_credit_before := 0;
    if v_outstanding_before <= 0 then
      raise exception 'This student has no outstanding balance.';
    end if;
    if v_amount > v_outstanding_before then
      raise exception
        'Payment amount (K%) exceeds outstanding balance (K%). Partial payments are allowed up to the balance. Activate payment allocations after backfill to accept advance payments.',
        v_amount, v_outstanding_before;
    end if;
  end if;

  select coalesce(sch.receipt_prefix, 'R') into v_prefix
  from public.schools sch where sch.id = v_school_id;

  select ay.name into v_year
  from public.academic_years ay
  where ay.school_id = v_school_id and ay.is_current
  limit 1;
  if v_year is null then
    v_year := to_char((now() at time zone 'Africa/Lusaka')::date, 'YYYY');
  end if;
  v_head := v_prefix || '-' || v_year;

  perform 1 from public.payments p
  where p.school_id = v_school_id
    and p.receipt_number ~ ('^' || v_head || '-[0-9]+$')
  for update of p;

  select coalesce(max((regexp_replace(p.receipt_number, '^.*-', ''))::int), 0) + 1
  into v_seq
  from public.payments p
  where p.school_id = v_school_id
    and p.receipt_number ~ ('^' || v_head || '-[0-9]+$');

  v_receipt_number := v_head || '-' || lpad(v_seq::text, 4, '0');

  begin
    insert into public.payments (
      school_id, student_id, amount, method, reference_number, receipt_number,
      paid_on, notes, status, recorded_by, idempotency_key
    ) values (
      v_school_id, p_student_id, v_amount, p_method, nullif(p_reference_number, ''),
      v_receipt_number,
      coalesce(p_paid_on, (now() at time zone 'Africa/Lusaka')::date),
      nullif(p_notes, ''), 'completed'::public.payment_status, auth.uid(),
      p_idempotency_key
    ) returning id into v_payment_id;
  exception
    when unique_violation then
      select p.id into v_payment_id from public.payments p
      where p.school_id = v_school_id and p.idempotency_key = p_idempotency_key;
      if v_payment_id is not null then
        v_summary := public.get_student_finance_summary(p_student_id);
        return jsonb_build_object(
          'payment_id', v_payment_id,
          'receipt_number', (select receipt_number from public.payments where id = v_payment_id),
          'amount_received', (select amount from public.payments where id = v_payment_id),
          'amount_allocated', public.payment_active_allocated(v_payment_id),
          'credit_created', 0,
          'outstanding_before', null,
          'outstanding_after', (v_summary->>'outstanding_balance')::numeric,
          'available_credit_after', (v_summary->>'available_credit')::numeric,
          'replay', true,
          'allocations_active', v_active
        );
      end if;
      raise;
  end;

  if v_active then
    v_amount_allocated := public.allocate_payment_to_charges(
      v_payment_id, auth.uid(), 'payment'
    );
    v_credit_created := greatest(0, v_amount - v_amount_allocated)::numeric(12, 2);
  else
    v_amount_allocated := v_amount;
    v_credit_created := 0;
  end if;

  v_summary := public.get_student_finance_summary(p_student_id);
  v_outstanding_after := (v_summary->>'outstanding_balance')::numeric(12, 2);
  v_available_credit_after := (v_summary->>'available_credit')::numeric(12, 2);

  insert into public.payment_finance_snapshots (
    payment_id, school_id, student_id,
    balance_before, balance_after,
    available_credit_before, available_credit_after,
    allocated_amount, outstanding_after, credit_created
  ) values (
    v_payment_id, v_school_id, p_student_id,
    v_outstanding_before, v_outstanding_after,
    v_credit_before, v_available_credit_after,
    v_amount_allocated, v_outstanding_after, v_credit_created
  );

  perform public.log_finance_event(
    v_school_id, p_student_id, 'payment_recorded', v_payment_id,
    null, null, v_amount, auth.uid(), null,
    jsonb_build_object(
      'receipt_number', v_receipt_number,
      'amount_allocated', v_amount_allocated,
      'credit_created', v_credit_created,
      'allocations_active', v_active,
      'balance_before', v_outstanding_before,
      'balance_after', v_outstanding_after
    )
  );

  if v_active and v_credit_created > 0 then
    perform public.log_finance_event(
      v_school_id, p_student_id, 'advance_credit_created', v_payment_id,
      null, null, v_credit_created, auth.uid(), null,
      jsonb_build_object('source', 'payment')
    );
  end if;

  return jsonb_build_object(
    'payment_id', v_payment_id,
    'receipt_number', v_receipt_number,
    'amount_received', v_amount,
    'amount_allocated', v_amount_allocated,
    'credit_created', v_credit_created,
    'outstanding_before', v_outstanding_before,
    'outstanding_after', v_outstanding_after,
    'available_credit_before', v_credit_before,
    'available_credit_after', v_available_credit_after,
    'replay', false,
    'allocations_active', v_active
  );
end;
$$;

revoke all on function public.record_payment(
  uuid, numeric, public.payment_method, uuid, text, date, text
) from public, anon;
grant execute on function public.record_payment(
  uuid, numeric, public.payment_method, uuid, text, date, text
) to authenticated;

-- 4. cancel_optional_charge: keep DEFINER/GUC fix; add audit event
create or replace function public.cancel_optional_charge(
  p_charge_id uuid,
  p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_school_id   uuid := public.current_user_school_id();
  v_student_id  uuid;
  v_category    public.fee_category;
  v_is_optional boolean;
  v_status      public.charge_status;
  v_amount      numeric(12, 2);
  v_allocated   numeric(12, 2);
  v_reason      text := nullif(trim(coalesce(p_reason, '')), '');
begin
  if auth.uid() is null then
    raise exception 'You must be signed in to cancel a charge.';
  end if;

  if not public.can_manage_fees() then
    raise exception 'You are not authorized to cancel optional charges.';
  end if;

  if v_school_id is null then
    raise exception 'Your account is not linked to a school.';
  end if;

  select c.student_id, fi.category, fi.is_optional, c.status, c.amount
  into v_student_id, v_category, v_is_optional, v_status, v_amount
  from public.charges as c
  join public.fee_items as fi on fi.id = c.fee_item_id
  where c.id = p_charge_id
    and c.school_id = v_school_id
  for update of c;

  if v_status is null then
    raise exception 'Charge was not found.';
  end if;

  if not coalesce(v_is_optional, false)
     or v_category not in (
       'meal'::public.fee_category,
       'uniform'::public.fee_category
     )
  then
    raise exception 'Only optional meal or uniform charges can be cancelled here.';
  end if;

  if v_status = 'cancelled'::public.charge_status then
    return;
  end if;

  if v_status <> 'outstanding'::public.charge_status then
    raise exception
      'Only outstanding (unpaid) optional charges can be cancelled.';
  end if;

  v_allocated := public.charge_active_allocated(p_charge_id);
  if v_allocated > 0 then
    raise exception
      'This charge has payment allocations (K%). Reverse the related payment(s) before cancelling.',
      v_allocated;
  end if;

  perform set_config('app.allow_charge_status_update', 'on', true);

  update public.charges as c
  set status = 'cancelled'::public.charge_status
  where c.id = p_charge_id
    and c.school_id = v_school_id
    and c.status = 'outstanding'::public.charge_status;

  if not found then
    raise exception 'Could not cancel charge.';
  end if;

  perform public.log_finance_event(
    v_school_id,
    v_student_id,
    'optional_charge_cancelled',
    null,
    p_charge_id,
    null,
    v_amount,
    auth.uid(),
    coalesce(v_reason, 'Optional charge cancelled'),
    jsonb_build_object(
      'previous_status', 'outstanding',
      'new_status', 'cancelled',
      'category', v_category,
      'event_code', 'OPTIONAL_CHARGE_CANCELLED'
    )
  );
end;
$$;

comment on function public.cancel_optional_charge(uuid, text) is
  'SECURITY DEFINER soft-cancel for outstanding optional meal/uniform charges. Logs optional_charge_cancelled audit.';

revoke all on function public.cancel_optional_charge(uuid, text) from public, anon;
grant execute on function public.cancel_optional_charge(uuid, text) to authenticated;

-- Drop old single-arg signature if it still exists separately.
drop function if exists public.cancel_optional_charge(uuid);
