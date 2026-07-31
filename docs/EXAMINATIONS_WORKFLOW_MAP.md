# Examinations Workflow Map

Staff-facing progress model (UI only — does not replace DB enums):

**SETUP → MARKS ENTRY → SUBMITTED → LOCKED → RESULTS READY → REPORT CARDS → PUBLISHED**

Command Centre progress lanes:

| Lane | Typical technical inputs | Staff states |
|---|---|---|
| Setup | year/term/period/exams | Not started / In progress / Ready / Complete / Blocked |
| Marks entry | gradebook DRAFT/REOPENED/not started | In progress / Needs attention / Complete |
| Submission and locking | SUBMITTED / LOCKED / REOPENED | Ready / Complete / Needs attention |
| Results | term snapshots + stale flags | Ready / Complete / Needs attention |
| Report cards | report_card_status counts | Ready / In progress / Blocked / Complete |
| Publication | PUBLISHED / APPROVED | Ready / Complete |

## Results readiness (presentation only)

Checks include year/term/period/exams completed, no draft/reopened gradebooks, submitted/locked sources present, optional school-wide not-started, no stale results.

**Scoring:** applicable checks (excluding N/A) contribute equal weight; percent = round(100 × passed/applicable). **Ready only when blocking fails = 0.** A high percent never enables Calculate.

## Report card readiness (presentation only)

Checks include current results, not stale, drafts present, approval/publish progress where capability allows.

**Ready only when blocking fails = 0.** Generate/approve/publish still use existing server validators.

## Authority and data flow

```text
Settings/Academics
  years, terms, classes, subjects, offerings,
  teaching assignments, assessment types,
  weight schemes, grading bands, marks-entry windows
        │
        ▼
Examinations setup
  exam_periods → exams (max_marks) → schedules/rooms
  exclusions (medical/transferred/absent/other)
        │
        ▼
Gradebook (marks authority)
  exam_gradebooks + exam_assessment_results
  statuses: DRAFT | REOPENED | SUBMITTED | LOCKED
  entry_status: SCORED | ABSENT | EXEMPT | NOT_ASSESSED
  blank (unsaved) ≠ zero
        │
        ▼
Results engine (only calculation authority)
  submitted/locked gradebooks → snapshots
  grades, rankings, promotion recommendations
  stale detection via revision / fingerprint
        │
        ▼
Report cards
  consume term/subject/exam snapshots only
  remarks → review → approve → publish → print
  immutable render payload on approve/publish
```

## Journey step inventory

| # | Step | Classification | Notes |
|---|---|---|---|
| 1 | Configure academic year | Fully supported | Settings current period |
| 2 | Configure terms | Fully supported | |
| 3 | Configure classes/subjects | Fully supported | Academics settings |
| 4 | Assign subjects to classes | Fully supported | Offerings / subjects-by-grade |
| 5 | Assign teachers | Fully supported | Teaching assignments |
| 6 | Create examination | Fully supported | Exam period + exams |
| 7 | Define assessments/components | Partially supported | Assessment types + one exam per type/sitting; multi-component weights via schemes |
| 8 | Set max marks / weights | Fully supported | Exam max_marks; weight schemes in settings |
| 9 | Confirm eligible classes/students | Fully supported | Eligible roster RPC + exclusions |
| 10 | Open marks entry | Fully supported | Requires exam COMPLETED + window |
| 11 | Teacher enters marks | Fully supported | Assignment-scoped |
| 12 | Save drafts | Fully supported | Revision-aware |
| 13 | Detect missing marks | Fully supported | Hub + workspace summary |
| 14 | Absent / exempt / transferred | Fully supported / Partially | Mark statuses + exam exclusions; medical = exclusion, not separate mark enum |
| 15 | Validate marks | Fully supported | Client + RPC |
| 16 | Submit gradebook | Fully supported | Incomplete blocked |
| 17 | Lock / reopen | Fully supported | Reason required on reopen |
| 18 | Calculate results | Fully supported | Admin/head recalculate |
| 19 | Review grades/rankings | Fully supported | Results dashboard |
| 20 | Comments / remarks | Fully supported | Report cards |
| 21 | Generate report cards | Fully supported | From snapshots |
| 22 | Review / approve | Fully supported | |
| 23 | Publish | Fully supported | |
| 24 | Print individual / bulk | Fully supported | |
| 25 | Correct mistakes safely | Fully supported | Reopen + recalc + regenerate |
| 26 | Preserve audit history | Fully supported | Academic event audits |

## Lifecycle mapping

| Domain | Technical states | Staff progress |
|---|---|---|
| Exam period | DRAFT / OPEN / CLOSED / ARCHIVED | Setup |
| Exam | DRAFT → SCHEDULED → READY → COMPLETED → ARCHIVED | Setup → Marks entry gate |
| Gradebook | READY* / DRAFT / REOPENED / SUBMITTED / LOCKED | Marks → Submitted → Locked |
| Results | Fresh / Stale (no separate status enum) | Results ready |
| Report card | DRAFT → REVIEWED → APPROVED → PUBLISHED / UNPUBLISHED / VOIDED | Report cards → Published |

\*READY is synthetic in the gradebook hub (completed exam, no row yet).

## Special learner status

| Case | Representation |
|---|---|
| Blank mark | UI-only missing; not coerced to zero |
| Zero | Explicit SCORED 0 |
| Absent | `ABSENT` |
| Exempt / not assessed | `EXEMPT` / `NOT_ASSESSED` |
| Medically absent | Exam exclusion `MEDICAL` (eligibility), not a mark enum — **acceptable design / Medium limitation** |
| Transferred | Exclusion + roster eligibility |
| Archived / withdrawn | Outside eligible roster |
| Subject not taken | No gradebook / exclusion |
| Repeating student | Deferred policy nuance (promotion recommendation only) |
