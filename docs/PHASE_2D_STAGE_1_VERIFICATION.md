# Phase 2D.1 — Academic Results Engine Verification

**Date:** 2026-07-24
**Scope:** Calculation engine, snapshots, minimal Results UI
**Migrations (unapplied until release):**

1. `20260724150000_academic_results_enums_and_tables.sql`
2. `20260724150100_academic_results_capabilities.sql`
3. `20260724150200_academic_results_rpcs.sql`

**Production:** Released through automated staging deploy on `master`.
**Review record:** [PHASE_2D_PRE_COMMIT_REVIEW.md](./PHASE_2D_PRE_COMMIT_REVIEW.md)

---

## Architecture verified

- Engine lives in `src/features/results/engine/*` (pure, unit-tested).
- Persistence via `replace_class_term_result_snapshots` only (no direct DML grants).
- Gradebook `exam_assessment_results` remain the marks source of truth.
- Grading uses configured default `grading_schemes` / bands only (fail closed).
- Snapshots carry immutable scheme/weight JSON, gradebook revision, engine version, fingerprint.
- RPC re-validates source marks, recomputes SCORED percentage, checks grade bands, school-scopes FKs.
- Advisory lock prevents concurrent class×term replace races.
- Results UI reads snapshots; stale banner on revision/engine drift.

---

## Calculation / ranking / promotion / statistics

Covered by `src/features/results/engine.test.ts`:

- Rounding modes (`half_up`, `half_even`, floor/ceil) + non-finite rejection
- Band boundaries + adjacent-band gap policy + remarks
- ABSENT / EXEMPT / NOT_ASSESSED handling
- Competition / dense / average / disabled ranking + zero-score ties
- Median / mode / empty/single stats / pass rate / distribution
- Weight renormalization + duplicate assessment-type rejection
- Promotion priority, GRADUATED terminal gating, defaults
- Full `recalculateClassTerm` pipeline
- Role permissions for Results nav

---

## Structural verifier

```bash
node scripts/phase2d-stage1-verify.cjs --offline
```

Online mode (after migrations only):

```bash
node scripts/phase2d-stage1-verify.cjs
```

Does not use empty-argument PostgREST probes for parameterized RPCs.
Wired into `.github/workflows/deploy-staging.yml` Phase 4 (after migrations) alongside Phase 2C.

---

## Recalculation

`recalculateClassTermAction`:

1. Authz `RESULTS_RECALCULATE`
2. Load default scheme, settings, promotion rules
3. Load SUBMITTED/LOCKED gradebooks for class×term (with revision)
4. Fail if any exam lacks `assessment_type_id`
5. Run TS engine (`isTerminalGrade: false`)
6. Build source fingerprint + scheme/weight snapshots
7. Replace snapshots in one RPC batch (engine version + fingerprint)
8. Audit event

---

## Permissions

- Teachers: Results nav + scoped view (RLS)
- Head/Admin: view all + recalculate
- Secretary/Bursar: no default Results access (marks-sensitive)

---

## Future Report Card integration (2D.2)

Report cards must read **snapshots** (or call the same engine), never re-implement percentage/band math in PDF templates.

---

## Deferred features

PDF report cards, publishing, portals, CA-without-exam, auto event hooks, house ranking, remark override UI, terminal-grade flag, full SQL aggregate recompute.

---

## Local validation commands

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
git diff --check
node scripts/phase2d-stage1-verify.cjs --offline
```
