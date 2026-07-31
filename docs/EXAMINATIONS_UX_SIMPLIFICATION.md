# Examinations UX Simplification

## Problem

Staff faced disconnected nav entries (Examinations, Gradebook, Results, Report Cards, Academic Settings) with phase-era language (“Phase 2D.2”, “fingerprint”, “revision conflict”) and an overview that still said marks entry “comes later”.

## Preferred workspace (implemented via Command Centre)

`/dashboard/examinations` is the **Examination Command Centre**:

| Section | Behaviour |
|---|---|
| Context | Active year/term/period, exam completion counts, workflow stage |
| Recommended next action | Role-aware primary + secondary actions |
| Examination progress | Six staff-facing lanes mapped from existing DB states |
| Needs attention | Blocking / needs attention / information items with safe links |
| Results / report-card readiness | Presentation-only scores + blockers (never action authority) |
| Class progress | Admin/head bounded class table (no student names/marks) |
| Teacher work | Assignment-scoped gradebooks only |
| Setup periods list | Existing period list + schedule links |

Readiness percentages are **guidance only**. Server actions and RPCs remain the workflow gates.

## Terminology changes

| Before | After |
|---|---|
| Marks entry comes later | Full workspace description |
| Period status “Completed” (CLOSED) | “Closed” |
| Revision conflict | Updated elsewhere — refresh |
| Source fingerprint (print footer) | Official calculated record |
| Recalculate authoritative snapshots | Calculate / recalculate class results |
| Phase 2D.x copy in UI | School-facing language |
| Raw `DRAFT` / `PUBLISHED` | Draft / Published labels |

Internal logs, audits, and DB columns still use technical names.

## Shared context

`src/features/examinations/context-links.ts` builds URL query strings for year/term/class. Context is not stored only in localStorage.

## Deferred (documented, not redesigned)

- Single merged “Examination Settings” page replacing all academics subpages
- Status filter chips on examinations home (periods list still unfiltered beyond hiding archived)
- Cancelled exam status
- Dense mobile marks grid (tablet/laptop remains primary entry surface)
- Auto-complete print checklist from print events
