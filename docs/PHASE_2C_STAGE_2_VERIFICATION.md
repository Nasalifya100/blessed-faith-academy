# Phase 2C Stage 2 — Verification Notes

**Date:** 2026-07-24  
**Scope:** Teacher gradebook UI + server actions on Stage 1 RPCs  
**Migrations:** Still **not** applied / committed / pushed in this stage  

---

| RPC | Params | Notes |
|---|---|---|
| `open_or_get_exam_gradebook` | `p_exam_id`, `p_class_id` | May create DRAFT |
| `get_exam_gradebook` | `p_gradebook_id` | Read-by-ID; never creates |
| `save_exam_gradebook_draft` | `p_gradebook_id`, `p_expected_revision`, `p_rows` | Partial upsert |
| `submit_exam_gradebook` | `p_gradebook_id`, `p_expected_revision` | Full roster |
| `reopen_exam_gradebook` | `p_gradebook_id`, `p_reason`, `p_expected_revision` | SUBMITTED only |
| `lock_exam_gradebook` | `p_gradebook_id`, `p_expected_revision` | SUBMITTED only |

Offline structure check (no DB):

```bash
node scripts/phase2c-stage1-verify.cjs --offline
```

Post-migration structure (staging CI):

```bash
node scripts/phase2c-stage1-verify.cjs
```

---

## Routes

| Route | Purpose |
|---|---|
| `/dashboard/gradebook` | Hub (filters, sections, open/continue) |
| `/dashboard/gradebook/[gradebookId]` | Marks entry / read-only submitted-locked |
| `/dashboard/gradebook/[gradebookId]/preview` | Submission review + confirm |

Nav: **Gradebook** via `canOpenGradebook` (teacher enter / head+admin view-all). Secretary/bursar hidden by default.

---

## Component / server architecture

- `src/features/gradebook/actions.ts` — server actions + Zod + error normalization  
- `src/features/gradebook/queries.ts` — hub listing + workspace load  
- `src/features/gradebook/entry-logic.ts` — mark/status rules, summary, review gate  
- `src/features/gradebook/local-recovery.ts` — localStorage draft recovery  
- `src/features/gradebook/mappers.ts` / `errors.ts` — RPC mapping / safe messages  
- Components under `src/features/gradebook/components/*`  

---

## Behaviours

| Topic | Behaviour |
|---|---|
| Save semantics | Partial upsert; must Save Draft before Review |
| Revision conflict | Distinct UX; reload server; no force-save; local recovery retained until user decides |
| Roster drift | Submit errors return user to entry; refresh authoritative roster |
| Local recovery | Keyed by **userId + gradebookId + revision**; prompt restore/discard; stale revision defaults to server |
| Reopen / lock | Capability-gated; SUBMITTED only; both send `expected_revision`; LOCKED has no reopen |

---

## Tests

`src/features/gradebook/stage2.test.ts` (+ Stage 1 permission tests): nav visibility, entry rules, summary, recovery, mappers, error normalization, submit copy.

**No** live DB RPC matrix until migrations are applied on a safe environment.

---

## Manual mobile checklist

- [ ] 320 / 360 / 390 / 430px: student cards usable, mark inputs ≥ 44px  
- [ ] Sticky footer does not cover last row; safe-area clearance  
- [ ] Bulk actions reachable  
- [ ] Reopen/lock dialogs fit small screens  
- [ ] Preview summary readable  

---

## Post-migration E2E (controlled staging)

1. Apply three Stage 1 migrations via CI or staging push (not from agent).  
2. Structure probe: `node scripts/phase2c-stage1-verify.cjs`  
3. Teacher: open assigned COMPLETED exam → save → review → submit  
4. Unassigned teacher denied  
5. Head: reopen + lock  
6. Direct DML still denied  

---

## Deferred (later stages)

- Admin completion monitor route (`/dashboard/gradebook/admin`)  
- Spreadsheet paste/import  
- Correction RPC/UI  
- Continuous assessment without exam rows  
- Report cards / parent results / analytics / publish  
