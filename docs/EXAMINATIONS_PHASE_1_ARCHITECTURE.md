# PHASE 1 — Examinations & Gradebook Architecture

**System:** Blessed Faith Academy School Management System  
**Document date:** 2026-07-23  
**Phase type:** Architecture only — **no migrations, schema changes, application code, packages, auth/finance/attendance changes, deploys, or implementation commits**

### Current baseline (verified)

| Item | Value |
|---|---|
| Commit | `b9488d7` |
| Branch | `master` |
| Staging | https://bfa-sms-staging.nasalifya007.workers.dev |
| Worker version | `3de37269-736e-4708-85e3-30b4d9084c71` |
| Core platform tag | `v1.0.0-core-platform` (points at `2ad5c59`; cleanup commit follows) |
| Genuine staff | 8 accounts remain; smoke/polish staff removed |
| Finance | Production verified |
| Password reset | Account-targeting fix deployed |

**Repository checks for this audit:** `npm test` (106 pass), `npm run lint` (0 errors). Full `npm run build` not required for an architecture-only phase (no code changes).

---

## 1. Executive summary

The platform has a production **organisational academic skeleton** (school-scoped years, terms, grade levels, classes, enrolments, homeroom teachers) used by Students, Attendance, Fees, and Reports. It does **not** yet have a curriculum, examinations, gradebook, grading scales, report cards, transcripts, rankings, or year-end promotion product.

This document designs a **configurable, multi-tenant Examinations & Gradebook** module that:

- reuses Finance / Attendance / Discipline patterns (school RLS, RPC writes, append-only audits, immutable publish snapshots, print-first documents);
- keeps grading, weighting, ranking, and promotion **settings-driven** (never hardcoded Zambia bands in application code);
- fits Blessed Faith Academy first while remaining usable by other schools;
- prepares a clean Parent Portal contract (published artefacts only).

**Verdict:** `APPROVED TO IMPLEMENT` — proceed to Phase 2A (academic foundations) after school-policy confirmations in §23.

---

## 2. Existing repository findings

### 2.1 What exists (verified)

| Area | Reality | Sources |
|---|---|---|
| Academic years | `academic_years` (`school_id`, dates, `is_current`) | `20260715120000_core_config_data.sql`, `set_current_academic_year` |
| Terms | `terms` (`term_number` 1–4, `is_current`, `school_id`) | same + `20260716150200_…`, `set_current_term` |
| Grade levels | `grade_levels` (Baby Class → Grade 7 seeded) | core config; Settings UI |
| Classes | One class per `(academic_year_id, grade_level_id)` via unique constraint | core config |
| Homeroom | `classes.homeroom_teacher_id → profiles` | auth + attendance |
| Enrolments | `student_class_enrollments` (`active` / `transferred` / `completed` / `withdrawn`); one **active** per student/year | students migrations; `transfer_student_class` |
| Staff roles | `administrator`, `headteacher`, `bursar`, `secretary`, `teacher` | `staff_role` enum; `src/features/auth/types.ts` |
| Attendance | Daily register + covers + audits | attendance migrations / reports |
| Discipline | Rules + incidents | discipline migrations / reports |
| Finance | Charges, payments, allocations, snapshots, receipts | finance module |
| Branding | `schools` name, motto, logo, address, phone, email | core + receipt page |
| Reports hub | Enrolment, attendance, fee balances, discipline | `/dashboard/reports/*` |
| Settings | Years/terms, grades, classes, fees, requirements, rules | `/dashboard/settings` (admin) |
| PDF/print | Print-first (`window.print` + Tailwind `print:`); no jspdf pipeline | receipts, reports |
| Auth / RLS | `current_user_school_id()`, role helpers; sensitive writes via RPCs | across migrations |
| Audits | Finance, attendance, profile change, password reset, system reset | multiple tables |

### 2.2 What does not exist (verified absent)

No migrations or `src/features` modules for: **subjects, departments, courses, exams, assessments, marks/scores, gradebook, grading scales, report cards, transcripts, rankings, moderation, subject-teacher assignments, year-end promotion, competency frameworks**.

Incidental English (“subject to school discipline”) is not a curriculum model. “Marks” in product language today means **attendance marks**.

### 2.3 Teacher linkage today

1. Homeroom (`classes.homeroom_teacher_id`)  
2. Temporary attendance cover (`class_attendance_covers`)  

**No subject-teacher model.**

### 2.4 Naming collisions (design rules)

| Term in repo today | Meaning | Exams UI must say |
|---|---|---|
| `grade_levels` / “Grades” in Settings | School year group | Keep “Grade level” / “Class” |
| Letter grade / GPA | Does not exist | “Result grade”, “Performance band” |
| Attendance “mark” | Present/absent | Prefer “Score” / “Assessment result” for academics |
| Fee item “Report book” | Catalogue fee (~K10) | Unrelated to digital report cards |

---

## 3. Reusable structures

| Existing asset | Reuse for Examinations |
|---|---|
| `academic_years` / `terms` | Period scope for offerings, assessments, publications |
| `grade_levels` / `classes` | Cohort for gradebooks and rankings |
| `student_class_enrollments` (active) | Who appears on a class gradebook |
| `profiles` | Teaching assignments; actors |
| Homeroom teacher | Class-teacher comments / overview (not subject scores) |
| Attendance / discipline / finance summaries | Optional report-card sections via existing queries |
| `schools` branding | Report cards / transcripts |
| Finance RPC + RLS + audit pattern | Marks ledger, publish, reopen |
| `payment_finance_snapshots` pattern | Immutable `report_card_snapshots` |
| Receipt print layout | Report-card print/PDF UX |
| `ConfirmDialog`, Zod, EmptyState, Skeleton, PageShell | UI consistency |
| `enrollment_status.completed` (unused) | Year-end close / promotion history |

---

## 4. Gaps and conflicts

| Gap / conflict | Impact | Resolution in Phase 2 |
|---|---|---|
| `UNIQUE (academic_year_id, grade_level_id)` | Blocks Grade 5A/5B streams | Relax to unique `(academic_year_id, grade_level_id, name)` or equivalent; backfill BFA |
| No subjects / offerings | Cannot enter scores | New curriculum tables |
| No subject teachers | Cannot scope mark entry | `teaching_assignments` |
| No Academic Officer / HoD role | Moderation unclear | Prefer **capability tables** over immediate enum explosion; optional later roles |
| No school settings row for academics | Feature flags nowhere | `academic_settings` + related policy tables |
| `completed` enrolment unused | Year-end ambiguous | Use for closed enrolments after promotion |
| Parent portal absent | Must not leak drafts | Publish-only views / RLS foresight |
| Hardcoded grading temptation | Wrong for multi-school | All scales in DB with versioning |

---

## 5. Proposed domain model

### 5.1 Design principles

1. Tenant-first (`school_id` on every operational row).  
2. Config over code (scales, weights, ranking, promotion).  
3. Curriculum first-class: Subject → Offering → Teaching assignment → Assessment → Result.  
4. Marks workflow with explicit publish/lock.  
5. Publish creates immutable artefacts (never live-recalculate published cards).  
6. Homeroom ≠ subject teacher.  
7. Soft-delete / archive preferred; hard-delete forbidden when marks or publications exist.

### 5.2 Entity catalogue (core)

#### Academic structure (extend existing + new)

| Entity | Purpose | Key fields / constraints | Lifecycle / delete |
|---|---|---|---|
| `academic_years`, `terms`, `grade_levels`, `classes` | Existing skeleton | Relax class uniqueness for streams; optional `stream_code` / keep stream in `classes.name` | Archive via `is_active`; no hard delete if referenced |
| `departments` | Optional grouping | `school_id`, `name`, `code`, unique `(school_id, code)` | Soft deactivate |
| `subjects` | Catalogue | `code`, `name`, `department_id?`, `is_active` | Soft deactivate; never delete if offerings exist |
| `subject_grade_availability` | Which subjects apply to which grade levels | unique `(subject_id, grade_level_id)` | Replaceable while unused |
| `subject_offerings` | Teachable unit | `subject_id`, `class_id`, `academic_year_id`, optional `term_id` null = year-long; unique offering | Close when year ends; block delete if assessments exist |
| `subject_groups` | Optional elective clusters | school-scoped | Soft deactivate |

#### Teaching structure

| Entity | Purpose | Notes |
|---|---|---|
| `teaching_assignments` | Teacher ↔ offering | `profile_id`, `offering_id`, `role` (`primary` / `assistant` / `substitute`), `starts_on`, `ends_on`, unique active primary |
| `academic_capabilities` | Extra powers without new enum | e.g. `moderate_department`, `approve_results`, `publish_results`, `configure_grading` keyed by profile (+ optional department) |
| Homeroom (existing) | Class teacher comments | Unchanged |

#### Student academic registration

| Entity | Purpose | Notes |
|---|---|---|
| Class enrolment (existing) | Year placement | Source of truth for “in this class” |
| `student_subject_registrations` | Subject load | `student_id`, `offering_id`, `status` (`registered` / `exempt` / `withdrawn` / `completed`), unique active |
| Exemption / optional selection | Via status + reason | Audit required |

#### Assessment configuration

| Entity | Purpose | Notes |
|---|---|---|
| `assessment_types` | School-defined types | Assignment, Test, Quiz, Project, Practical, Mid-term, End-of-term, Final, Custom… |
| `assessment_categories` | Weight buckets | e.g. Continuous / Exams |
| `assessment_weight_schemes` + `lines` | Weight templates | Scope: school / year / term / grade / class / subject / department; lines sum to 10000 basis points (100.00%) |
| `grading_schemes` + `grading_scheme_bands` | Configurable scales | Versioned; see §7 |
| `reporting_periods` | Soft grouping of assessments | Align to terms or custom windows |

#### Examination sessions

| Entity | Purpose | Notes |
|---|---|---|
| `exam_sessions` | Named sitting window | Term finals, mid-terms |
| `exam_schedules` | Timetable rows | Date/time, room, offering/assessment link |
| `exam_invigilators` | Staff on duty | Many-to-many |
| Candidate status | On `assessment_results.status` | `absent`, `excused`, `special_sitting`, `malpractice`, `withheld` |

Phase 2B can ship sessions lightly (session + schedule) before full room/invigilator UX.

#### Marks and results

| Entity | Purpose | Notes |
|---|---|---|
| `assessments` | Concrete assessed work | Max score, due/sit date, type, offering, weight override?, workflow state |
| `assessment_results` | One row per student per assessment | Score, status, comment, version, workflow inherited from assessment batch |
| `assessment_result_revisions` | Correction history | old/new values, reason, actor |
| `mark_entry_batches` | Submission unit | Teacher submits whole assessment set |

#### Gradebook / outcomes / documents / audit

| Entity | Purpose |
|---|---|
| `computed_subject_results` | Materialized subject totals per student/period (from engine) |
| `computed_period_results` | Overall average, bands, optional position |
| `result_publications` | Publish event for a class/period |
| `report_card_snapshots` | Immutable JSON + metadata per student publication |
| `transcript_snapshots` | Cumulative official extract |
| `promotion_policies` / `promotion_decisions` | Configurable rules + approved outcomes |
| `academic_settings` | School feature flags |
| `ranking_policies` | Ranking modes |
| `academic_event_audits` | Append-only academic audit stream |

---

## 6. Entity relationship description

```text
schools
  ├── academic_years → terms
  ├── grade_levels → classes (N per grade/year after uniqueness fix)
  ├── departments → subjects → subject_grade_availability
  ├── subject_offerings (subject × class × year [× term])
  │     ├── teaching_assignments → profiles
  │     ├── student_subject_registrations → students
  │     └── assessments → assessment_types
  │           └── assessment_results → students
  ├── assessment_weight_schemes → lines → assessment_types/categories
  ├── grading_schemes → bands (versioned)
  ├── exam_sessions → exam_schedules
  ├── result_publications → report_card_snapshots
  ├── promotion_policies → promotion_decisions
  └── academic_event_audits
```

**Gradebook roster rule:** students with `student_class_enrollments.status = 'active'` for the class/year, intersected with `student_subject_registrations` for the offering (default: auto-register compulsory subjects on offering create).

---

## 7. Grading architecture

### 7.1 Requirements

Grading is **settings-driven**, supporting percentage, letter/band labels, grade points/GPA, pass/fail, and competency labels — without hardcoding bands such as 80–100 Distinction in application code.

### 7.2 Model

**`grading_schemes`**

- `school_id`, `name`, `scheme_type` (`percentage_bands` | `pass_fail` | `competency` | `gpa` | `custom`)
- `min_score`, `max_score` (usually 0–100 after normalization)
- `decimal_places`, `rounding_mode` (`half_up` recommended default)
- `effective_from_academic_year_id`, optional `effective_to_…`
- `version`, `status` (`draft` | `active` | `retired`)
- `is_default` (one active default per school)

**`grading_scheme_bands`**

- `scheme_id`, `min_inclusive`, `max_inclusive`, `label`, `code`, `grade_point?`, `description?`, `is_pass`, `sort_order`

### 7.3 Validation (DB + app)

- No overlapping bands within a scheme version.  
- Contiguous coverage of `[min_score, max_score]` for percentage schemes (no gaps).  
- `min ≤ max`; codes unique per scheme version.  
- Active scheme used by **published** results cannot be edited in place — **clone to new version** and retire old.  
- Historical published snapshots store **band label/code/point as resolved values**, plus `grading_scheme_id` + `version`.

### 7.4 Historical correctness

When rules change later, **published** report cards and transcripts read from snapshots. Live gradebook for open periods uses the **active** scheme. Draft/unpublished recalculation may change; published artefacts never silently change.

**Recommended default (not confirmed policy):** percentage bands example Distinction/Merit/Credit/Pass/Fail as a **seed template** the school can edit before first publish — not embedded as permanent constants in UI logic.

---

## 8. Assessment weighting architecture

### 8.1 Model

Weights stored as **basis points** (10000 = 100.00%) to avoid float drift.

Scope resolution order (most specific wins):

1. Offering-specific scheme  
2. Subject + grade + term  
3. Grade + term  
4. School default for year  

### 8.2 Formula (authoritative in DB RPC)

For student \(S\), subject offering \(O\), reporting period \(P\):

1. For each included assessment \(a\) with max \(M_a > 0\) and raw score \(r_a\) (only if status is scorable):  
   \(n_a = \mathrm{clamp}(r_a / M_a, 0, 1)\)
2. Category/type weight \(w_a\) from scheme (or assessment override); missing assessments: policy = `exclude_and_renormalize` **or** `treat_as_zero` (school setting; default recommend exclude_and_renormalize for incomplete open periods, treat_as_zero after lock if still missing).  
3. Subject score (0–100):  
   \(T = 100 \times \sum (n_a \times w_a) / \sum w_a^{\mathrm{effective}}\)
4. Round once at the end using scheme `rounding_mode` / `decimal_places`.  
5. Lookup band from active grading scheme.

**Absent / exempt / withheld / malpractice:** non-scorable; excluded from \(T\) unless policy says otherwise; flagged on report card.

**Bonus/penalty:** optional adjustment assessments with signed weight; must be explicit types, not silent edits.

### 8.3 Validation

- Applicable scheme lines sum to exactly 10000 bps.  
- Reject \(r < 0\); reject \(r > M\) unless `allow_extra_credit` on assessment.  
- Locked / published assessments: no teacher edit.  
- Only assigned teachers (or elevated capability) may write results.

### 8.4 Worked example (illustrative)

Weights: Assignments 10%, Tests 20%, Mid-term 30%, End-of-term 40%.  
Scores: A 8/10, Tests 15/20, Mid 24/30, Final 32/40.  
Normalized: 0.80, 0.75, 0.80, 0.80.  
\(T = 100(0.80\cdot0.10 + 0.75\cdot0.20 + 0.80\cdot0.30 + 0.80\cdot0.40) = 78.5\)  
Band from school scheme (e.g. Merit if 70–79) — **from settings**, not code.

---

## 9. Marks workflow

### 9.1 Recommended status model (simplified)

Combine related states to reduce teacher confusion:

| Status | Meaning |
|---|---|
| `draft` | Created; not open / empty |
| `open` | Teachers may enter/edit |
| `submitted` | Teacher submitted; locked for teacher edit |
| `returned` | Reviewer sent back (reason required) → effectively open for assignee |
| `under_review` | Academic review / moderation queue |
| `approved` | Academic authority accepted |
| `published` | Visible per publication rules; snapshot eligible |
| `locked` | No edits without formal unlock |

Optional: `moderation_required` as a flag on school/settings rather than a separate status if review always happens in `under_review`.

### 9.2 Authority matrix (summary)

| Action | Typical actors (BFA mapping) |
|---|---|
| Create assessment / set max | Subject teacher (own offering) + admin/head + academic capability |
| Enter/edit while `open`/`returned` | Assigned subject teacher |
| Submit | Assigned subject teacher |
| Return (reason) | Head / academic capability / HoD capability |
| Moderate / approve | Head / academic capability |
| Publish / lock | Admin / head / publish capability |
| Unlock / correct published | Admin / head only + reason + audit; creates revision + may re-snapshot |

Teachers **cannot** silently change published marks.

---

## 10. Roles and security matrix

### 10.1 Existing roles → academic mapping

| Role | Examinations access (recommended) |
|---|---|
| Administrator | Full configure, publish, unlock, analytics |
| Headteacher | Approve, publish, promotion decisions, school analytics |
| Teacher | Mark entry for assigned offerings; view own classes; class-teacher comments if homeroom |
| Secretary | Limited view / print of **published** cards if granted; no mark entry |
| Bursar | No academic marks by default (optional fee-hold indicator on cards later) |

### 10.2 Future / capability-based (do not require enum change in 2A)

| Capability | Covers brief roles |
|---|---|
| `configure_curriculum` | Academic admin |
| `configure_grading` | Academic admin |
| `moderate_results` | HoD / deputy / academic admin |
| `approve_results` | Head / deputy |
| `publish_results` | Head / admin |
| `view_rankings_internal` | Leadership |
| `view_school_analytics` | Leadership |

**Student / Guardian:** no staff login access now; Parent Portal later reads **published only** via dedicated policies.

### 10.3 Enforcement

- App gates (nav + actions) **and** RLS/RPC checks (Finance pattern).  
- Marks writes only through RPCs with actor + offering assignment checks.  
- No reliance on hidden buttons.

---

## 11. Calculation engine

### 11.1 Authority

| Layer | Responsibility |
|---|---|
| **PostgreSQL RPCs** | Authoritative normalize, weight, round, band lookup, averages, promotion recommendation |
| **Materialized tables** | `computed_*` refreshed on submit/approve/publish |
| **Server actions** | Orchestration, authz, idempotency keys |
| **Client** | Display only; never sole source of published totals |

### 11.2 Rounding

- Store raw scores as `numeric`.  
- Normalize with full precision.  
- Round **once** to scheme decimal places at subject total.  
- Class averages: average of rounded subject totals **or** average then round — pick one school setting; default **average of rounded subject totals** for report consistency.

### 11.3 Ranking inputs

Computed only when policy enabled; exclude incomplete/withdrawn per policy; ties handled per ranking mode.

---

## 12. Ranking policy

**Default recommendation:** rankings **disabled for public/parent surfaces**; optional **internal** class position for leadership.

Configurable:

- Off / class position / grade position / subject position / percentile / bands only  
- Tie modes: share / dense / competition  
- Exclude incomplete, exempt-heavy loads, withdrawn, transfers mid-period (policy flags)  
- Minimum subject count for inclusion  

School may keep analytics without exposing positions on report cards.

---

## 13. Promotion architecture

### 13.1 Policies (`promotion_policies`)

Examples (configurable): min overall average; max failed subjects; must-pass compulsory list; manual-only; conditional promotion; graduation criteria.

### 13.2 Workflow

1. Engine produces **recommendation** (not enrolment change).  
2. Class teacher / academic review optional comments.  
3. Head/admin records **final decision** + reason + date.  
4. Only then RPC may: close enrolment (`completed`), create next-year enrolment / class placement, or mark repeat.  

**Never** silently mutate `student_class_enrollments` from a calculation job.

---

## 14. Report-card architecture

### 14.1 Content (configurable sections)

School branding; year/term; student identity; grade/class; attendance summary; subjects with final score + band; optional raw CA breakdown; teacher remarks; class average; overall average; optional position; discipline summary; class-teacher & head comments; promotion decision; dates; signature blocks; future verification code/QR field.

### 14.2 States

Draft watermark → approved → published. Amendments create **new snapshot version** (immutable history).

### 14.3 Generation

- Batch by class/period; one-student; print-friendly A4 via existing print-first pattern; mobile view of published HTML; optional later server PDF if print quality insufficient.  
- Snapshot JSON stores resolved numbers/labels so later scheme edits do not rewrite history.

---

## 15. Transcript architecture

- Multi-year, multi-term subject history from **published snapshots** and/or sealed `computed_*` rows tied to publication ids.  
- Include repeats, transfers, archived subjects, amendment footnotes.  
- Official transcript = generated from sealed artefacts + school letterhead; never from mutable open gradebooks.

---

## 16. UI route map

### 16.1 Examinations area

| Route | Purpose |
|---|---|
| `/dashboard/examinations` | Overview: open entry, queues, missing scores, published cards |
| `/dashboard/examinations/sessions` | Exam sessions |
| `/dashboard/examinations/schedule` | Timetable |
| `/dashboard/examinations/assessments` | Assessment catalogue / setup |
| `/dashboard/examinations/gradebook` | Teacher entry |
| `/dashboard/examinations/moderation` | Review / return / approve |
| `/dashboard/examinations/results` | Summaries, publish, lock |
| `/dashboard/examinations/report-cards` | Preview, batch, versions |
| `/dashboard/examinations/analytics` | Permissioned analytics |
| `/dashboard/examinations/settings` | Module settings shortcuts |

### 16.2 Global settings

Curriculum catalogue, default grading schemes, weight templates, ranking/promotion toggles also reachable from `/dashboard/settings` (administrator), mirroring fees/rules.

### 16.3 UX surfaces

1. **Overview** — progress, queues, missing marks, locks.  
2. **Teacher gradebook** — assigned classes/subjects; desktop table + mobile student cards; sticky save/submit; validation; mark-all absent; unsaved indicator; confirm submit.  
3. **Moderation** — distributions, outliers, missing, return/approve.  
4. **Results** — class/subject/student summaries; publish/lock; correction flow.  
5. **Report cards** — preview, batch, version history, print/download.

Match existing design system: PageShell, skeletons, EmptyState, ConfirmDialog, Zod forms, responsive nav.

---

## 17. Mobile UX strategy

- Paginate / segment long class lists; avoid loading entire school.  
- Explicit save preferred over aggressive optimistic UI for scores.  
- Draft autosave to server (`open` state) with visible sync status; retry with idempotency keys.  
- Prevent double-submit on submit/publish.  
- Touch-friendly targets; desktop keyboard tab-through for rapid entry.  
- **No complex offline-first** unless a later phase proves need; rely on retryable saves and clear error recovery for Zambia connectivity conditions.

---

## 18. Audit architecture

Append-only `academic_event_audits` (`school_id`, `event_type`, `actor_id`, `entity_type`, `entity_id`, `metadata`, `created_at`).

| Event type | Required metadata (examples) |
|---|---|
| `SUBJECT_CREATED` | subject id, code |
| `TEACHER_SUBJECT_ASSIGNED` | offering, teacher, dates |
| `ASSESSMENT_CREATED` | offering, type, max |
| `MARK_ENTERED` / `MARK_UPDATED` | assessment, student, old/new score |
| `MARKS_SUBMITTED` / `MARKS_RETURNED` | batch id, reason if returned |
| `MARKS_MODERATED` | notes |
| `RESULTS_APPROVED` / `PUBLISHED` / `LOCKED` / `UNLOCKED` | period, class, reason if unlock |
| `PUBLISHED_RESULT_CORRECTED` | revision ids, reason |
| `REPORT_CARD_GENERATED` / `PUBLISHED` | snapshot id, version |
| `PROMOTION_DECISION_RECORDED` | decision, reason |

Never store passwords, tokens, or raw session secrets.

---

## 19. Analytics architecture

Permissioned views/RPCs for: student trends; subject/class/grade performance; pass/fail/distinction rates; assessment completion; missing scores; year-to-year; support lists.

- Respect role/capability; teachers see assigned scope by default.  
- Demographic splits only if lawful and school-enabled.  
- Do not expose other students’ PII beyond need-to-know.

---

## 20. Parent Portal compatibility

Design now; implement later.

Parents may access: **published** results, **published** report cards, academic history extracts, guardian-facing comments, promotion decisions, attendance summaries (existing).

Parents must never see: drafts, moderation notes, unpublished results, internal rankings when disabled, other students’ records.

Implementation foresight: `publication_id` on artefacts; RLS policies prepared for a future `guardian` auth mapping via `student_guardians`.

---

## 21. Phased implementation roadmap

### Phase 2A — Academic foundations

| Item | Detail |
|---|---|
| Scope | Relax class uniqueness; departments (optional); subjects; grade availability; offerings; teaching assignments; grading schemes; assessment types/categories; weight scheme skeletons; academic_settings; capability table; RLS + admin UI under Settings/Examinations |
| Tables | Listed in §5 for structure/config |
| Migrations | New ordered SQL; no finance/attendance rewrites |
| Routes | Settings curriculum + `/dashboard/examinations` shell |
| RPCs | CRUD config with admin/capability checks |
| Tests | Constraint tests; weight sum; scheme band validation |
| Acceptance | Admin can define subjects, assign teachers, create a grading scheme; no mark entry yet |
| Dependencies | None beyond current platform |
| Risks | Class uniqueness migration on live classes (BFA currently 1:1 — low risk) |

### Phase 2B — Assessment & examination setup

Assessments, sessions, schedules, registration/exemptions, validation.  
Acceptance: teachers see assigned assessments; no publish yet.

### Phase 2C — Teacher gradebook

Results entry, drafts, submit, mobile UX, audits.  
Acceptance: submit locks teacher edits; audits written.

### Phase 2D — Moderation & approval

Review queues, return, approve, lock/unlock with reasons.

### Phase 2E — Calculation engine

Weighted scoring, bands, averages, optional rankings, promotion **recommendations** only.

### Phase 2F — Results & report cards

Publications, immutable snapshots, print/PDF, academic history/transcript extracts.

### Phase 2G — Analytics & production verification

Analytics, performance, security tests, controlled smoke data (disposable), release readiness.

---

## 22. Risks

| Risk | Mitigation |
|---|---|
| Class uniqueness blocks streams | Fix in 2A before offerings scale |
| Client-side calculation drift | RPC authority + snapshots |
| Concurrent mark entry | Unique `(assessment_id, student_id)`; optimistic version; batch submit |
| Editing published results | Unlock workflow + revisions + new snapshot version |
| Role enum explosion | Capabilities table |
| UI naming confusion (marks/grades) | Glossary in product copy |
| Weight schemes that don’t sum to 100% | DB check + UI validator |
| Premature Parent Portal exposure | Publish-only contract |
| Low bandwidth data loss | Server drafts + idempotent saves |
| Hardcoded Zambia bands | Seed templates only; editable |

---

## 23. Open school-policy decisions

| Decision | Recommended default (unconfirmed) |
|---|---|
| Grading scale | Editable percentage bands (Distinction…Fail template) |
| Pass mark | Band `is_pass` boundary (often 50) — school confirms |
| Assessment weights | 10/20/30/40 template — school confirms |
| Terms per year | Keep 1–4 model already in DB |
| Subjects per grade | School supplies catalogue |
| Compulsory vs optional | Flag on availability/registration |
| Rankings | Off on report cards; optional internal |
| Report-card layout | Print-first A4 sections matching receipt tone |
| Promotion | Manual approval with engine recommendation |
| Who approves/publishes | Headteacher + administrator |
| Who unlocks published | Administrator (+ head if school wants) |
| Competency grading | Not required for v1; scheme_type reserved |
| Full exam scheduling | Lightweight sessions in 2B; rooms/invigilators later |
| Transcripts | After report-card snapshots (2F) |

---

## 24. Recommended next implementation phase

**Phase 2A — Academic foundations** only:

1. Migration to allow multiple classes per grade per year (preserve existing BFA rows).  
2. `subjects`, `subject_grade_availability`, `subject_offerings`, `teaching_assignments`.  
3. `grading_schemes` + bands with validation.  
4. `assessment_types`, categories, weight scheme tables.  
5. `academic_settings` + `academic_capabilities`.  
6. RLS + admin configuration UI.  
7. Automated tests for constraints and permissions.  
8. No mark entry, no publish, no deploy of incomplete academic ledgers.

Do **not** start 2B until 2A acceptance criteria pass and critical policy items in §23 are confirmed or explicitly deferred with documented defaults.

---

## Repository verification (this phase)

| Check | Result |
|---|---|
| `npm test` | Pass — 106 tests |
| `npm run lint` | Pass — 0 errors (pre-existing warnings only) |
| `npm run build` | Not run — architecture-only; no code changes |

---

## Final decision

**APPROVED TO IMPLEMENT**

The organisational foundation is production-ready and sufficient to hang a configurable Examinations & Gradebook module. Gaps are expected (no curriculum/exams product yet) and are addressed by a Finance-aligned, settings-driven design with immutable published artefacts. The only structural prerequisite inside 2A is relaxing one-class-per-grade uniqueness before multi-stream offerings. Proceed to Phase 2A after confirming or deferring §23 policy items — **do not implement Phase 2A in this architecture phase.**
