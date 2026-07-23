# Examinations Phase 2A — Academic Foundations Implementation

**System:** Blessed Faith Academy School Management System  
**Date:** 2026-07-23  
**Architecture:** `docs/EXAMINATIONS_PHASE_1_ARCHITECTURE.md` (APPROVED TO IMPLEMENT)  
**Deploy:** Not deployed in this phase (code + migrations only)

---

## Scope implemented

Phase 2A delivers **configuration foundations only**:

1. Class stream support (relax one-class-per-grade uniqueness)
2. Subject catalogue (+ optional prerequisites data model)
3. Subject offerings (bulk grade assignment UI)
4. Teaching assignments
5. Configurable grading schemes + bands
6. Assessment types + weight schemes
7. Optional academic workflow dates
8. Academic capabilities + RLS + secure RPCs + audit events
9. Guided Academic Setup UI under Settings
10. Automated tests for schemas/capabilities

**Not implemented (by design):** marks entry, gradebook calculations, exams scheduling UX beyond dates, report cards, rankings, moderation queues, transcripts, promotion decisions, Parent Portal.

---

## Architecture decisions vs Phase 1

| Topic | Decision |
|---|---|
| Streams | Keep `classes.name` as primary label; optional `stream_code`; unique on `(year, grade, lower(name))` |
| Single-class grades | No forced “Grade 5A” — “Grade 5” remains valid |
| Capabilities | DB helper `has_academic_capability` with role defaults + optional `academic_capabilities` rows |
| Security | SELECT via RLS; writes via SECURITY DEFINER RPCs only |
| UX language | “Subjects by grade”, “Grading scale”, “Assessment weights” — not internal table names |
| Defaults | Recommended grading bands + 10/20/30/40 weights — editable, confirm required |

---

## Migrations (apply in order)

| File | Purpose |
|---|---|
| `20260723120000_academic_audit_and_capabilities.sql` | `academic_event_audits`, `academic_capabilities`, `academic_settings`, helpers |
| `20260723120100_classes_stream_support.sql` | Drop restrictive unique; stream support; `create_class` / `update_class` |
| `20260723120200_subjects_prerequisites_offerings.sql` | Subjects, prerequisites, offerings + bulk RPC |
| `20260723120300_teaching_assignments.sql` | Teaching assignments + assign/end RPCs |
| `20260723120400_grading_assessment_weights_workflow.sql` | Grading, assessment types, weights, workflow dates + RPCs |

Apply in the Supabase SQL Editor (staging first) in filename order. Do not skip.

---

## Tables

- `academic_event_audits`, `academic_capabilities`, `academic_settings`
- `subjects`, `subject_prerequisites`, `subject_offerings`
- `teaching_assignments`
- `grading_schemes`, `grading_scheme_bands`
- `assessment_types`, `assessment_weight_schemes`, `assessment_weight_items`
- `academic_workflow_periods`
- `classes.stream_code` (new column)

---

## Key RPCs

- `create_class`, `update_class`
- `upsert_subject`, `set_subject_active`, `add_subject_prerequisite`
- `bulk_set_grade_subject_offerings`
- `assign_subject_teacher`, `end_teaching_assignment`
- `save_grading_scheme`, `seed_default_assessment_types`, `save_weight_scheme`
- `upsert_workflow_period`
- `log_academic_event`, `has_academic_capability`, `require_academic_capability`

---

## Capabilities (defaults)

| Role | Access |
|---|---|
| Administrator | All academic capabilities |
| Headteacher | View + manage config (subjects, offerings, assignments, grading, weights, calendar) |
| Teacher / secretary / bursar | Configuration view only |
| Optional rows in `academic_capabilities` | Future fine-grained grants |

Future-ready capability names (not UI-enabled yet): `MARKS_ENTER`, `MARKS_SUBMIT`, `MARKS_MODERATE`, `RESULTS_APPROVE`, `RESULTS_PUBLISH`, `RESULTS_UNLOCK`, `REPORT_CARDS_GENERATE`.

---

## UI routes

| Route | Purpose |
|---|---|
| `/dashboard/settings/academics` | Guided checklist hub |
| `…/classes` | Classes and streams |
| `…/subjects` | Subject catalogue |
| `…/subjects-by-grade` | Bulk grade subject assignment |
| `…/teacher-assignments` | Assign / end teachers |
| `…/grading-scale` | Confirm grading scale |
| `…/assessment-types` | Seed/list assessment types |
| `…/assessment-weights` | Weight template (must total 100%) |
| `…/academic-dates` | Optional workflow dates |

Settings home also links to **Academic setup**.

---

## Default grading scale (recommended, editable)

- 80–100 Distinction  
- 70–79.99 Merit  
- 60–69.99 Credit  
- 50–59.99 Pass  
- 0–49.99 Fail  

UI requires explicit **Confirm grading scale** for checklist completion.

## Default weight template (recommended, editable)

- Assignments 10%  
- Tests 20%  
- Mid-Term Examination 30%  
- End-of-Term Examination 40%  

Must total exactly 100% to save.

---

## Tests

- `src/features/academics/schemas.test.ts` — subject validation, band overlap, weight totals, capability defaults  
- Repository verification (this phase):
  - `npm test` — **114** passed  
  - `npm run lint` — 0 errors  
  - `npm run build` — pass (academic setup routes present)  
  - `npm run cf:build` — pass  

## Manual verification

**Status:** Pending until the five Phase 2A migrations are applied to staging Supabase and exercised in the Academic Setup UI.

Suggested controlled checks (no marks):

1. Create Grade 7A and Grade 7B  
2. Add Mathematics / English  
3. Assign both to Grade 7  
4. Assign a teacher to Grade 7 Mathematics  
5. Confirm grading scale  
6. Seed assessment types; confirm weights at 100%  
7. Reject weights at 90% and overlapping bands  
8. Confirm audit rows for administrators/headteachers  
9. Remove temporary verification records where safe  

---

## Known limitations

- Prerequisites UI is data-model ready (`add_subject_prerequisite` RPC) but not exposed as a primary screen (advanced later).
- Class-specific / term-specific offerings are schema-ready; guided UI focuses on grade-wide year-long offerings.
- Database RLS SELECT requires `ACADEMIC_CONFIGURATION_VIEW`; teachers can view but not write.
- Generated Supabase TypeScript types are not regenerated in this phase (RPC calls remain loosely typed).
- Migrations are not auto-applied by the Next.js deploy.

---

## Deployment requirements

1. Apply the five Phase 2A migrations to the target Supabase project (staging first).  
2. Deploy the application build that includes `/dashboard/settings/academics`.  
3. Sign in as Administrator → Settings → Academic setup → complete checklist.  
4. Do not enable marks entry until Phase 2C.

---

## Next phase recommendation

**Phase 2B — Assessment & examination setup** (assessment instances, sessions, schedules), then **Phase 2C — Teacher gradebook** for marks entry.

Do not start marks entry until Academic Setup checklist items for subjects, teachers, grading scale, and weights are confirmed for the live school year.
