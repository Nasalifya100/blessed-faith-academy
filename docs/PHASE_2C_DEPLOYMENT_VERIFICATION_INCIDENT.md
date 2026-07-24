# Phase 2C — Deployment Verification Incident

**Date:** 2026-07-24  
**Commit that applied migrations:** `9fd187d0425c8e347e89ec50683d9413ec12c1c9`  
**Failed deploy run:** [30111680970](https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30111680970)  
**Successful CI run:** [30111681095](https://github.com/Nasalifya100/blessed-faith-academy/actions/runs/30111681095)

---

## What happened

1. Phase 2C Stage 1/2 was pushed to `master`.
2. Migration reconciliation detected exactly three pending migrations and applied them successfully:
   - `20260724140000_exam_gradebook_enums_and_tables.sql`
   - `20260724140100_exam_gradebook_capabilities.sql`
   - `20260724140200_exam_gradebook_rpcs.sql`
3. Phase 2C structural verification failed.
4. Cloudflare Worker upload/promote was **skipped** (gate held).
5. The live Worker remained on the previous version. Additive DB objects were present; **no data loss**.

---

## Root cause

`scripts/phase2c-stage1-verify.cjs` probed RPCs with:

```js
admin.rpc(functionName, {})
```

PostgREST responded with errors such as:

> Could not find the function public.open_or_get_exam_gradebook without parameters in the schema cache

That message means **no zero-argument overload**, not that the parameterized function is missing. Tables were already readable (`exam_gradebooks`, `exam_assessment_results`).

Internal helpers revoked from `anon`/`authenticated` were also probed the same way and incorrectly reported as “missing.”

---

## What was not done

- No migration repair  
- No `db reset`  
- No edit of applied migrations  
- No manual `db push` outside CI  
- No Wrangler / force promote  

---

## Fix

Code-only hotfix to the verifier:

- Classify PostgREST errors explicitly (arity mismatch vs true absence vs auth/business vs transient).
- Probe public RPCs with correctly named synthetic arguments.
- Verify helpers via static migration contracts + privilege denial; do not treat intentional API hiding as absence.
- Keep the Phase 2C deploy gate in place.
- **No new migrations.**

---

## Expected recovery deploy

Next push to `master` should see **zero** pending migrations, pass corrected Phase 2C verification, then build and promote the Worker.
