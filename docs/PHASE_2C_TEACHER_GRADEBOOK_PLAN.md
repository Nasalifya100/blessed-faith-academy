# Phase 2C — Teacher Gradebook / Marks Entry — Implementation Plan

**System:** Blessed Faith Academy School Management System  
**Repository:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`  
**Depends on:** Phase 2B.1 Examination setup (completed and deployed)  
**Status:** Planning only — do not implement from this document alone  
**Date:** 2026-07-24  

---

## 1. Phase 2B.1 handoff summary

Phase 2B.1 delivered **examination preparation**, not scoring.

### Delivered and preserve

| Area | What exists |
|---|---|
| Exam periods | `exam_periods` with Draft / Open / Completed (`CLOSED`) / Archived |
| Exams | `exams` — subject × grade × assessment type × `max_marks`, optional class scope |
| References | Immutable `exam_reference` (`EX-{YEAR}-{TERM_CODE}-{SEQ4}`) |
| Lifecycle | `exam_lifecycle_status`: Draft → Scheduled → Ready → Completed → Archived |
| Schedule | `exam_schedules`, rooms, invigilators, exclusions, templates |
| Writes | SECURITY DEFINER RPCs + `require_academic_capability` |
| Audit | `log_academic_event` → `academic_event_audits` |
| UI | `/dashboard/examinations/*`, Upcoming for teachers (read-only setup) |
| Teacher setup rights | Teachers: `EXAM_VIEW` only — no period/exam create |

### Explicitly not delivered (Phase 2C owns)

- No `gradebook`, `assessment_results`, or marks tables  
- No marks RPCs or UI  
- No submit / lock / reopen for scores  
- No report-card calculation from scores  

### Architecture conventions to preserve

1. **RPC authority** for all writes; revoke direct INSERT/UPDATE/DELETE on sensitive tables.  
2. **Capabilities** via `has_academic_capability` (role defaults + optional `academic_capabilities` overrides).  
3. **School scoping** via `current_user_school_id()`.  
4. **Audit** via `log_academic_event` with entity type + JSON payload (include `exam_reference` where relevant).  
5. **UI language:** Exam Period / Exam / Exam Schedule; scores = “marks”, not “grades” (grades = letter bands).  
6. **New migrations only** — never edit applied files; push to `master` deploys automatically.  
7. **Mobile:** large controls (`h-11`), cards on small screens, horizontal scroll for dense tables.  

---

## 2. Existing architecture findings

### 2.1 Database (relevant)

| Domain | Tables / types | Notes |
|---|---|---|
| Calendar | `academic_years`, `terms` | Year/term selection |
| Structure | `grade_levels`, `classes` (streams supported) | Class roster scope |
| Subjects | `subjects`, `subject_grade_availability`, `subject_offerings` | Offering links year + grade (+ optional class) |
| Teachers | `teaching_assignments` | `staff_id` + `subject_offering_id` + optional `class_id`; roles SUBJECT_TEACHER / ASSISTANT / HOD / SUBSTITUTE |
| Students | `students`, `student_class_enrollments` | Enrolment unique per student×year; statuses include `active` |
| Config | `assessment_types`, `assessment_weight_schemes`, `grading_schemes` (+ bands) | Weights/bands ready for later phases; **no score rows** |
| Workflow windows | `academic_workflow_periods` | Types already include `MARKS_ENTRY`, `MODERATION`, `APPROVAL`, `PUBLICATION` |
| Exams (2B) | `exam_periods`, `exams`, schedules, rooms, invigilators, exclusions, templates, counters | Sitting definitions; `max_marks` on exam |
| Audit | `academic_event_audits` | Academic domain events |
| Marks | **None** | Confirmed gap |

### 2.2 Routes / UI today

| Area | Routes |
|---|---|
| Examinations | `/dashboard/examinations`, periods, schedule, rooms, upcoming, print |
| Academic config | `/dashboard/settings/academics/*` (subjects, assignments, grading, assessment types/weights, dates) |
| Attendance (UX analogue) | `/dashboard/attendance`, `/dashboard/attendance/[classId]` — roster + save pattern |
| Reports | Fee/enrolment/attendance/discipline — **no academic results** |
| Gradebook | **Does not exist** |

Nav: Examinations visible to administrator, headteacher, teacher, secretary, bursar.

### 2.3 Roles and capabilities

Staff roles: `administrator`, `headteacher`, `teacher`, `secretary`, `bursar`.

Exam capabilities (DB + TS mirror):

| Capability | Admin | Head | Teacher / secretary / bursar |
|---|---|---|---|
| `EXAM_VIEW` | ✓ | ✓ | ✓ |
| Setup manage (`EXAM_*_MANAGE`) | ✓ | ✓ | — |

Teaching assignments: teachers can **select** own rows; manage via `TEACHING_ASSIGNMENTS_MANAGE` (admin/head).

**Implication for 2C:** new capabilities (e.g. `GRADEBOOK_ENTER`, `GRADEBOOK_VIEW_ALL`, `GRADEBOOK_REOPEN`, `GRADEBOOK_CORRECT`) must be added to `has_academic_capability` **and** mirrored in TypeScript permission helpers — same pattern as exams.

### 2.4 What Phase 2C must add

Everything for secure marks entry against **exam sittings** prepared in 2B.1, plus admin reopen/correct, with assignment-scoped teacher access. Continuous assessments **without** an `exams` row are deferred (see gaps).

---

## 3. Gaps to be filled

| Gap | Plan |
|---|---|
| No results storage | New tables: gradebook session + result rows |
| No marks capabilities | Extend `has_academic_capability` + TS permissions |
| No gradebook RPCs | SECURITY DEFINER RPCs for load/save/submit/reopen/correct |
| No gradebook UI/routes | `/dashboard/gradebook/*` + admin monitor |
| Exam ↔ teacher assignment | Enforce via `teaching_assignments` + subject offering match |
| Class scope for grade-wide exams | Gradebook keyed by `(exam_id, class_id)` so each class teacher enters their roster |
| Continuous CA without exam | **Out of Phase 2C v1** — requires future `assessment_instances`; types/weights already exist |
| Reporting | Minimal “completion” views only; full report cards = Phase 2F |
| Decimal policy | Use exam `max_marks` + active `grading_schemes.decimal_places` (school default) |

---

## 4. Proposed database design

### 4.1 Design principle

**Marks attach to Phase 2B `exams`**, not to abstract assessment types.  
An exam already carries subject, grade, assessment type, max marks, period (year/term), cohort, and exclusions.

A **gradebook** is the teacher’s mark-entry session for one exam **and one class** (even when the exam cohort is GRADE — teachers enter per assigned class).

### 4.2 Enums (new)

```text
gradebook_status:
  DRAFT | SUBMITTED | REOPENED | LOCKED

result_entry_status:
  SCORED | ABSENT | EXEMPT | NOT_ASSESSED
```

### 4.3 Tables (conceptual)

#### `exam_gradebooks`

| Column | Purpose |
|---|---|
| `id` | PK |
| `school_id` | Tenant |
| `exam_id` | FK → `exams` |
| `class_id` | FK → `classes` (roster scope) |
| `status` | `gradebook_status` |
| `opened_by` / `opened_at` | First open / create |
| `last_saved_by` / `last_saved_at` | Draft saves |
| `submitted_by` / `submitted_at` | Submit |
| `reopened_by` / `reopened_at` / `reopening_reason` | Admin reopen |
| `locked_by` / `locked_at` | Term/admin lock |
| `revision` | Integer; increment on submit/reopen/correct batches |
| `roster_snapshot` | JSONB optional — eligible student ids at last submit (safe roster drift) |
| `created_at` / `updated_at` | Standard |

**Uniqueness:** `unique (exam_id, class_id)`.

**Eligibility rules (enforced in RPC):**

- Exam `is_active` and status in (`COMPLETED`, optionally `READY` if school policy allows pre-sitting entry — **default: COMPLETED only**).  
- Class matches exam grade year; if exam `cohort_scope = CLASS`, `class_id` must equal exam.class_id.  
- Teacher must hold active `teaching_assignments` for an offering of that subject/grade/year whose `class_id` is null or equals gradebook class.

#### `exam_assessment_results`

| Column | Purpose |
|---|---|
| `id` | PK |
| `school_id` | Tenant |
| `gradebook_id` | FK → `exam_gradebooks` |
| `exam_id` | Denormalised FK for uniqueness/reporting |
| `student_id` | FK → `students` |
| `entry_status` | `result_entry_status` |
| `marks_obtained` | numeric nullable; required iff SCORED |
| `max_marks_snapshot` | Copy of exam.max_marks at save (immutable for that revision) |
| `comment` | Optional short note |
| `row_revision` | Align with gradebook revision on write |
| `created_at` / `updated_at` | Standard |
| `created_by` / `updated_by` | Actor |

**Constraints:**

- `unique (gradebook_id, student_id)` only (Stage 1 decision — see implementation record)  
- Submit/save enforce at most one SUBMITTED/LOCKED result per exam+student across class gradebooks  
- Check: SCORED ⇒ marks not null, ≥ 0, ≤ max_marks_snapshot; non-SCORED ⇒ marks null  
- Check: not (marks IS NOT NULL AND entry_status <> SCORED)

#### Audit

Reuse `academic_event_audits` with events such as:

`GRADEBOOK_OPENED`, `GRADEBOOK_DRAFT_SAVED`, `GRADEBOOK_SUBMITTED`, `GRADEBOOK_REOPENED`, `GRADEBOOK_LOCKED`, `MARK_CORRECTED`, `GRADEBOOK_PARTIAL_WARNED`.

Optional dedicated `exam_assessment_result_audits` only if row-level before/after is required beyond JSON payloads — prefer academic audits first for consistency.

### 4.4 Indexes

- `(school_id, status)` on gradebooks  
- `(gradebook_id)` on results  
- `(exam_id)` on results  
- `(staff_id, is_active)` already on teaching_assignments  

### 4.5 Writes

Revoke direct DML from `authenticated`; all mutations via RPCs.

---

## 5. Permission matrix

| Action | Teacher (assigned) | Teacher (not assigned) | Secretary / bursar | Headteacher | Administrator |
|---|---|---|---|---|---|
| Open Gradebook hub | Own assignments | — | View all (read) optional | View all | View all |
| Load roster / draft | Own class×exam | Deny | Read | Read | Read |
| Save draft | ✓ | Deny | — | Optional override | ✓ |
| Submit | ✓ | Deny | — | Optional | ✓ |
| Edit submitted | Deny | Deny | Deny | Deny | Via correct/reopen only |
| Reopen (+ reason) | Deny* | Deny | Deny | ✓ | ✓ |
| Correct marks (audited) | Deny | Deny | Deny | ✓ | ✓ |
| Lock gradebook/term | Deny | Deny | Deny | ✓ | ✓ |

\*Unless school later grants explicit capability; default deny.

### New capabilities (proposed)

| Capability | Default roles |
|---|---|
| `GRADEBOOK_ENTER` | teacher (+ admin/head) |
| `GRADEBOOK_VIEW_ALL` | administrator, headteacher (secretary/bursar: **not** by default — marks are sensitive) |
| `GRADEBOOK_REOPEN` | administrator, headteacher |
| `GRADEBOOK_CORRECT` | administrator, headteacher |
| `GRADEBOOK_LOCK` | administrator, headteacher |

UI checks mirror DB; **DB/RPC is authoritative**.

---

## 6. Gradebook state machine

```text
                    open / first save
[none] --------------------------> DRAFT
                                     |
                                  submit
                                     v
                                 SUBMITTED <----+
                                     |          |
                                  reopen        | resubmit
                                  (reason)      |
                                     v          |
                                 REOPENED ------+
                                     |
                                   lock
                                     v
                                  LOCKED
```

| Transition | Who | Rules |
|---|---|---|
| → DRAFT | Teacher with assignment | Creates gradebook; exam eligible |
| DRAFT → SUBMITTED | Same / authorised enter | Validation; roster completeness policy |
| SUBMITTED → REOPENED | Reopen capability | Mandatory non-empty reason; audit |
| REOPENED → SUBMITTED | Enter capability | Same validation as submit |
| * → LOCKED | Lock capability | No further teacher edits; admin correct may still be gated |
| LOCKED → REOPENED | Admin/head only | Rare; reason required |

Teachers **cannot** edit while `SUBMITTED` or `LOCKED`.

---

## 7. Teacher workflow

1. Open **Gradebook** (`/dashboard/gradebook`).  
2. See only exams/classes permitted by `teaching_assignments` (and exam eligibility).  
3. Select academic year → term → class → subject → exam (shows exam reference + max marks + assessment type).  
4. System loads/creates gradebook for `(exam_id, class_id)`.  
5. Load roster: active `student_class_enrollments` for class + year; student status enrolled/active; apply `exam_exclusions`; sort by name/admission.  
6. Enter marks / statuses (keyboard-friendly grid).  
7. **Save draft** (explicit; no unsafe autosave in v1).  
8. Validation on save and stricter on submit.  
9. **Submit** → status SUBMITTED; store roster snapshot; lock teacher edits.  
10. Preview read-only after submit.  

Unsaved-changes warning on navigate away. Sticky Save Draft / Submit on mobile and desktop.

---

## 8. Admin reopening workflow

1. Admin/head opens monitor (`/dashboard/gradebook/admin` or exam-linked link).  
2. Selects submitted gradebook.  
3. **Reopen** dialog: mandatory reason (min length).  
4. RPC sets REOPENED, audits actor/reason/previous revision.  
5. Assigned teacher (or admin) edits under REOPENED.  
6. Resubmit → SUBMITTED, revision++.  
7. Optional **Correct** RPC for single-row admin fix without full reopen (still audited) — Stage 2 if needed; Stage 1 can require reopen.

---

## 9. Validation rules

| Rule | Enforce where |
|---|---|
| Mark ≥ 0 | RPC + Zod |
| Mark ≤ exam max (snapshot) | RPC + Zod |
| Decimals only if grading scheme `decimal_places` > 0 | RPC |
| SCORED XOR (ABSENT/EXEMPT/NOT_ASSESSED) | DB check + RPC |
| Inactive / withdrawn / non-active enrolment: no new marks | RPC roster + reject unknown ids |
| Unique (exam_id, student_id) | DB unique |
| Teacher assignment required | RPC |
| Exam must match year/term/subject/grade/class scope | RPC |
| Marks entry window (`academic_workflow_periods` MARKS_ENTRY) if configured | RPC soft/hard — **hard when active window exists** |
| SUBMITTED/LOCKED: no teacher draft save | RPC |
| Reopen requires capability + reason | RPC |
| Submit must not silently drop eligible students | RPC: require every eligible student has a row, **or** explicit `confirm_partial=true` with UI warning (policy: **default block partial**) |
| Roster growth after submit | New students appear only after reopen; snapshot documents who was included |
| Paste from spreadsheet | Client parse + per-cell validation; server still validates batch |

---

## 10. Route and component plan

### Routes

| Route | Audience | Purpose |
|---|---|---|
| `/dashboard/gradebook` | Teachers (+ admin/head) | Hub: filters + assigned gradebooks list |
| `/dashboard/gradebook/[gradebookId]` | Assigned teacher / viewers | Entry grid / cards |
| `/dashboard/gradebook/[gradebookId]/preview` | Same | Read-only submitted view |
| `/dashboard/gradebook/admin` | Admin / head / secretary view | Completion monitor, reopen |

Optional deep-link: `/dashboard/examinations/periods/[id]` → “Enter marks” for completed exams (admin).

Nav: add **Gradebook** for roles with `GRADEBOOK_ENTER` or `GRADEBOOK_VIEW_ALL`.

### Feature module

`src/features/gradebook/`

- `permissions.ts` — capability helpers  
- `schemas.ts` — Zod for draft/submit/reopen  
- `queries.ts` — list assignments, load gradebook, roster  
- `actions.ts` — server actions wrapping RPCs  
- `components/gradebook-filters.tsx`  
- `components/marks-entry-grid.tsx` — desktop table, sticky footer  
- `components/marks-entry-cards.tsx` — mobile  
- `components/bulk-status-actions.tsx`  
- `components/reopen-dialog.tsx`  
- `components/completion-monitor.tsx`  

Reuse: existing Label/Button/dialog patterns from examinations + attendance save feedback.

---

## 11. Testing strategy

### Unit / schema

- Zod: valid/invalid marks, status conflicts, reopen reason  
- Permission helpers for each role  

### Integration / RPC (SQL or scripted verify)

- Teacher sees only assigned class×subject exams  
- Unauthorised teacher cannot load/write  
- Draft save upserts; duplicate student rejected  
- Absent + numeric rejected  
- Submit locks; second teacher cannot edit  
- Incomplete submit blocked without confirm  
- Reopen without reason fails; with reason succeeds  
- Audit rows written  

### UI

- Mobile cards usable; sticky actions  
- Unsaved warning  
- Empty / loading / error / success states  

### Reporting readiness

- Query: submitted results by exam_id joinable for future report cards  

### CI

- `npm run lint`, `npm test`, `tsc`, existing gate tests  
- New `scripts/phase2c-*-verify` optional for staging after migrate  

---

## 12. Migration plan

**Do not create until implementation Stage 1 begins.**

Suggested ordered files (timestamps at implementation time):

1. `YYYYMMDDHHMMSS_gradebook_enums_and_tables.sql` — enums, `exam_gradebooks`, `exam_assessment_results`, indexes, RLS select policies, revoke DML  
2. `YYYYMMDDHHMMSS_gradebook_capabilities.sql` — extend `has_academic_capability`  
3. `YYYYMMDDHHMMSS_gradebook_rpcs.sql` — load/save/submit/reopen/lock (+ correct if in scope)  

Rules:

- Additive, idempotent where practical (`if not exists`)  
- No `db reset`  
- Never edit `20260723130*` or earlier  
- Push to `master` only when Stage is review-ready (auto-deploys)  

---

## 13. Implementation stages

### Stage 0 — Plan (this document)

Complete. No code/migrations.

### Stage 1 — Schema + RPCs + permissions

- Migrations 1–3  
- Permission TS mirror  
- Staging verify script for tables/RPCs  

### Stage 2 — Teacher hub + entry UI

- Routes hub + `[gradebookId]`  
- Draft save + validation  
- Mobile cards + desktop grid  
- Nav link  

### Stage 3 — Submit + lock + preview

- Submit RPC + preview route  
- Partial-block policy  
- Roster snapshot  

### Stage 4 — Admin monitor + reopen

- Admin route  
- Reopen dialog + audits  
- Completion tracking (submitted / draft / missing)  

### Stage 5 — Hardening

- Paste-safe bulk fill  
- Bulk status actions  
- Edge cases (exclusions, withdrawn mid-draft)  
- Docs + deployment report  
- Optional correct-single-mark RPC  

**Out of Stage 1–5:** weighted term totals, report cards, rankings, parent publish (2E/2F).

---

## 14. Risks and safeguards

| Risk | Safeguard |
|---|---|
| Privilege escalation via forged exam/class ids | RPC assignment + school checks |
| Grade-wide exam double-entry chaos | Gradebook per `(exam_id, class_id)` |
| Silent incomplete submit | Default block; explicit confirm only if product later allows |
| Roster changes after submit | Snapshot + reopen to include new students |
| Concurrent edits | `revision` optimistic check on save/submit |
| Decimal abuse | Scheme `decimal_places` |
| Auto-deploy of bad migration | Complete tests before push; pending-only gate already in CI |
| Confusing CA without exams | Document v1 = exam-linked only |
| Teacher edits another’s draft | Gradebook not owned exclusively, but writes require assignment; optional `opened_by` warning if different teacher saves |

---

## 15. Definition of done (Phase 2C)

Phase 2C is complete when:

1. Assigned teachers can open gradebooks for eligible **Completed** exams and their classes.  
2. Draft save and submit work with full validation.  
3. Submitted gradebooks are immutable to teachers.  
4. Admin/head can reopen with mandatory reason; audits exist.  
5. RLS/RPC deny unauthorised access (verified by tests/script).  
6. Mobile and desktop entry are usable.  
7. Migrations applied via CI; no repaired/edited old migrations.  
8. Minimal admin completion view exists.  
9. Docs updated (`PHASE_2C` implementation + deployment notes).  
10. Lint/tests/tsc pass; controlled staging verify green.  

---

## Reporting integration (forward look)

Submitted `exam_assessment_results` feed later:

| Consumer | Phase |
|---|---|
| Missing-mark / completion monitor | 2C Stage 4 |
| Class/subject averages | 2E |
| Student result sheets / report cards | 2F |
| Examination analytics | 2G |

Do not build full reporting in 2C beyond completion monitoring.

---

## Recommended first implementation step

**Stage 1 only:** author the three additive migrations (tables + capabilities + RPCs for `open_or_get_gradebook`, `save_gradebook_draft`, `submit_gradebook`), plus TypeScript permission stubs and a staging verify probe — **no UI yet**. Review RPC security before Stage 2 UI.

---

## Stage 1 implementation record (2026-07-24)

**Status:** Schema + RPCs + TS contracts authored and **security-reviewed**. **Not committed / not pushed / not deployed.**

### Final schema

| Object | Notes |
|---|---|
| `gradebook_status` | `DRAFT`, `SUBMITTED`, `REOPENED`, `LOCKED` |
| `result_entry_status` | `SCORED`, `ABSENT`, `EXEMPT`, `NOT_ASSESSED` |
| `exam_gradebooks` | Unique `(exam_id, class_id)`; revision; submit/reopen/lock metadata; server-only `roster_snapshot` |
| `exam_assessment_results` | Unique `(gradebook_id, student_id)` only; scored XOR checks; `max_marks_snapshot` from exam |

### Uniqueness policy

- Within gradebook: unique student.  
- Across gradebooks: **no** DB unique on `(exam_id, student_id)` (avoids blocking transfers/draft cleanup).  
- Submit/save enforce: no second **SUBMITTED/LOCKED** result for same exam+student in another class gradebook.

### Roster policy

Eligible = current `student_class_enrollments` active + `students.status = enrolled` − `exam_exclusions`.  
**Limitation:** not “as of exam date”. Students who sat then transferred/withdrew may drop from live roster; submitted `roster_snapshot` preserves who was included at submit. Future phase may add as-of-date eligibility.

### Save batch semantics

**Partial upsert.** Validate entire payload first; write only listed students; do not delete omitted *eligible* rows; bump gradebook `revision` once per successful batch.

**Roster prune (DRAFT/REOPENED only):** on draft save and on submit, results for students **no longer eligible** are removed so teachers are not stuck after transfers/withdrawals. Eligible students’ marks are never pruned this way. After SUBMITTED/LOCKED, results are preserved even if live roster later changes (`roster_snapshot` records submit-time eligibility).

### State machine (Stage 1)

```text
DRAFT ----submit----> SUBMITTED ----reopen(+reason)----> REOPENED ----submit----> SUBMITTED
                         |
                         +----lock----> LOCKED (terminal in Stage 1)
```

Rejected: `LOCKED→*`, `DRAFT→REOPENED`, `DRAFT→LOCKED`, `SUBMITTED→DRAFT`, `REOPENED→LOCKED` (must resubmit first).

### Lifecycle / window

- Create gradebook / DRAFT save / DRAFT submit: exam `COMPLETED` + optional open `MARKS_ENTRY` window.  
- Read existing gradebook: allowed after window closes if authorised.  
- REOPENED save/submit after window close: requires `GRADEBOOK_REOPEN`.

### Capabilities (least privilege)

| Role | Defaults |
|---|---|
| Teacher | `GRADEBOOK_ENTER` (assignment-scoped in RPC) |
| Head | ENTER, VIEW_ALL, REOPEN, CORRECT, LOCK |
| Admin | all |
| Secretary / bursar | **none** for gradebook marks (opt-in via `academic_capabilities`) |

`GRADEBOOK_CORRECT` reserved; no correction RPC / no direct writes.

### RPC contracts

`open_or_get_exam_gradebook` (race-safe create), **`get_exam_gradebook` (read-by-ID, no create)**, `save_exam_gradebook_draft`, `submit_exam_gradebook`, `reopen_exam_gradebook` (SUBMITTED + expected_revision), `lock_exam_gradebook` (SUBMITTED + expected_revision).

### Audit events

`GRADEBOOK_OPENED` (create only), `GRADEBOOK_DRAFT_SAVED`, `GRADEBOOK_SUBMITTED`, `GRADEBOOK_REOPENED`, `GRADEBOOK_LOCKED`. No full marks payloads.

### Concurrency

`FOR UPDATE` + mandatory `expected_revision`; open uses unique-violation catch.

### Tests

Unit: `src/features/gradebook/permissions.test.ts`.  
Probes: `scripts/phase2c-stage1-verify.cjs` + `docs/PHASE_2C_STAGE_1_VERIFICATION.md`.

### Migrations

1. `20260724140000_exam_gradebook_enums_and_tables.sql`  
2. `20260724140100_exam_gradebook_capabilities.sql`  
3. `20260724140200_exam_gradebook_rpcs.sql`  

Gate expectation before deploy: exactly these three local-pending after the existing 58 synced versions.

---

## Stage 2 implementation record (2026-07-24)

**Status:** Teacher UI + server integration authored. **Not committed / not pushed / migrations not applied.**

### Delivered

| Area | Notes |
|---|---|
| Nav | Gradebook link for `canOpenGradebook`; secretary/bursar excluded by default |
| Routes | `/dashboard/gradebook`, `/[gradebookId]`, `/[gradebookId]/preview` |
| Hub | Assignment-scoped completed exams; draft/reopened/submitted/locked sections; filters |
| Entry | Desktop table + mobile cards; keyboard Enter-to-next; bulk blank statuses |
| Save / submit | Stage 1 RPCs via server actions; revision conflicts; explicit submit confirm |
| Recovery | localStorage draft keyed by gradebook+revision |
| Admin | Reopen (reason) + Lock on SUBMITTED only |
| Tests | `stage2.test.ts` (+ existing Stage 1 tests) |

### Verification doc

`docs/PHASE_2C_STAGE_2_VERIFICATION.md`  
`docs/PHASE_2C_PRE_DEPLOYMENT_REVIEW.md` (integrated review)

---

## Document control

| Field | Value |
|---|---|
| Plan file | `docs/PHASE_2C_TEACHER_GRADEBOOK_PLAN.md` |
| Implementation | Stage 1 + Stage 2 reviewed for deploy |
| Migrations created | Three additive files (see Stage 1 record); includes `get_exam_gradebook` + reopen/lock revision |
| Commit / push / deploy | Not done |
