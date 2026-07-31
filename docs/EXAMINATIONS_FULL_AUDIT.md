# Examinations Full Audit

**Repository:** Blessed Faith Academy SMS
**Audit date:** 2026-07-24
**Scope:** Functional, security, data-integrity, and UX audit of the examinations pipeline (setup → marks → results → report cards).
**Boundary:** Local inspection and fixes only. No commit, push, deploy, or migration apply.

## Verdict summary

The examinations pipeline is **structurally complete** across Phases 2A–2G. Core authority boundaries are sound. The largest gaps were **staff discoverability**, **stale phase-era copy**, and **disconnected navigation** — not a missing results engine.

**Release recommendation:** Ready for final commit review after Command Centre addition; deploy only after operator authenticated smoke. See `EXAMINATIONS_RELEASE_READINESS.md`.

## Command Centre

`/dashboard/examinations` is an Examination Command Centre: progress lanes, attention items, presentation-only results/report-card readiness, admin class progress, and teacher assigned work. It does **not** calculate marks, approve cards, or publish.

## Actual architecture

| Layer | Location |
|---|---|
| Exam periods / exams / schedules / rooms | `src/features/examinations/*`, `/dashboard/examinations/*` |
| Academic config (years, terms, classes, subjects, weights, grading) | `src/features/academics/*`, `/dashboard/settings/academics/*` |
| Marks / gradebooks | `src/features/gradebook/*`, `/dashboard/gradebook/*` |
| Results calculation | `src/features/results/*` (engine + `recalculateClassTermAction`) |
| Report cards | `src/features/report-cards/*` (consumes snapshots only) |
| Ops hardening | Phase 2G libs/scripts |

## Authority map

| Data | Authority | Must not |
|---|---|---|
| Academic years / terms | `academic_years` / `terms` + current-period RPCs | Be redefined in examinations UI |
| Classes / subjects / offerings / teaching assignments | Academics tables | Be invented at marks entry |
| Exam periods / exams / max marks / schedules | Examinations tables + setup RPCs | Be mutated by results UI |
| Assessment types / weight schemes / grading bands | Academics settings | Be overridden by browser totals |
| Marks | `exam_gradebooks` + `exam_assessment_results` via gradebook RPCs | Be recalculated by report cards |
| Results | Result snapshot tables via results engine + replace RPC | Accept browser-supplied totals |
| Report cards | `student_report_cards` + immutable render payload | Recalculate marks |

## End-to-end journey coverage

See `EXAMINATIONS_WORKFLOW_MAP.md` for step-by-step classification.

Highlights:

- **Fully supported:** year/term/class/subject setup; exam period/exam lifecycle; marks entry with blank≠zero; submit/reopen/lock; results recalculation; report-card generate/review/approve/publish/print.
- **Supported but confusing (fixed locally where High):** overview copy claiming marks “come later”; period CLOSED labelled “Completed”; technical fingerprint/revision language; Phase 2D.x marketing copy in live UI; weak cross-links between Marks → Results → Report Cards.
- **Partially supported:** exam cancel (archive only); admin “exams with no gradebook yet” is exam-level estimate; secretary/bursar see schedules but not marks (by design).
- **Missing / deferred:** cancelled exam status; deactivate `is_active` UI; consolidated single “Examination Settings” page; medically absent as distinct mark status (medical is exclusion reason — **acceptable current design / Medium limitation**, not a High integrity defect without evidence of wrong calculated records); authenticated smoke automation.

## Security findings

| Severity | Finding | Status |
|---|---|---|
| — | RLS + capability gates remain on gradebook/results/report-card RPCs | Intact (not weakened) |
| Medium | Secretary/bursar have `EXAM_VIEW` (schedules/rooms) | Intentional; overview now clarifies no marks access |
| Low | Print document previously showed “source fingerprint” | Fixed — staff-friendly official-record footer |
| — | Direct URL / hidden-button auth still relies on server/RPC | Unchanged; still correct model |

No Blocker security bypass found in this audit pass.

## Data-integrity findings

| Severity | Finding | Status |
|---|---|---|
| — | Blank vs zero explicit in entry-logic + DB check | Intact |
| — | SCORED requires finite mark ≤ max | Intact |
| Medium | Overview “exams with no gradebook yet” is exam-level and admin/view-all only | Teachers no longer see or drive next actions from that count |
| — | Integrity verifier added (offline + optional online read-only) | `scripts/examinations-integrity-verify.cjs` |

## UX findings fixed locally

1. Role-aware Examinations Overview with next actions and progress stage.
2. Period CLOSED label → **Closed** (avoid collision with exam Completed).
3. Staff-facing error copy for stale results / revision conflicts.
4. Cross-links preserving year/term/class context (UUID-only params).
5. Report card status human labels; remove Phase 2D.x user-facing phrasing.
6. Period checklist no longer hardcodes unchecked “Print timetable”.
7. Teacher next actions no longer offer Calculate / Approve / Publish.
8. Teacher overview does not use unsafe exam-level not-started counts.

## Defects found and fixed

| ID | Severity | Fix |
|---|---|---|
| EX-UX-01 | High | Stale “marks entry comes later” + missing overview progress |
| EX-UX-02 | High | Confusing CLOSED→“Completed” period label |
| EX-UX-03 | High | Technical fingerprint/revision/Phase copy in staff UI |
| EX-UX-04 | Medium | Disconnected Marks/Results/Report Cards navigation |
| EX-UX-05 | Medium | Raw report-card status enums; checklist print lie |
| EX-UX-06 | High | Teachers offered Calculate / Approve next actions they cannot perform |
| EX-UX-07 | High | Exam-level “not started” undercounted other classes for teachers |
| EX-SEC-01 | Medium | Context link params UUID-only under `/dashboard` |

No Blocker data-corruption defect proven in static + unit coverage.

## Tests added

- `src/features/examinations/overview.test.ts` (role-aware actions, context-link safety, CLOSED label)
- Updated period label expectation in `schemas.test.ts`
- Integrity verifier offline assertions for CLOSED label, role-aware actions, online read-only self-check

## Authenticated smoke

**Pending — operator-owned.** No approved staff credentials used. Checklist refined in `EXAMINATIONS_ROLE_TEST_MATRIX.md`.

## Related docs

- `EXAMINATIONS_WORKFLOW_MAP.md`
- `EXAMINATIONS_UX_SIMPLIFICATION.md`
- `EXAMINATIONS_ROLE_TEST_MATRIX.md`
- `EXAMINATIONS_RELEASE_READINESS.md`
