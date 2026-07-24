# Phase 2D — Academic Results Engine Plan

**System:** Blessed Faith Academy School Management System
**Repository:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`
**Depends on:** Phase 2C Teacher Gradebook (deployed)
**Status:** Phase 2D.1 Stage 1 released via automated staging pipeline
**Date:** 2026-07-24
**Related:** [PHASE_2D_PRE_COMMIT_REVIEW.md](./PHASE_2D_PRE_COMMIT_REVIEW.md)

---

## Goal

Create the **authoritative academic results engine** that every future module consumes:

- Report cards (2D.2)
- Parent / student portals
- Analytics
- Promotion workflows
- Transcripts / merit lists / awards

Nothing else should invent independent grade math.

---

## Architecture

```
SUBMITTED/LOCKED exam_assessment_results
        │
        ▼
 TypeScript Results Engine (calculation authority)
   · percentage · band lookup · weighting · ranking
   · statistics · promotion recommendations · remarks
        │
        ▼
 replace_class_term_result_snapshots (SECURITY DEFINER)
   · advisory lock · source-mark revalidation
   · percentage/grade invariant checks · school FK checks
        │
        ▼
 Snapshot tables (persisted, historically stable)
   · student_exam_result_snapshots
   · student_subject_result_snapshots
   · student_term_result_snapshots
   · result_statistic_snapshots
        │
        ▼
 Results UI / future report cards / portals
```

**Does not duplicate marks.** Raw scores stay in the gradebook. Snapshots store derived values plus immutable scheme/weight JSON, gradebook revision, engine version, and source fingerprint.

---

## Calculation flow

1. Load SUBMITTED/LOCKED gradebooks for class × term (fail if assessment_type missing).
2. Resolve **active default** `grading_schemes` + bands (fail closed if absent).
3. Resolve `academic_results_settings` (ranking, absent-as-zero, …).
4. Resolve `promotion_policies` rules (or engine defaults).
5. Optionally apply `assessment_weight_schemes` (renormalize when components missing).
6. Run `recalculateClassTerm` (pure TS, engine version `2d.1.1`).
7. Persist via `replace_class_term_result_snapshots` with fingerprint + engine version.
8. Audit `RESULTS_CLASS_TERM_RECALCULATED` (counts/metadata only — no marks arrays).

---

## Grade calculation

- Percentage from `marks_obtained / max_marks_snapshot` onto scheme min–max.
- Rounding from scheme `decimal_places` + `rounding_mode` **before** band lookup.
- Letter / point / pass / remark from `grading_scheme_bands` only — **no hardcoded bands**.
- EXEMPT / NOT_ASSESSED never invent numeric percentages.
- ABSENT invents scheme minimum only when `treat_absent_as_zero` is true.

---

## Ranking

Configurable via `academic_results_settings.ranking_tie_mode`:

| Mode | Behaviour (100, 90, 90, 80) |
|---|---|
| COMPETITION | 1, 2, 2, 4 |
| DENSE | 1, 2, 2, 3 |
| AVERAGE | 1, 2.5, 2.5, 4 |
| DISABLED | positions null |

Ties are preserved; student name / admission number never break academic ties.

---

## Weighting

- Default weight scheme when configured; otherwise equal-weight average.
- Duplicate assessment types for one student×subject fail closed.
- Partial components renormalize over available countable weights.
- No continuous-assessment invention in Phase 2D.1.

---

## Promotion recommendations

Outcomes: `PROMOTED` | `CONDITIONAL` | `REPEAT` | `GRADUATED` | `UNDECIDED`

- First matching rule by ascending priority wins.
- `GRADUATED` requires explicit terminal-grade context (not enabled in 2D.1 UI/action yet).
- Never mutates enrolment or class placement.

---

## Permissions

| Capability | Teacher | Head | Admin | Secretary | Bursar |
|---|---|---|---|---|---|
| RESULTS_VIEW | ✓ | ✓ | ✓ | — | — |
| RESULTS_VIEW_ALL | — | ✓ | ✓ | — | — |
| RESULTS_RECALCULATE | — | ✓ | ✓ | — | — |
| PROMOTION_POLICIES_MANAGE | — | ✓ | ✓ | — | — |

RLS helpers `can_view_class_results` / `can_view_subject_results` are term-aware against subject offerings.

---

## Staleness

Results UI marks snapshots stale when:

- stored `is_stale` is true, or
- feeding gradebook revision/status drifted, or
- stored `engine_version` ≠ current engine constant

Recalculation remains manual.

---

## Migrations (unapplied until release)

1. `20260724150000_academic_results_enums_and_tables.sql`
2. `20260724150100_academic_results_capabilities.sql`
3. `20260724150200_academic_results_rpcs.sql`

Structural verifier: `node scripts/phase2d-stage1-verify.cjs --offline`

---

## Out of scope (2D.2+)

PDF report cards, publishing, portals, CA-without-exam, auto event hooks, house ranking, remark override UI, SQL-native full recompute of subject/term aggregates.
