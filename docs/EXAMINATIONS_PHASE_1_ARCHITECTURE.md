# PHASE 1 — Examinations & Gradebook Architecture

**System:** Blessed Faith Academy School Management System (multi-school-ready platform)  
**Document date:** 2026-07-22  
**Phase type:** Architecture only (no migrations, RPCs, UI, or deploys in this phase)  
**Baseline:** Finance production-ready; structural academics (years / terms / grades / classes / enrolments) exist; **no curriculum or grading product exists today**

---

## Executive summary

The platform already has a solid **organisational academic skeleton** (school-scoped years, terms, grade levels, classes, enrolments, homeroom teachers) used by enrolment, fees, and attendance. It does **not** yet have subjects, departments, subject-teacher assignments, assessments, marks, grade scales, report cards, transcripts, or promotion workflows.

This document proposes a **configurable, multi-tenant Examinations & Gradebook** architecture that:

- reuses existing tenant, role, RPC, RLS, and audit patterns from Finance / Attendance / Discipline;
- keeps grading, weighting, ranking, and promotion **school-configurable** (never Zambia-hardcoded);
- supports future schools without code forks;
- phases delivery like Finance (schema → workflows → calculation → reports → verification).

**Final recommendation:** `APPROVED TO IMPLEMENT` (see §Final decision).

---

## 1. Current system audit

### 1.1 What exists (verified in migrations + app)

| Area | Reality | Primary sources |
|---|---|---|
| **Academic years** | `academic_years` (`school_id`, `name`, dates, `is_current`, `is_active`); one current per school | `20260715120000_core_config_data.sql`, `set_current_academic_year` |
| **Terms** | `terms` (`academic_year_id`, `school_id`, `term_number` 1–4, `is_current`); one current per school | same + `20260716150200_current_term_per_school.sql`, `set_current_term` |
| **Grade levels** | `grade_levels` (Baby Class → Grade 7 seeded for BFA) | core config migration |
| **Classes** | `classes` tied to `(academic_year_id, grade_level_id)` with **unique pair** → **one class per grade per year** | core config |
| **Homeroom teacher** | `classes.homeroom_teacher_id` → `profiles` | auth + attendance helpers |
| **Student enrolments** | `student_class_enrollments` (`active` / `transferred` / `completed` / `withdrawn`); one **active** per student per year | `20260715140000_…`, transfer/archive RPCs |
| **Staff roles** | `administrator`, `headteacher`, `bursar`, `secretary`, `teacher` | `staff_role` enum |
| **Attendance** | Daily class register; covers; audits; class/student history | `attendance_records`, reports |
| **Discipline** | Incidents + rules; student list + school snapshot report | discipline migrations |
| **Finance** | Charges/payments/allocations; student summary RPC; receipts; fee balances report | finance module |
| **School branding** | `name`, `motto`, `address`, `phone`, `email`, `logo_url`, prefixes | `schools` |
| **Reports hub** | Enrolment, attendance, fee balances, discipline | `/dashboard/reports/*` |
| **Settings** | Set current year/term; view grades/classes; fee schedules | `/dashboard/settings` |
| **Promotion** | Mid-year **class transfer** only; **no year-end promotion** | `transfer_student_class` |
| **Subjects / exams / marks** | **None** | confirmed absent |

### 1.2 Teacher linkage today

Teachers connect to classes **only for attendance**:

1. Homeroom (`classes.homeroom_teacher_id`)
2. Temporary cover (`class_attendance_covers`)

There is **no** subject-teacher assignment model.

### 1.3 Important existing constraints (must inform design)

1. **One class per grade per year** (`UNIQUE (academic_year_id, grade_level_id)`). Fine for current BFA seeding; **too tight** for multi-stream schools (e.g. Grade 5A / 5B). Exams architecture requires relaxing this in Phase 2 foundation work.
2. **`enrollment_status.completed` exists but is unused** — ideal hook for year-end close / promotion history.
3. **No Academic Officer / HoD role** — moderation must use either new roles **or** assignment tables (preferred for flexibility).
4. **“Marks” in current product = attendance marks**, not academic scores — naming in UI must stay unambiguous (`Score`, `Mark entry`, `Assessment result`).
5. **Multi-school pattern is mature:** every operational table carries `school_id`; RLS uses `current_user_school_id()` + role helpers; writes prefer SECURITY DEFINER RPCs (Finance model).

### 1.4 Reusable patterns from Finance (do not reinvent)

| Pattern | Apply to Examinations |
|---|---|
| School-scoped tables + RLS SELECT | All academic tables |
| Client cannot raw-insert sensitive ledgers | Marks / publications via RPCs |
| Append-only audits | Mark edits, publish, reopen, promotion |
| Immutable snapshots at publish time | Report-card / result snapshots |
| Feature gates / school settings | Ranking on/off, moderation required, grading scheme |
| Soft locks + authorised reopen | Assessment / period locks |
| Phased migrations + smoke verification | Implementation roadmap |

---

## 2. Proposed architecture overview

### 2.1 Design principles

1. **Tenant-first:** every row belongs to a `school_id`.
2. **Config over code:** grading scales, weights, ranking, promotion rules live in settings tables.
3. **Curriculum is first-class:** Subjects → offerings → teaching assignments → assessments → results.
4. **Workflow-state for marks:** draft → submitted → (optional moderated) → approved → locked → published.
5. **Publish creates immutable artefacts:** report-card snapshots never recalculate from live edits after publish.
6. **Homeroom ≠ subject teacher:** keep attendance homeroom; add subject teaching assignments.
7. **Future-proof hooks** without implementing CBT/portfolios/AI now (nullable metadata, extension tables later).

### 2.2 Domain map (high level)

```text
School
  ├── AcademicYear → Term
  ├── GradeLevel → Class (many per grade/year after foundation fix)
  ├── Department (optional) → Subject
  ├── SubjectOfferings (subject × class × year × term scope)
  ├── TeachingAssignments (teacher ↔ offering)
  ├── AssessmentTypes + WeightSchemes
  ├── GradingSchemes (+ boundaries)
  ├── ExamSessions / AssessmentInstances
  ├── GradebookEntries (marks) + workflow + audits
  ├── ResultPublications + ReportCardSnapshots
  ├── RankingPolicies + PromotionPolicies
  └── AcademicHistory / Transcripts (derived + published)
```

### 2.3 Fit with existing entities

| Existing | Role in Examinations |
|---|---|
| `academic_years` / `terms` | Period scoping for offerings, assessments, publications |
| `grade_levels` / `classes` | Cohort for gradebooks and rankings |
| `student_class_enrollments` | Who appears on a class gradebook (active enrolments) |
| `profiles` (teachers) | Teaching assignments, mark entry actors |
| `classes.homeroom_teacher_id` | Class-teacher comments / class overview (not subject marks) |
| Attendance / discipline / finance summaries | Optional report-card sections via existing queries/RPCs |
| `schools` branding | Report cards / transcripts |

---

## 3. Complete academic model (entities)

### 3.1 Foundation extensions (Phase 2 prerequisite)

| Entity | Purpose |
|---|---|
| **Relax class uniqueness** | Allow multiple classes per grade per year (`stream` / `section` name uniqueness within grade+year) |
| **`departments`** | Optional organisational units (Languages, Sciences, …) |
| **`subjects`** | School catalogue (`code`, `name`, `department_id?`, `is_active`) |
| **`subject_grade_availability`** | Which subjects apply to which grade levels |
| **`subject_offerings`** | Concrete teaching unit: subject + class + academic year (+ optional term continuum) |
| **`teaching_assignments`** | Teacher(s) on an offering (`primary`, `assistant`); effective date range |
| **`class_teacher_assignments`** | Explicit class teacher if distinct from `homeroom_teacher_id` (or treat homeroom as class teacher — recommend **alias**, don’t duplicate unless needed) |

### 3.2 Assessment & grading catalogue

| Entity | Purpose |
|---|---|
| **`assessment_types`** | School-defined types (Assignment, Quiz, CA, Midterm, Final, Practical, Oral, Project, Custom…) |
| **`grading_schemes`** | Named schemes (Percentage, Letter, GPA, Competency, Custom) |
| **`grading_scheme_boundaries`** | Min/max score → letter / GPA / remark / pass / distinction flags |
| **`assessment_weight_schemes`** | Per subject-offering or per grade+subject template: type → weight % (must sum 100) |
| **`exam_sessions`** | Optional calendar container (e.g. “Term 2 Finals 2026”) |
| **`assessments`** | Concrete assessed work (see §4) |
| **`assessment_results`** | One row per student per assessment (score, status, comments) |
| **`assessment_result_versions`** | Optional version history of score changes |
| **`mark_entry_batches`** | Workflow container for a teacher’s submission of an assessment’s marks |

### 3.3 Publication & history

| Entity | Purpose |
|---|---|
| **`reporting_periods`** | Locked academic windows (often = term, or custom) |
| **`result_publications`** | School/class/term publish events |
| **`report_card_snapshots`** | Immutable per-student published card JSON + rendered metadata |
| **`transcript_snapshots`** | Cumulative published academic record extracts |
| **`promotion_decisions`** | Per student year-end outcome + rule snapshot |
| **`academic_event_audits`** | Append-only audit (mirrors `finance_event_audits`) |

### 3.4 Policies (settings)

| Entity | Purpose |
|---|---|
| **`academic_settings`** | One row per school: ranking enabled, moderation required, fee indicator on cards, etc. |
| **`ranking_policies`** | Scope (class / subject / grade-level) + tie-break rules + enable flags |
| **`promotion_policies`** | Rule set (auto / min average / must-pass subjects / manual / conditional) |
| **`report_card_templates`** | Template key + layout options + enabled sections |

### 3.5 Entity relationship (logical)

```text
schools 1──* academic_years 1──* terms
schools 1──* grade_levels 1──* classes *──1 academic_years
students 1──* student_class_enrollments *──1 classes

schools 1──* departments 1──* subjects
subjects 1──* subject_offerings *──1 classes
subject_offerings 1──* teaching_assignments *──1 profiles(teachers)

grading_schemes 1──* grading_scheme_boundaries
assessment_weight_schemes 1──* weight_scheme_lines (*──1 assessment_types)

subject_offerings 1──* assessments *──1 assessment_types
assessments 1──* assessment_results *──1 students
assessments 1──* mark_entry_batches

reporting_periods / exam_sessions group assessments
result_publications produce report_card_snapshots
promotion_policies → promotion_decisions
```

---

## 4. Assessment model

### 4.1 Assessment types (configurable)

Seed **examples** per school (editable, not hardcoded product logic):

- Assignment, Homework, Quiz, Test  
- Continuous Assessment (CA/CAT)  
- Midterm, Final Examination  
- Practical, Oral, Project  
- Custom (school-defined label)

Store in `assessment_types` with: `code`, `name`, `category`, `is_active`, `sort_order`.

### 4.2 Assessment instance fields

Each `assessments` row supports:

| Field | Notes |
|---|---|
| `title` | Required |
| `subject_offering_id` | Implies subject, class, year |
| `assessment_type_id` | |
| `created_by` / `owner_teacher_id` | Usually assignment primary teacher |
| `term_id` / `academic_year_id` | Denormalised for query speed |
| `exam_session_id` | Optional |
| `due_on` / `assessed_on` | Due vs sat date |
| `max_score` | Numeric; precision school-configurable (default 2 dp) |
| `weight_override` | Optional; else scheme line weight |
| `publication_status` | `draft` / `published_to_staff` / `published_to_families` (future) |
| `lock_status` | `open` / `locked` |
| `workflow_status` | Aggregated from batch: draft → … → published |
| `metadata` | JSONB for rubrics / competency links later |

### 4.3 Results

`assessment_results`:

- `student_id`, `assessment_id`, `score` (nullable = missing), `is_absent`, `is_exempt`
- `remark`, `entered_by`, `updated_at`
- Unique `(assessment_id, student_id)`
- Only students with **active enrolment** in the offering’s class at assessment date (policy-configurable for transfers)

---

## 5. Flexible grading system

### 5.1 Requirement

**Grading MUST NOT be hardcoded.** No fixed A–F or Zambian scale in application code.

### 5.2 Model

**`grading_schemes`**

- `name`, `scheme_kind` (`percentage` | `letter` | `gpa` | `competency` | `custom`)
- `min_score`, `max_score` (usually 0–100, but customisable)
- `pass_mark`, `distinction_mark` (optional absolute thresholds)
- `is_default` per school

**`grading_scheme_boundaries`**

- `min_inclusive`, `max_inclusive`
- `letter` (nullable)
- `gpa_value` (nullable)
- `competency_level` (nullable)
- `remark` (e.g. “Excellent”)
- `is_pass`, `is_distinction`

**Resolution function (RPC):** `resolve_grade(scheme_id, score) → { letter, gpa, remark, is_pass, … }`

### 5.3 Subject-specific schemes (recommended optional)

Allow `subject_offerings.grading_scheme_id` override; else school default; else percentage display only.

### 5.4 Multi-school

Each school owns schemes. New schools start from a **template pack** (optional seed), then customise in Settings — never shared mutable globals.

---

## 6. Weighted assessments

### 6.1 Weight schemes

`assessment_weight_schemes` scoped by:

- school + academic year + grade level + subject (template), **or**
- directly on `subject_offering_id`

Lines: `assessment_type_id` → `weight_percent`.

### 6.2 Validation rules

1. Active lines for a scheme **must sum to 100.00%** (DB constraint / RPC check).
2. Creating/submitting results for a type **not in the scheme** is allowed only if school setting `allow_unweighted_formative = true` (excluded from term average).
3. If multiple assessments share a type, define aggregation: **average within type**, then apply type weight (default), or **best of N**, or **sum capped** — store `within_type_method` on scheme.
4. Term subject score =

```text
Σ ( type_aggregate_score_as_% × type_weight% ) 
```

converted via grading scheme.

### 6.3 Configuration UX (later phase)

Settings → Academics → Weight schemes, with live sum indicator and block-save unless 100%.

---

## 7. Mark entry workflow

### 7.1 State machine (per assessment / batch)

```text
DRAFT
  → (teacher saves) DRAFT
  → (teacher submits) SUBMITTED
  → [if moderation enabled] IN_MODERATION
  → APPROVED
  → LOCKED
  → PUBLISHED
```

Reopen paths (authorised only):

```text
LOCKED / PUBLISHED → REOPENED_DRAFT → (re-submit cycle)
```

Each transition writes `academic_event_audits`.

### 7.2 Teacher actions

| Action | Effect |
|---|---|
| Enter / edit scores | Only while DRAFT or REOPENED_DRAFT and assigned teacher |
| Save draft | Persist without workflow advance |
| Submit | Validates completeness rules; freezes teacher edits |
| View progress | Counts entered / missing / exempt |

### 7.3 After lock

Teachers **cannot** edit without an authorised **reopen** (Academic Office / Admin / HoD per policy). Reopen requires reason; prior scores versioned.

---

## 8. Moderation & approval

### 8.1 Actors (logical)

| Actor | Typical mapping in this codebase |
|---|---|
| Teacher | `profiles.role = teacher` + teaching assignment |
| Head of Department | Assignment on `departments` (`department_heads`) — **preferred over new enum value initially** |
| Academic Office | New optional role **or** `headteacher` + `administrator` capability flags in `academic_settings` |
| Administrator | `administrator` |

**Recommendation:** Phase 2 introduces `department_heads` + permission helpers (`can_moderate_assessments`, `can_publish_results`) before adding many new `staff_role` enum values. Add `academic_officer` role only if product needs a distinct job title later.

### 8.2 Permission matrix (default template; school-overridable)

| Capability | Teacher | HoD | Academic Office / Headteacher | Admin |
|---|---|---|---|---|
| Create assessment for own offering | ✓ | ✓ | ✓ | ✓ |
| Enter marks (own) | ✓ | ✓ | ✓ | ✓ |
| Submit marks | ✓ | ✓ | ✓ | ✓ |
| Moderate | | ✓ (dept) | ✓ | ✓ |
| Approve / lock | | optional | ✓ | ✓ |
| Reopen locked | | | ✓ | ✓ |
| Publish results / report cards | | | ✓ | ✓ |
| Edit grading schemes / weights | | | ✓ | ✓ |
| Configure promotion / ranking | | | ✓ | ✓ |

### 8.3 Optional moderation

`academic_settings.require_moderation`:

- `false` → Submit jumps to APPROVED (or directly LOCKED per setting)
- `true` → SUBMITTED must be moderated before APPROVED

---

## 9. Report cards

### 9.1 Content sections (template-driven)

| Section | Source |
|---|---|
| School branding | `schools` |
| Student details | `students` + enrolment class/grade |
| Subjects & scores | Published aggregates + scheme grades |
| Assessment breakdown | Optional detail lines |
| Teacher comments | Per subject offering + class teacher |
| Head teacher comments | Period-level |
| Attendance summary | Existing attendance aggregates |
| Discipline summary | Optional; existing incidents snapshot |
| Fee status indicator | Optional; `get_student_finance_summary` outstanding/credit (no payment ledger dump) |
| Promotion recommendation | From promotion engine (draft until confirmed) |
| Signatures | Template slots (name/date); digital later |
| QR verification | Store `verification_token` on snapshot (render later) |
| Printable / PDF | Print CSS first; PDF worker later |

### 9.2 Immutability

On publish:

1. Compute aggregates from **locked** assessments only.
2. Write `report_card_snapshots` (JSON payload + hashes).
3. Subsequent mark reopens **do not** mutate old snapshots; republish creates a new version.

### 9.3 Multiple templates

`report_card_templates`: classic, compact, competency — school selects default; class/grade overrides allowed.

---

## 10. Academic analytics

### 10.1 Metrics (computed views / RPCs; materialise later if needed)

- Student / subject / class averages  
- Top performers / most improved (term-over-term)  
- Pass / failure rates  
- Grade distribution histograms  
- Term and year comparisons  

### 10.2 Performance approach

- Prefer **pre-aggregated publish snapshots** for historical analytics  
- Live “current draft” analytics only for small scopes (one class)  
- Paginate school-wide dashboards; avoid N+1 PostgREST `.in()` traps (Finance lesson)

---

## 11. Ranking

### 11.1 Configurable

`ranking_policies`:

- `enable_overall_class_rank`  
- `enable_subject_rank`  
- `enable_grade_level_rank`  
- `tie_break` (`equal_rank` | `by_name` | `by_assessment_count`)  
- `exclude_exempt` / `minimum_subjects`

When all disabled: UI hides ranks; snapshots store `rank: null`.

### 11.2 Computation timing

Ranks computed at **publish** (or explicit “freeze ranks” job) and stored on snapshots — not live-recalculated on every page view after publish.

---

## 12. Promotion rules

### 12.1 Policy kinds (configurable)

| Kind | Behaviour |
|---|---|
| `automatic` | All enrolled students promoted if policy predicates pass |
| `minimum_average` | Overall average ≥ threshold |
| `must_pass_subjects` | Listed subjects must `is_pass` |
| `manual_approval` | Staff decision required for each student |
| `conditional` | Promote with conditions recorded |
| `repeat_year` | Explicit outcome |

### 12.2 Decision workflow

1. Year-end reporting period locked + results published.  
2. Engine proposes `promotion_decisions` (status `proposed`).  
3. Academic Office confirms → `confirmed`.  
4. Execution job (separate, careful): create next-year class enrolments; set prior enrolment `completed`; never destroy history.

### 12.3 Relationship to existing transfer

Mid-year `transfer_student_class` remains unchanged. Promotion is **year-boundary** only.

---

## 13. Security model

### 13.1 RLS strategy

- All exam tables: `school_id = current_user_school_id()` for SELECT.  
- Writes: **revoked** from `authenticated` for results, publications, schemes (except controlled draft tables if desired).  
- Prefer **SECURITY DEFINER RPCs** with explicit `can_*` checks (Finance style).

### 13.2 Suggested permission helpers

- `can_manage_academic_settings()`  
- `can_manage_curriculum()` (subjects/offerings)  
- `can_enter_marks(offering_id)`  
- `can_moderate_assessment(assessment_id)`  
- `can_publish_results()`  
- `can_view_student_academic(student_id)` (teachers: only assigned offerings / homeroom class)

### 13.3 Parent / student (future)

No parent portal now. Design `publication_visibility` (`staff_only` | `family`) on publications so future parent role only sees published snapshots.

### 13.4 Finance interaction

Report cards may show **fee indicator** only via existing summary RPC; examinations module must **not** write finance tables.

### 13.5 Audit

`academic_event_audits` event types (examples):

`assessment_created`, `marks_saved`, `marks_submitted`, `marks_moderated`, `marks_approved`, `marks_locked`, `marks_reopened`, `results_published`, `promotion_proposed`, `promotion_confirmed`, `scheme_changed`

---

## 14. Performance considerations

| Risk | Mitigation |
|---|---|
| Large mark grids (class × students) | Paginate students; batch upsert RPC; optimistic UI saves |
| School-wide analytics | Snapshot-based; async jobs later |
| Cloudflare Workers CPU/time | Heavy PDF/aggregation as queued jobs or edge-friendly print views first |
| Supabase row volume | Indexes on `(school_id, term_id)`, `(assessment_id)`, `(student_id, academic_year_id)`, `(subject_offering_id)` |
| PostgREST URL limits | Avoid huge `.in()` lists; use RPC set-returning functions |
| Concurrent mark entry | Row-level locks on result rows; batch advisory lock per assessment on submit |

---

## 15. Future expansion (hooks only)

| Future capability | Architectural hook |
|---|---|
| Online exams / CBT | `assessments.delivery_mode`, separate `online_attempts` table later |
| Homework upload | `submission_artifacts` linked to assessment_results |
| Rubrics / outcomes | `rubric_id`, `learning_outcome_scores` JSONB/extension tables |
| Competency tracking | Competency grading schemes + outcome maps |
| Portfolios | Student artifact store keyed by student + year |
| AI insights | Read-only analytics on snapshots; no write into marks |
| National exam import | Import batch table with external provider code |
| SMS / email results | Notification outbox on `result_publications` |
| Parent portal | Visibility flags + guardian auth (future module) |

Do **not** build these in early phases; keep columns/`metadata` extensible.

---

## 16. Recommendations (evaluate each)

| # | Item | Recommendation | Justification |
|---|---|---|---|
| 1 | Configurable grading systems | **Must have** | Multi-school requirement; avoids Zambia lock-in |
| 2 | Configurable assessment weightings | **Must have** | Core of fair term scores; validate Σ=100% |
| 3 | Configurable ranking on/off | **Must have** | Some schools forbid ranks |
| 4 | Multiple report card templates | **Should have** (Phase 5+) | Branding/layout varies; start with one template + flags |
| 5 | Subject-specific grading scales | **Should have** | Optional override; default school scheme first |
| 6 | Academic audit trail | **Must have** | Matches finance discipline; trust requirement |
| 7 | Marks version history | **Should have** | Strongly recommended with reopen; can start with audit+before/after |
| 8 | Locked reporting periods | **Must have** | Prevents silent historical drift |
| 9 | Bulk marks import CSV/Excel | **Should have** (Phase 3+) | Teachers expect it; validate carefully |
| 10 | Bulk marks export | **Should have** | Ops + inspectors |
| 11 | Teacher marking progress dashboard | **Must have** (Phase 3) | Operational completeness |
| 12 | Student academic timeline | **Should have** | Fits existing student profile tabs |
| 13 | Transcript generator | **Should have** (after report cards) | Builds on snapshots |
| 14 | Scholarship / honours recognition | **Could have** | Rule engine on publish aggregates |
| 15 | Early warning for struggling students | **Should have** (Phase 6) | Analytics + thresholds |
| 16 | Academic awards | **Could have** | Same as 14 |
| 17 | Parent portal integration | **Future** | Design visibility now; implement later |
| 18 | SMS/Email result notifications | **Future** | Outbox pattern on publish |
| 19 | AI performance analytics | **Future** | Consume snapshots only |
| 20 | Multi-school compatibility | **Must have** | Platform goal; `school_id` + settings everywhere |

---

## 17. Implementation roadmap

Phased like Finance; each phase independently testable.

### Phase 1 — Architecture *(this document)*

- Audit + design approval gate.

### Phase 2 — Database & security foundation

- Relax multi-class-per-grade constraint (migration + data check).  
- Tables: departments, subjects, offerings, teaching assignments, assessment types, grading schemes, weight schemes, academic settings, academic audits.  
- RLS + `can_*` helpers + Settings CRUD (admin).  
- **Exit:** seed subjects for BFA; assign teachers; no marks yet.

### Phase 3 — Teacher workflows

- Create assessments; mark entry UI; draft/submit; progress dashboard.  
- Bulk CSV import (optional behind flag).  
- **Exit:** teachers can submit a complete class assessment safely.

### Phase 4 — Grade calculations & moderation

- Weight engine; grading resolution RPC; moderation/approval/lock/reopen.  
- Reporting period locks.  
- **Exit:** locked term subject totals match fixture expectations.

### Phase 5 — Report cards & publication

- Publish workflow; immutable snapshots; printable card; optional attendance/discipline/fee panels.  
- Ranking freeze on publish.  
- **Exit:** published card stable after reopen+edit of drafts.

### Phase 6 — Analytics, promotion, transcripts

- Class/subject analytics; early-warning thresholds; promotion proposals; transcript export.  
- **Exit:** year-end promotion dry-run on staging school.

### Phase 7 — Production verification

- Smoke scripts (create offering → assess → mark → lock → publish → snapshot).  
- Security denials (teacher cannot edit locked; cross-school isolation).  
- Lint/test/build/cf:build; readiness report; deploy only when approved.

---

## 18. Workflow diagrams (text)

### 18.1 Mark lifecycle

```text
[Teacher assigned to SubjectOffering]
        │
        ▼
 Create Assessment (type, max, dates)
        │
        ▼
 Enter scores ──Save Draft──┐
        │                   │
        └◄──────────────────┘
        │
     Submit
        │
        ├─(moderation off)──► Approved ─► Lock ─► Publish ─► Snapshots
        │
        └─(moderation on)───► In Moderation ─► Approved ─► Lock ─► Publish
                                      ▲
                                      │ reject with comments
                                      └── back to Teacher draft
```

### 18.2 Year-end

```text
Lock reporting period → Publish results → Compute ranks
        → Run promotion policy → Review decisions → Confirm
        → Generate next-year enrolments (separate controlled job)
```

---

## 19. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Existing one-class-per-grade unique constraint blocks multi-stream schools | High | Phase 2 mandatory schema change |
| Confusing attendance “marks” with academic marks | Medium | Vocabulary + IA separation in nav (“Examinations”) |
| Premature CBT/parent portal scope creep | High | Strict phase gates |
| Live recalculation of published cards | High | Snapshot-on-publish (Finance lesson) |
| Role inflation (too many enums) | Medium | Assignment tables + helpers first |
| Heavy Worker PDF generation | Medium | Print-first; async PDF later |
| Teachers marking wrong class after transfers | Medium | Enrolment-as-of-date rules; explicit student list RPC |
| Weight schemes ≠ 100% | Medium | DB/RPC enforcement |
| Cross-module PII on cards (fees/discipline) | Medium | Optional sections + role-aware printing |

---

## 20. Out of scope for early delivery

- Online CBT engines  
- Parent portal UI  
- National exam board integrations  
- AI tutoring / insights productisation  
- Replacing attendance or finance modules  

---

## Final decision

# APPROVED TO IMPLEMENT

**Why**

1. The existing **tenant, year/term, class enrolment, staff, attendance, discipline, and finance** foundations are sufficient to hang a gradebook on without rewriting completed modules.  
2. Gaps (subjects, offerings, teaching assignments, configurable grading/weights, mark workflow, snapshots) are **additive** and map cleanly to proven Finance patterns (RPC writes, RLS, audits, immutable publish snapshots).  
3. Known structural debt (**one class per grade per year**) is identified and scheduled as an explicit Phase 2 prerequisite — it does not invalidate the architecture.  
4. Configurability requirements (grading, weights, ranking, promotion) are achievable via settings tables without hardcoding national scales.  
5. A phased roadmap allows independently testable increments through to production verification.

**Implementation may proceed to Phase 2 (Database & Security Foundation)** after product owner acceptance of this document. Phase 2 must include the multi-class-per-grade foundation change before subject offerings are relied upon in production.

---

## Confirmations (this phase)

| Action | Status |
|---|---|
| Migrations created | **Not done** (architecture only) |
| Database modified | **Not done** |
| Implementation / UI / routes | **Not done** |
| Deploy | **Not done** |
