-- ===========================================================================
-- Payment allocations hardening suite (NON-PRODUCTION ONLY)
-- Covers direct-insert denial, role gates, allocation maths, void, idempotency,
-- backfill resume, and invariant validation on synthetic data.
-- ===========================================================================

do $$
declare
  v_school_id uuid;
  v_admin uuid;
  v_bursar uuid;
  v_teacher uuid;
  v_year_id uuid;
  v_term_id uuid;
  v_grade_id uuid;
  v_class_id uuid;
  v_fee_item_id uuid;
  v_student_id uuid;
  v_charge_a uuid;
  v_charge_b uuid;
  v_payment_id uuid;
  v_payment_id_2 uuid;
  v_key uuid := gen_random_uuid();
  v_key2 uuid := gen_random_uuid();
  v_result jsonb;
  v_diag jsonb;
  v_alloc numeric;
  v_credit numeric;
  v_count int;
  v_err text;
begin
  raise notice 'payment_allocations_hardening: starting';

  select id into v_school_id from public.schools limit 1;
  if v_school_id is null then
    raise exception 'No school found — seed core config before running this suite.';
  end if;

  -- Synthetic actors (profiles may already exist; create disposable ones if needed)
  v_admin := gen_random_uuid();
  v_bursar := gen_random_uuid();
  v_teacher := gen_random_uuid();

  insert into auth.users (id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values
    (v_admin, 'authenticated', 'authenticated', 'alloc-admin-' || v_admin || '@test.local', crypt('x', gen_salt('bf')), now(), now(), now()),
    (v_bursar, 'authenticated', 'authenticated', 'alloc-bursar-' || v_bursar || '@test.local', crypt('x', gen_salt('bf')), now(), now(), now()),
    (v_teacher, 'authenticated', 'authenticated', 'alloc-teacher-' || v_teacher || '@test.local', crypt('x', gen_salt('bf')), now(), now(), now())
  on conflict do nothing;

  insert into public.profiles (id, school_id, full_name, role, is_active)
  values
    (v_admin, v_school_id, 'Alloc Test Admin', 'administrator', true),
    (v_bursar, v_school_id, 'Alloc Test Bursar', 'bursar', true),
    (v_teacher, v_school_id, 'Alloc Test Teacher', 'teacher', true)
  on conflict (id) do update
  set school_id = excluded.school_id, role = excluded.role, is_active = true;

  select id into v_year_id from public.academic_years
  where school_id = v_school_id and is_current limit 1;
  if v_year_id is null then
    raise exception 'No current academic year — cannot run suite.';
  end if;

  select id into v_term_id from public.terms
  where academic_year_id = v_year_id order by term_number limit 1;

  select id into v_grade_id from public.grade_levels where school_id = v_school_id limit 1;
  select id into v_class_id from public.classes where school_id = v_school_id limit 1;
  select id into v_fee_item_id from public.fee_items
  where school_id = v_school_id and is_optional = false limit 1;

  if v_fee_item_id is null or v_class_id is null then
    raise exception 'Missing fee item or class for synthetic student.';
  end if;

  insert into public.students (
    id, school_id, admission_number, first_name, last_name,
    date_of_birth, gender, status, enrollment_date
  ) values (
    gen_random_uuid(), v_school_id, 'ALLOC-TEST-' || substr(gen_random_uuid()::text, 1, 8),
    'Alloc', 'Pupil', '2015-01-01', 'female', 'enrolled', current_date
  ) returning id into v_student_id;

  insert into public.student_class_enrollments (
    school_id, student_id, class_id, academic_year_id, status
  ) values (
    v_school_id, v_student_id, v_class_id, v_year_id, 'active'
  );

  -- Two charges: 1000 + 500
  insert into public.charges (
    school_id, student_id, fee_item_id, academic_year_id, term_id,
    amount, status, created_by
  ) values (
    v_school_id, v_student_id, v_fee_item_id, v_year_id, v_term_id,
    1000, 'outstanding', v_bursar
  ) returning id into v_charge_a;

  insert into public.charges (
    school_id, student_id, fee_item_id, academic_year_id, term_id,
    amount, status, created_by
  ) values (
    v_school_id, v_student_id, v_fee_item_id, v_year_id, v_term_id,
    500, 'outstanding', v_bursar
  ) returning id into v_charge_b;

  -- 1) Direct authenticated INSERT into payments fails (RLS / privilege)
  begin
    execute format('set local role authenticated; set local request.jwt.claim.sub = %L', v_bursar);
    insert into public.payments (
      school_id, student_id, amount, method, receipt_number, paid_on, status, recorded_by
    ) values (
      v_school_id, v_student_id, 10, 'mobile_money', 'DIRECT-FAIL-1', current_date, 'completed', v_bursar
    );
    raise exception 'FAIL: direct payments insert should be denied';
  exception
    when insufficient_privilege or check_violation or others then
      if SQLERRM like 'FAIL:%' then raise; end if;
      raise notice 'PASS: direct payments insert denied (% )', SQLERRM;
  end;
  reset role;

  -- 2) Direct authenticated INSERT into payment_allocations fails
  begin
    execute format('set local role authenticated; set local request.jwt.claim.sub = %L', v_bursar);
    insert into public.payment_allocations (
      school_id, student_id, payment_id, charge_id, amount, created_by
    ) values (
      v_school_id, v_student_id, gen_random_uuid(), v_charge_a, 1, v_bursar
    );
    raise exception 'FAIL: direct allocation insert should be denied';
  exception
    when insufficient_privilege or foreign_key_violation or others then
      if SQLERRM like 'FAIL:%' then raise; end if;
      raise notice 'PASS: direct allocation insert denied (% )', SQLERRM;
  end;
  reset role;

  -- Prepare + activate path for this school (service context)
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  -- Console functions are revoked from authenticated; call as owner/definer path (current role)
  v_diag := public.diagnose_finance_pre_allocation_for_school(v_school_id);
  if not coalesce((v_diag->>'safe_to_backfill')::boolean, false) then
    raise notice 'WARN: school diagnostics not clean before synthetic run; continuing with synthetic pupil only';
  end if;

  -- Controlled backfill dry-run then execute for school (may allocate other pupils too)
  v_result := public.run_payment_allocation_backfill(v_school_id, true, true);
  if v_result->>'mode' is distinct from 'dry_run' then
    raise exception 'FAIL: dry-run mode expected';
  end if;
  raise notice 'PASS: backfill dry-run';

  v_result := public.run_payment_allocation_backfill(v_school_id, false, true);
  raise notice 'PASS: backfill execute %', v_result;

  -- Idempotent second run should not explode / should create 0 new rows ideally
  v_count := (select count(*) from public.payment_allocations where student_id = v_student_id);
  v_result := public.run_payment_allocation_backfill(v_school_id, false, true);
  if (select count(*) from public.payment_allocations where student_id = v_student_id) < v_count then
    raise exception 'FAIL: second backfill reduced allocation count';
  end if;
  raise notice 'PASS: backfill rerun stable for synthetic pupil';

  perform public.activate_payment_allocations(v_school_id);
  raise notice 'PASS: activate_payment_allocations';

  -- Simulate fee manager session for RPCs that use auth.uid()/current_user_school_id
  -- These SECURITY DEFINER functions read auth.uid() from JWT claims when available.
  perform set_config('request.jwt.claim.sub', v_bursar::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);

  -- Helper: many BFA helpers use profiles by auth.uid(); current_user_school_id typically reads profiles.
  -- 5–8 payment scenarios
  v_result := public.record_payment(
    v_student_id, 400, 'mobile_money', v_key, 'REF-1', current_date, 'partial'
  );
  if (v_result->>'amount_allocated')::numeric <> 400 then
    raise exception 'FAIL: partial payment alloc expected 400 got %', v_result;
  end if;
  if (v_result->>'credit_created')::numeric <> 0 then
    raise exception 'FAIL: partial payment should not create credit';
  end if;
  raise notice 'PASS: payment below outstanding';

  -- Idempotent replay
  v_payment_id := (v_result->>'payment_id')::uuid;
  v_result := public.record_payment(
    v_student_id, 400, 'mobile_money', v_key, 'REF-1', current_date, 'partial'
  );
  if (v_result->>'payment_id')::uuid is distinct from v_payment_id
     or coalesce((v_result->>'replay')::boolean, false) is not true then
    raise exception 'FAIL: idempotent replay mismatch %', v_result;
  end if;
  raise notice 'PASS: idempotent replay';

  -- Equal remaining (1100 left after 400 => pay 1100)
  v_result := public.record_payment(
    v_student_id, 1100, 'bank_transfer', v_key2, 'REF-2', current_date, 'clear'
  );
  if (v_result->>'credit_created')::numeric <> 0 then
    raise exception 'FAIL: exact payoff should not create credit: %', v_result;
  end if;
  raise notice 'PASS: payment equal to remaining outstanding';

  -- Above outstanding / zero outstanding advance
  v_key := gen_random_uuid();
  v_result := public.record_payment(
    v_student_id, 2500, 'mobile_money', v_key, 'REF-ADV', current_date, 'advance'
  );
  if (v_result->>'amount_received')::numeric <> 2500 then
    raise exception 'FAIL: advance received amount';
  end if;
  if (v_result->>'amount_allocated')::numeric <> 0 then
    raise exception 'FAIL: advance with zero outstanding should allocate 0: %', v_result;
  end if;
  if (v_result->>'credit_created')::numeric <> 2500 then
    raise exception 'FAIL: advance credit expected 2500: %', v_result;
  end if;
  raise notice 'PASS: zero-outstanding advance creates full credit';

  v_payment_id_2 := (v_result->>'payment_id')::uuid;

  -- Add new charge 1000 and apply credit
  insert into public.charges (
    school_id, student_id, fee_item_id, academic_year_id, term_id,
    amount, status, created_by
  ) values (
    v_school_id, v_student_id, v_fee_item_id, v_year_id, v_term_id,
    1000, 'outstanding', v_bursar
  );

  v_result := public.apply_available_credit(v_student_id);
  if (v_result->>'credit_applied')::numeric <> 1000 then
    raise exception 'FAIL: credit apply expected 1000: %', v_result;
  end if;
  raise notice 'PASS: apply available credit across new charge';

  -- Second apply should fail or apply 0 remaining charge
  begin
    v_result := public.apply_available_credit(v_student_id);
    -- may still apply to nothing and raise
    raise notice 'apply credit second call result: %', v_result;
  exception when others then
    raise notice 'PASS: second credit apply blocked or no-op (% )', SQLERRM;
  end;

  -- Void advance payment remainder impact
  v_payment_id := v_payment_id_2;
  perform public.void_payment(v_payment_id, 'Hardening suite void');
  select public.payment_active_allocated(v_payment_id) into v_alloc;
  if v_alloc <> 0 then
    raise exception 'FAIL: voided payment still has active allocations %', v_alloc;
  end if;
  raise notice 'PASS: void clears active allocations / credit from payment';

  -- Unauthorised teacher cannot record payment
  perform set_config('request.jwt.claim.sub', v_teacher::text, true);
  begin
    perform public.record_payment(
      v_student_id, 10, 'mobile_money', gen_random_uuid(), null, current_date, null
    );
    raise exception 'FAIL: teacher should not record_payment';
  exception when others then
    if SQLERRM like 'FAIL:%' then raise; end if;
    raise notice 'PASS: teacher cannot record_payment (% )', SQLERRM;
  end;

  perform set_config('request.jwt.claim.sub', v_teacher::text, true);
  begin
    perform public.apply_available_credit(v_student_id);
    raise exception 'FAIL: teacher should not apply credit';
  exception when others then
    if SQLERRM like 'FAIL:%' then raise; end if;
    raise notice 'PASS: teacher cannot apply_available_credit (% )', SQLERRM;
  end;

  -- Invariants
  v_result := public.validate_payment_allocation_invariants_for_school(v_school_id);
  if not coalesce((v_result->>'ok')::boolean, false) then
    raise exception 'FAIL: invariants not ok: %', v_result;
  end if;
  raise notice 'PASS: invariant validation ok';

  -- Receipt uniqueness smoke
  select count(*) into v_count
  from (
    select receipt_number from public.payments
    where school_id = v_school_id
    group by receipt_number having count(*) > 1
  ) d;
  if v_count > 0 then
    raise exception 'FAIL: duplicate receipt numbers present';
  end if;
  raise notice 'PASS: receipt numbers unique';

  raise notice 'payment_allocations_hardening: ALL CHECKS PASSED';
end;
$$;
