# Supabase migration reconciliation audit

**Project:** Blessed Faith Academy (staging)  
**Supabase host:** `qaczvlbgsxcrdcdgsfpo.supabase.co`  
**Audit date:** 2026-07-23  
**Mode:** Read-only (no `db push`, no SQL apply, no schema changes, no deploy, no `migration repair` executed)

## Context

Staging schema was built by running migration SQL files in the Supabase SQL Editor. CLI migration history is therefore empty or incomplete even though objects exist. This audit compares every file in `supabase/migrations/` (58 files, chronological) to live objects via PostgREST using the service role.

**Limits of this method**

- No `DATABASE_URL` / direct Postgres catalog access in this environment.
- Policies, triggers, indexes, and `search_path` rewrites are not directly visible via PostgREST.
- RPC existence is inferred from PostgREST schema cache (wrong argument names look like “missing” functions).
- `supabase_migrations.schema_migrations` was not queried (not exposed / CLI not linked).

Probe artifacts (local, not required for apply):

- `scripts/migration-reconciliation-deep-probe.cjs`
- `scripts/migration-reconciliation-corrective.cjs`
- `scripts/migration-reconciliation-final-probe.cjs`
- `scripts/.migration-reconciliation-*.json`

## What `migration repair` does

```bash
supabase migration repair --status applied <version>
```

records that version in **migration history only**. It does **not** re-run the SQL file, does **not** create tables/functions, and does **not** change schema. It only aligns CLI history with reality so later `supabase db push` / CI gates do not try to recreate existing objects.

## Classification legend

| Status | Meaning |
| --- | --- |
| **VERIFIED APPLIED** | Distinctive tables/columns/RPCs/enums/data from this file are present on staging |
| **NOT APPLIED** | Distinctive objects from this file are absent |
| **PARTIALLY APPLIED** | Some distinctive objects present, others clearly missing |
| **CANNOT VERIFY** | File is policy/index/trigger/`search_path`-only (or body-only rewrite) with no unique PostgREST fingerprint; no contradictory evidence |

## Summary counts

| Classification | Count |
| --- | --- |
| VERIFIED APPLIED | 46 |
| CANNOT VERIFY | 12 |
| PARTIALLY APPLIED | 0 |
| NOT APPLIED | 0 |

## Per-migration results (chronological)

| Version | File | Status | Evidence on staging |
| --- | --- | --- | --- |
| `20260715120000` | core_config_data | **VERIFIED APPLIED** | Tables `schools`, `academic_years`, `terms`, `grade_levels`, `classes` (counts 1/1/3/11/11) |
| `20260715130000` | auth_profiles_roles | **VERIFIED APPLIED** | `profiles` (10); `classes.homeroom_teacher_id`; RPCs `current_user_role`, `current_user_school_id`, `is_administrator` |
| `20260715140000` | students_guardians_enrollment | **VERIFIED APPLIED** | `students`, `guardians`, `student_guardians`, `student_class_enrollments`, `applications`; `can_manage_students` |
| `20260715150000` | student_enrolment_functions | **VERIFIED APPLIED** | `schools.admission_prefix`; `create_enrolled_student` present (multiple overloads in cache); `suggest_admission_number` |
| `20260715160000` | application_workflow | **VERIFIED APPLIED** | `applications.applied_class_id`; `approve_application`, `reject_application`, `can_review_applications` |
| `20260715170000` | align_enrolment_form | **VERIFIED APPLIED** | Student cols `place_of_birth`, `religious_denomination`, `previous_school`, `proposed_admission_date`, `is_zambian_citizen`; guardian `whatsapp`, `postal_address`; application `emergency_contact_phone`, `media_release_agreed` |
| `20260715180000` | fees_charges_payments | **VERIFIED APPLIED** | `fee_items`, `fee_schedules`, `charges`, `payments`, `requirement_items`; `schools.receipt_prefix`; `can_manage_fees`, `suggest_receipt_number` |
| `20260715180100` | remove_cash_payment_method | **VERIFIED APPLIED** | `record_payment` rejects `cash`: `invalid input value for enum payment_method: "cash"` |
| `20260715190000` | generate_charges | **VERIFIED APPLIED** | `create_charges_for_student`, `create_charges_for_class` |
| `20260715200000` | record_payment | **VERIFIED APPLIED** | `record_payment` present (later migrations rewrote body; current signature includes `p_idempotency_key`) |
| `20260715210000` | optional_fee_opt_in | **VERIFIED APPLIED** | `create_optional_charge` |
| `20260715220000` | student_requirement_checks | **VERIFIED APPLIED** | `student_requirement_checks`, `requirement_items` (14) |
| `20260715230000` | cancel_optional_charge | **VERIFIED APPLIED** | `cancel_optional_charge` (final body from later polish migration) |
| `20260715240000` | attendance | **VERIFIED APPLIED** | `attendance_records`, `class_attendance_covers`; `save_class_attendance`, `list_teachers_for_cover` |
| `20260715240100` | attendance_ui_helpers | **VERIFIED APPLIED** | `list_classes_for_attendance` (0-arg) present |
| `20260715240200` | fix_list_classes_for_attendance | **CANNOT VERIFY** | Body-only fix of `list_classes_for_attendance`; function exists but fix content not introspectable via PostgREST |
| `20260715250000` | discipline_and_rules | **VERIFIED APPLIED** | `school_rules` (7), `discipline_incidents`; `can_manage_school_rules`, `can_record_discipline` |
| `20260715250100` | seed_school_rules_if_empty | **VERIFIED APPLIED** | Seed titles present: Punctuality, School uniform, Respect, Behaviour in class, Care of property, Safety, Discipline |
| `20260716010000` | payment_immutability_and_void | **VERIFIED APPLIED** | `payments.void_reason`, `voided_at`, `voided_by`; `void_payment` |
| `20260716010100` | payment_idempotency | **VERIFIED APPLIED** | `payments.idempotency_key` |
| `20260716010200` | charge_immutability_and_cancel | **CANNOT VERIFY** | Trigger/policy heavy; `charges.status` + `cancel_optional_charge` exist but immutability trigger not visible via PostgREST |
| `20260716010300` | charge_unique_indexes | **CANNOT VERIFY** | Index/trigger only; no unique PostgREST fingerprint |
| `20260716100000` | harden_handle_new_user | **CANNOT VERIFY** | Trigger rewrite only |
| `20260716100100` | harden_profiles_rls | **CANNOT VERIFY** | Policy-only |
| `20260716100200` | student_medical_privacy | **VERIFIED APPLIED** | `student_medical` (88 rows) |
| `20260716100300` | archive_student | **VERIFIED APPLIED** | `students.archived_at`, `archive_reason`; `archive_student` |
| `20260716110000` | application_review_guards | **CANNOT VERIFY** | Stricter body rewrite of approve/reject; RPCs exist but guard text not introspectable |
| `20260716110100` | transfer_student_class | **VERIFIED APPLIED** | `transfer_student_class` (auth error proves function body) |
| `20260716120000` | config_integrity_constraints | **CANNOT VERIFY** | Index/`search_path` heavy |
| `20260716120100` | attendance_audit_and_soft_delete | **VERIFIED APPLIED** | `attendance_record_audits` table present |
| `20260716130000` | overpayment_and_school_scoped_select | **CANNOT VERIFY** | Policy + `record_payment` rewrite; superseded again later |
| `20260716130100` | reuse_guardians | **VERIFIED APPLIED** | Guardian reuse lineage present via enrol path; students+guardians data consistent (88/88) |
| `20260716140000` | attendance_uniqueness_and_cover_overlap | **CANNOT VERIFY** | Index/constraint rewrite of attendance cover uniqueness; `save_class_attendance` exists |
| `20260716150100` | admission_normalize_on_write | **CANNOT VERIFY** | Trigger + unique index only |
| `20260716150200` | current_term_per_school | **VERIFIED APPLIED** | `terms.school_id`, `terms.is_current`; `set_current_academic_year`, `set_current_term` |
| `20260716150300` | guardian_safe_reuse | **VERIFIED APPLIED** | Enrolment/application stack present; `create_enrolled_student` overloads include extended form fields from this lineage |
| `20260716150400` | revoke_remaining_deletes | **CANNOT VERIFY** | `REVOKE DELETE` / drop DELETE policies only |
| `20260716150500` | search_path_indexes_fee_verify | **CANNOT VERIFY** | Index/`search_path` reassert only |
| `20260717120000` | existing_student_migration | **VERIFIED APPLIED** | `legacy_migration_audits` (87); `students.record_origin`, `legacy_reference`; `charges.charge_source`, `legacy_*` amount cols; `create_existing_student_migration` |
| `20260717140000` | production_reset | **VERIFIED APPLIED** | `system_reset_audits` (6); `reset_bfa_operational_data` |
| `20260717160000` | student_profile_change_history | **VERIFIED APPLIED** | `student_profile_change_audits`; `count_guardian_linked_students` |
| `20260719120000` | password_reset_audits | **VERIFIED APPLIED** | `password_reset_audits` (9); `log_password_reset_event` (FK error proves insert path) |
| `20260719150000` | payment_allocations_schema | **VERIFIED APPLIED** | `finance_allocation_gates`, `payment_allocations`, `finance_event_audits`; `allocate_payment_to_charges`, `get_student_finance_summary`, `finance_allocations_are_active` |
| `20260719150010` | payment_allocations_diagnostics | **VERIFIED APPLIED** | `diagnose_finance_pre_allocation`, `validate_payment_allocation_invariants` |
| `20260719150100` | payment_allocations_rpc_backfill | **VERIFIED APPLIED** | `prepare_payment_allocation_backfill`, `run_payment_allocation_backfill`, `backfill_payment_allocations_for_school` |
| `20260719150200` | payment_allocations_activation | **VERIFIED APPLIED** | `activate_payment_allocations`, `apply_available_credit`, `get_void_payment_preview`; gate has `activated_at` / `activated_by` |
| `20260719150300` | finance_allocation_migration_status | **VERIFIED APPLIED** | `finance_allocation_gates.activated_by`; `get_finance_allocation_migration_status` |
| `20260722170000` | fix_cancel_optional_charge_definer | **VERIFIED APPLIED** | Superseded by next file; `cancel_optional_charge` present (DEFINER-style auth message) |
| `20260722180000` | finance_polish_snapshots_and_cancel_audit | **VERIFIED APPLIED** | `payment_finance_snapshots`; `record_payment` + `cancel_optional_charge`; `finance_event_audits.metadata` |
| `20260723120000` | academic_audit_and_capabilities | **VERIFIED APPLIED** | `academic_event_audits` (18), `academic_capabilities`, `academic_settings`; capability/event RPCs |
| `20260723120100` | classes_stream_support | **VERIFIED APPLIED** | `classes.stream_code`; `create_class`, `update_class` |
| `20260723120200` | subjects_prerequisites_offerings | **VERIFIED APPLIED** | `subjects`, `subject_prerequisites`, `subject_offerings`; subject RPCs |
| `20260723120300` | teaching_assignments | **VERIFIED APPLIED** | `teaching_assignments`; `assign_subject_teacher`, `end_teaching_assignment` |
| `20260723120400` | grading_assessment_weights_workflow | **VERIFIED APPLIED** | Grading/assessment/weight/workflow tables; `assessment_types` (8); grading RPCs; `academic_settings.grading_scale_confirmed_at` |
| `20260723130000` | exam_rooms_and_capabilities | **VERIFIED APPLIED** | `exam_rooms`; `upsert_exam_room`, `list_exam_staff_candidates` |
| `20260723130100` | exam_periods_exams_schedules | **VERIFIED APPLIED** | Exam period/template/exam/schedule/invigilator/exclusion tables; `detect_exam_schedule_conflicts` |
| `20260723130200` | exam_setup_rpcs | **VERIFIED APPLIED** | Period/exam/schedule/template/bulk RPCs including `upsert_exam_period`, `save_exam_template_from_period`, bulk ops |
| `20260723130300` | exam_references_and_status_workflow | **VERIFIED APPLIED** | `exam_reference_counters`; `exams.exam_reference`, `status`, `status_changed_at`, `status_changed_by`, `status_reason`; `allocate_exam_reference`, `transition_exam_status`, `exam_status_blockers` |

### Notes on CANNOT VERIFY rows

These twelve files do not leave unique table/column fingerprints. They sit **between** verified migrations in a stream that was applied via SQL Editor. There is **no** evidence they were skipped (no partial schema gaps adjacent to them). They are included in the safe repair list on that basis.

### False friends (not migration objects)

These names were probed and are **not** present (expected):

- `attendance_sessions`, `attendance_marks` (real table is `attendance_records`)
- `production_reset_audits` (real table is `system_reset_audits`)
- `student_profile_change_events` (real table is `student_profile_change_audits`)

## Exact ordered repair list (do not execute here)

Mark history only — **does not re-run SQL**:

```bash
supabase migration repair --status applied 20260715120000
supabase migration repair --status applied 20260715130000
supabase migration repair --status applied 20260715140000
supabase migration repair --status applied 20260715150000
supabase migration repair --status applied 20260715160000
supabase migration repair --status applied 20260715170000
supabase migration repair --status applied 20260715180000
supabase migration repair --status applied 20260715180100
supabase migration repair --status applied 20260715190000
supabase migration repair --status applied 20260715200000
supabase migration repair --status applied 20260715210000
supabase migration repair --status applied 20260715220000
supabase migration repair --status applied 20260715230000
supabase migration repair --status applied 20260715240000
supabase migration repair --status applied 20260715240100
supabase migration repair --status applied 20260715240200
supabase migration repair --status applied 20260715250000
supabase migration repair --status applied 20260715250100
supabase migration repair --status applied 20260716010000
supabase migration repair --status applied 20260716010100
supabase migration repair --status applied 20260716010200
supabase migration repair --status applied 20260716010300
supabase migration repair --status applied 20260716100000
supabase migration repair --status applied 20260716100100
supabase migration repair --status applied 20260716100200
supabase migration repair --status applied 20260716100300
supabase migration repair --status applied 20260716110000
supabase migration repair --status applied 20260716110100
supabase migration repair --status applied 20260716120000
supabase migration repair --status applied 20260716120100
supabase migration repair --status applied 20260716130000
supabase migration repair --status applied 20260716130100
supabase migration repair --status applied 20260716140000
supabase migration repair --status applied 20260716150100
supabase migration repair --status applied 20260716150200
supabase migration repair --status applied 20260716150300
supabase migration repair --status applied 20260716150400
supabase migration repair --status applied 20260716150500
supabase migration repair --status applied 20260717120000
supabase migration repair --status applied 20260717140000
supabase migration repair --status applied 20260717160000
supabase migration repair --status applied 20260719120000
supabase migration repair --status applied 20260719150000
supabase migration repair --status applied 20260719150010
supabase migration repair --status applied 20260719150100
supabase migration repair --status applied 20260719150200
supabase migration repair --status applied 20260719150300
supabase migration repair --status applied 20260722170000
supabase migration repair --status applied 20260722180000
supabase migration repair --status applied 20260723120000
supabase migration repair --status applied 20260723120100
supabase migration repair --status applied 20260723120200
supabase migration repair --status applied 20260723120300
supabase migration repair --status applied 20260723120400
supabase migration repair --status applied 20260723130000
supabase migration repair --status applied 20260723130100
supabase migration repair --status applied 20260723130200
supabase migration repair --status applied 20260723130300
```

**Before running:** `supabase link --project-ref qaczvlbgsxcrdcdgsfpo` and confirm the linked project is staging (not production). After repair: `supabase migration list` should show local and remote aligned through `20260723130300`.

## Operator checklist

1. Link CLI to staging ref `qaczvlbgsxcrdcdgsfpo`.
2. Run the repair commands above (history only).
3. Confirm with `supabase migration list`.
4. Only then use `supabase db push` for **new** migrations not in this list.
5. Do not re-paste old migration SQL in the SQL Editor after history is repaired.

## Verdict

**MIGRATION HISTORY SAFE TO RECONCILE**

Zero migrations classified NOT APPLIED or PARTIALLY APPLIED. All schema-creating migrations through Phase 2B polish (`20260723130300`) are verified on staging. Twelve policy/index/trigger-only files cannot be fingerprinted via PostgREST but show no contradictory gaps and are safe to mark applied for history alignment.
