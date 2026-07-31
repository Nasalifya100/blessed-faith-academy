# Examinations Role Test Matrix

## Capability expectations

| Action | Admin | Headteacher | Teacher | Secretary | Bursar |
|---|---|---|---|---|---|
| View exam schedules / periods | Yes | Yes | Yes | Yes | Yes |
| Manage exam setup | Yes | Yes | No | No | No |
| Enter assigned marks | Yes* | Yes* | Yes (assigned) | No | No |
| View all gradebooks | Yes | Yes | No | No | No |
| Reopen / lock gradebooks | Yes | Yes | No | No | No |
| View results | Yes | Yes | Yes (scoped) | No | No |
| Calculate results | Yes | Yes | No | No | No |
| Report cards remarks / print | Yes | Yes | Yes (scoped) | No | No |
| Approve / publish report cards | Yes | Yes | No | No | No |
| Report card settings | Yes | Yes | No | No | No |
| Overview Calculate next action | Yes | Yes | No | No | No |
| Overview Approve/Publish next action | Yes | Yes | No | No | No |

\*Admin/head may enter via gradebook capabilities where granted.

Authorization is enforced in UI gates **and** server actions / SECURITY DEFINER RPCs / RLS. Hidden buttons are not sufficient.

## Operator smoke checklist (authenticated — pending)

Do **not** mark passed until executed by an approved operator. Prefer a disposable class/exam fixture if available; otherwise use an inactive draft period and a non-published gradebook. **Do not** alter published report cards or live locked marks needed for current term reporting.

Expected environment: effective-production Worker URL is live — treat every write as real.

### Safe fixtures / rollback-free steps

- Prefer read-only checks first (overview, filters, direct-URL deny).
- If entering marks: use a clearly labelled test class/exam sitting, keep as DRAFT, do not submit unless a disposable sitting exists.
- If testing submit/reopen/lock/recalculate: use only an approved disposable academic sitting and document the IDs used.
- Never void or unpublish live published cards during smoke.

### Administrator / headteacher

| Step | Action | Expected |
|---|---|---|
| 1 | Open `/dashboard/examinations` Command Centre | Year/term/period, progress lanes, next action, attention items; no student names/marks |
| 1b | Confirm Results / Report Card readiness cards | Label + percent are guidance; blockers listed; Calculate still requires Results page |
| 2 | Confirm period CLOSED vs exam Completed wording | Period shows **Closed**; exams show **Completed** when applicable |
| 3 | Open period Setup → Schedule | Checklist accurate; print link present; status controls permission-gated |
| 4 | Marks with year/term filters preserved | Hub opens with context; open gradebook; blank ≠ zero; save draft |
| 5 | Submit / reopen(reason) / lock (disposable only) | Status transitions; audit retained |
| 6 | Results → Calculate (disposable only) | Grades/rankings appear; stale banner after reopen+recalc path |
| 7 | Report Cards deep-link from Results | Same year/term/class; generate → review → approve → publish → print |
| 8 | Direct URL as secretary/bursar for gradebook/results/report-cards | Redirect/deny |
| 9 | Overview never offers teacher-only limited wording for Calculate | Admin sees Calculate when readiness requires it |

### Teacher

| Step | Action | Expected |
|---|---|---|
| 1 | Overview | No Create period / Rooms / Bulk archive; no Calculate / Approve next actions |
| 2 | Marks progress | Shows accessible gradebooks only; guidance to use laptop/tablet for large grids |
| 3 | Grade link from Gradebook | Preserves year/term when UUIDs present; unauthorized classes remain denied by server |
| 4 | Marks entry | Blank missing; `0` scored; ABSENT/EXEMPT/NOT_ASSESSED explicit; save; revision conflict message asks to refresh |
| 5 | Results / Report cards | View scoped; remarks/print if granted; cannot recalculate/approve/publish |

### Secretary

| Step | Action | Expected |
|---|---|---|
| 1 | Examinations | Schedules/upcoming visible if EXAM_VIEW remains intended |
| 2 | Overview | Explains no marks/results/report-card access; no restricted gradebook counts |
| 3 | Direct `/dashboard/gradebook`, `/dashboard/results`, `/dashboard/report-cards` | Denied |

### Bursar

| Step | Action | Expected |
|---|---|---|
| 1 | Same as secretary for academic authority | Denied marks/results/report cards |
| 2 | Overview | No restricted academic progress counts for gradebooks/results/report cards |

## Authenticated execution status

**PENDING** — not executed in this pre-commit review. Do not fabricate a pass.
