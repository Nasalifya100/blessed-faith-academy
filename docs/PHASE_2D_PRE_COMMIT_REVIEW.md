# Phase 2D.1 — Pre-Commit Architecture Review

**Date:** 2026-07-24
**Repository:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`
**Scope:** Academic Results Engine (calculation + snapshots + Results UI)
**Constraint:** No commit, push, migration apply, or deploy performed by this review.

---

## Authoritative data flow

```
SUBMITTED / LOCKED exam_gradebooks
  → exam_assessment_results (marks authority)
  → active default grading_schemes + bands
  → assessment_weight_schemes (optional; renormalize when incomplete)
  → academic_results_settings + promotion_policies
  → server-side TypeScript engine (src/features/results/engine/*)
  → replace_class_term_result_snapshots (SECURITY DEFINER)
       · advisory lock on school×year×term×class
       · re-validate every source mark / revision / scope
       · recompute/verify SCORED percentage from DB marks
       · verify grade_code against scheme bands
       · school-scope FK checks
       · atomic delete + insert of snapshot set
  → Results dashboards (read snapshots only)
```

Client browsers never supply authoritative totals/ranks/grades without server + RPC validation. The UI renders persisted snapshots only.

---

## Source eligibility

| Source state | Included? |
|---|---|
| SUBMITTED gradebook | Yes |
| LOCKED gradebook | Yes |
| DRAFT / REOPENED | No |
| Inactive exam | No |
| Wrong year/term/class | No |
| Missing assessment_type_id | Fail closed (action error) |

### Result entry status effects

| Status | Subject % | Totals / average | Pass/fail | Ranking | Promotion | Stats |
|---|---|---|---|---|---|---|
| SCORED | From marks÷max | Included | From band | Eligible | Uses averages / pass counts | Included |
| ABSENT (default) | null | Omitted | null | Unranked | Incomplete subjects | Omitted |
| ABSENT + treat_absent_as_zero | scheme min | Included as min | From band | Eligible | Included | Included |
| EXEMPT | null (never invented) | Omitted | null | Unranked | Incomplete | Omitted |
| NOT_ASSESSED | null (never invented) | Omitted | null | Unranked | Incomplete | Omitted |
| Zero marks (SCORED) | 0 | Included | Fail band if configured | Eligible | Included | Included |

`include_exempt_in_average` / `include_not_assessed_in_average` are reserved flags and do not invent numeric marks.

---

## Grading scheme precedence

Fail closed: only the **active school-default** grading scheme (`is_active`, `is_default`, not archived) is used in Phase 2D.1. No “first active row wins.” Missing default → recalculation refused.

### Rounding policy

1. Raw percentage = clamp(schemeMin + (marks/max)×(schemeMax−schemeMin)).
2. Round with scheme `decimal_places` + `rounding_mode` (`half_up` default; also `half_even`, `floor`, `ceil`).
3. Band lookup uses the **rounded** percentage.
4. Stored display percentage is that same rounded value.
5. Non-finite inputs throw (do not coerce to 0).

---

## Weighting policy

- Weights from active default `assessment_weight_schemes` when present.
- Duplicate `assessment_type_id` for one student×subject → hard error.
- Missing component types are omitted (not zero-filled).
- Weights are **renormalized** over countable present components (documented interim behaviour).
- No continuous-assessment invention in 2D.1.
- Equal-weight average when no weight scheme is configured.

---

## Ranking semantics

| Mode | Example 100, 90, 90, 80 |
|---|---|
| COMPETITION | 1, 2, 2, 4 |
| DENSE | 1, 2, 2, 3 |
| AVERAGE | 1, 2.5, 2.5, 4 |
| DISABLED | null |

Equal academic scores remain tied. Secondary id sort is iteration-stable only; it does not break ties. Null / non-countable scores are unranked. Zero is a valid ranked score.

---

## Promotion conflict resolution

- Rules sorted by ascending `priority` (lower first).
- First matching rule wins.
- `GRADUATED` only when `is_terminal_grade === true` (Phase 2D.1 always passes `false` until grade_levels gains a terminal flag).
- Outcomes are **recommendations only** — no enrolment mutation.
- Empty rules → `UNDECIDED`.

---

## Snapshot uniqueness

| Table | Unique key |
|---|---|
| `student_exam_result_snapshots` | `(school, year, term, class, exam, student)` |
| `student_subject_result_snapshots` | `(school, year, term, class, subject, student)` |
| `student_term_result_snapshots` | `(school, year, term, class, student)` |
| `result_statistic_snapshots` | Partial: CLASS_TERM by class; CLASS_SUBJECT_TERM by class+subject |
| `academic_results_settings` | PK `school_id` |
| `promotion_policies` | Partial one active default per school |

Class-scoped exam uniqueness permits mid-year transfers without colliding with prior class rows.

---

## Historical stability and provenance

Snapshots store:

- `gradebook_id` + `gradebook_revision`
- `grading_scheme_id` + `grading_scheme_version` + **immutable** `grading_scheme_snapshot` JSON
- `weight_scheme_id` + **immutable** `weight_scheme_snapshot` JSON
- `engine_version` (`RESULTS_ENGINE_VERSION` = `2d.1.1`)
- `source_fingerprint` (SHA-256 over engine version, scheme id@version, sorted mark rows)
- `computation_batch_id`, `computed_at`, `computed_by`

Live scheme edits do not rewrite historical snapshot interpretation for already-stored rows.

---

## Recalculation concurrency and staleness

- `pg_advisory_xact_lock` serializes concurrent replace for the same school×year×term×class.
- Gradebook revision mismatch aborts replace.
- UI stale detection (read-time):
  - stored `is_stale` flag, or
  - live gradebook revision/status drift vs exam snapshots, or
  - engine version ≠ current `RESULTS_ENGINE_VERSION`
- Manual recalculation remains the workflow (no auto hooks in 2D.1).

---

## RPC and server-action security

### `replace_class_term_result_snapshots`

- `auth.uid()` required
- `RESULTS_RECALCULATE` capability
- fixed `search_path = public`
- advisory lock
- validates year/term/class school scope
- validates every exam row against SUBMITTED/LOCKED gradebook + exact marks/status/max/revision
- recomputes SCORED percentage; rejects client drift
- verifies grade codes against bands
- school-scopes scheme / weight / assessment_type / promotion_policy FKs
- subject/term rows must be backed by validated exam rows
- audit without full marks payloads
- revoke from PUBLIC; grant execute to authenticated

Trust model: TS engine computes derived fields; RPC independently validates source marks and numeric/grade invariants. Still not a full SQL reimplementation of weighting/ranking (documented residual risk for RESULTS_RECALCULATE holders forging aggregates while keeping source marks consistent).

### `recalculateClassTermAction`

- Session auth + role capability checks
- Zod-validated IDs only (no client-calculated snapshots accepted as input)
- Loads marks from DB
- Passes engine_version + fingerprint into RPC

### `ensure_academic_results_settings`

- VIEW may read existing settings
- INSERT of defaults requires RESULTS_RECALCULATE

---

## Permissions and data exposure

| Role | Default |
|---|---|
| Teacher | RESULTS_VIEW (assignment-scoped via RLS helpers; term-aware offerings) |
| Head | VIEW + VIEW_ALL + RECALCULATE + PROMOTION_POLICIES_MANAGE |
| Admin | all results capabilities |
| Secretary / Bursar | no results caps |

Term standings are visible to any teacher assigned to the class (class-level). Exam/subject snapshots remain subject-scoped. Direct table DML revoked; SELECT via RLS only.

---

## Roster-history limitation

Gradebook and results eligibility follow **current active enrolment / teaching assignments**, not as-of-exam-date historical membership. Phase 2D.1 preserves source gradebook roster rows in snapshots but does not claim historically exact class membership for mid-term transfers beyond class-scoped uniqueness.

---

## Deferred (Phase 2D.2+)

- Report cards / PDF / publishing
- Parent/student portals
- Auto recalculation hooks
- Promotion policy management UI / write RPCs
- Terminal-grade flag on `grade_levels`
- Full SQL recompute of subject/term aggregates
- Continuous assessment without exams

---

## Post-migration smoke plan

1. Apply the three Phase 2D.1 migrations.
2. `node scripts/phase2d-stage1-verify.cjs` (online) and offline already green.
3. As admin: open `/dashboard/results`, select class/term, Recalculate.
4. Confirm term standings, subject table, statistics share one batch id.
5. Reopen a feeding gradebook → stale banner appears.
6. As teacher: see assigned class/subject only; no Recalculate.
7. As secretary: Results nav absent; direct URL redirects.
8. Confirm audit event `RESULTS_CLASS_TERM_RECALCULATED` without marks arrays.
