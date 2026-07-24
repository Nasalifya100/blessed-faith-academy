# Phase 2C — Integrated Pre-Deployment Review

**Date:** 2026-07-24 (updated after verification hotfix)
**Repository:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`  
**Status:** Stage 1/2 shipped on `master` (`9fd187d`). Migrations applied. Worker promotion was blocked by a verifier false positive; corrected by a **code-only** verifier hotfix (no migrations).

---

## Exact final RPC contracts

| RPC | Params | Returns (jsonb keys) |
|---|---|---|
| `open_or_get_exam_gradebook` | `p_exam_id uuid`, `p_class_id uuid` | `gradebook`, `exam`, `roster`, `results`, `can_edit` |
| `get_exam_gradebook` | `p_gradebook_id uuid` | Same shape; **never creates**; forbidden/missing → “Gradebook not found.” |
| `save_exam_gradebook_draft` | `p_gradebook_id`, `p_expected_revision`, `p_rows` | `gradebook_id`, `revision`, `saved_count`, `status` |
| `submit_exam_gradebook` | `p_gradebook_id`, `p_expected_revision` | `gradebook_id`, `status`, `revision`, `submitted_at`, `roster_count`, `pruned_ineligible_count` |
| `reopen_exam_gradebook` | `p_gradebook_id`, `p_reason`, **`p_expected_revision`** | `gradebook_id`, `status`, `revision`, `reopened_at` |
| `lock_exam_gradebook` | `p_gradebook_id`, **`p_expected_revision`** | `gradebook_id`, `status`, `revision`, `locked_at` |

Enums: `DRAFT|SUBMITTED|REOPENED|LOCKED`; results `SCORED|ABSENT|EXEMPT|NOT_ASSESSED` (uppercase).

Save `p_rows`: array of `{ student_id, entry_status, marks_obtained?, comment? }` — **partial upsert**.

---

## Read-by-ID architecture

`/dashboard/gradebook/[gradebookId]` calls **`get_exam_gradebook`** (SECURITY DEFINER, `can_read_exam_gradebook`, fixed `search_path`).  
Does **not** use `open_or_get` (which can create). Direct table select is no longer used for bootstrap.

Hub listing still uses RLS-scoped selects for cards (no marks). Opening creates only via `open_or_get` from the hub button.

---

## Save payload semantics

Partial upsert of completed valid rows only. Omitted eligible students unchanged. Ineligible rows pruned on save/submit. Client never sends max marks, actor IDs, or status transitions.

---

## Reopen / lock concurrency

Both require `p_expected_revision` after `FOR UPDATE`. Stale admin pages cannot reopen/lock an unexpected revision. LOCKED remains terminal (no reopen).

---

## Local recovery privacy

Key: `bfa:gradebook-draft:u{userId}:g{gradebookId}:r{revision}`  
Stores: userId, gradebookId, revision, timestamp, student_id + status + marks_text only.  
No names/admission numbers. Shared-device residual risk if the same user account is used; different users are isolated.

---

## Server-side authorization

Pages: `canOpenGradebook` + RPC/`get_exam_gradebook`.  
Actions: capability gates + Zod + RPC. Secretary/bursar: no default nav or marks access.

---

## CI structural verification

After migrations, deploy workflow runs:

1. `node scripts/phase2b-staging-verify.cjs all`  
2. `node scripts/phase2c-stage1-verify.cjs` (tiers 1–2; no fixtures)

Offline review mode: `node scripts/phase2c-stage1-verify.cjs --offline`

### Verifier rules (post-hotfix)

- **Do not** probe parameterized RPCs with `{}`. Empty-argument “without parameters” errors are arity mismatches, not proof of absence.
- Public RPCs: correctly named synthetic-UUID probes; PASS on auth/business errors; FAIL on true signature absence or transient schema-cache errors.
- Internal helpers: static migration contracts + anon privilege denial; never report revoked helpers as “missing” solely because PostgREST hides them.
- **No migrations** are required for the verifier hotfix.

See `docs/PHASE_2C_DEPLOYMENT_VERIFICATION_INCIDENT.md`.

---

## Tests run

Unit/static: gradebook permissions, stage2 entry/recovery/mappers/contracts, verifier classification, lint, tsc, build.
Live DB E2E remains optional via fixtures.

---

## Manual post-deployment smoke plan

See final report section below (17 steps).

---

## Rollback considerations

| Scenario | Action |
|---|---|
| Migration fails before Worker promote | Fix SQL; no app promote (pipeline blocks) |
| Deploy fails after migration applied | DB already has tables; fix Worker build / verifier; do **not** repair/reset |
| UI defect after deploy | Hotfix UI only; DB stays |
| Destructive SQL defect after apply | Stop traffic; restore from backup / forward-fix migration — **no db reset** |

---

## Known limitations

- Roster eligibility is **current** enrolment, not as-of exam date  
- No correction RPC  
- No spreadsheet import  
- Shared browser: same staff account can see own local drafts across sessions  
- `GRADEBOOK_CORRECT` unused until a secure correction RPC exists  
