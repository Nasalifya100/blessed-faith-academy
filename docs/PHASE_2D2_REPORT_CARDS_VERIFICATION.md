# Phase 2D.2 — Report Cards Verification

## Offline structural

```bash
node scripts/phase2d2-report-cards-verify.cjs --offline
```

Checks:

- three additive migrations present
- enums / tables / indexes / constraints / RLS / SELECT-only grants
- capabilities in `has_academic_capability`
- RPC create + revoke/grant + `search_path` + revision locks
- named RPC probe payloads use synthetic UUIDs only
- no empty-arg probes for parameterized RPCs

## Online structural (after migrations applied)

```bash
node scripts/phase2d2-report-cards-verify.cjs
```

Checks table readability and correctly shaped RPC probes. Service-role calls without `auth.uid()` are expected to fail with auth/business errors — that still proves RPC presence.

Does **not**:

- call parameterized RPCs with `{}`
- treat empty-arg arity mismatch as universal absence
- mutate report cards
- invent student fixtures

## Classification tests

```bash
npx vitest run scripts/phase2d2-report-cards-verify.test.ts
```

## Application tests

```bash
npx vitest run src/features/report-cards/report-cards.test.ts
```

Covers permissions, documented lifecycle, remark sanitization, attendance unavailable semantics, checksum stability, and schemas.

## Post-migration smoke plan (manual, staging)

1. Ensure Phase 2D.1 class-term results are current (not stale).
2. Open `/dashboard/report-cards`, select year/term/class.
3. Generate drafts — expect one card per student with a term snapshot.
4. Teacher saves class-teacher remark; head saves head remark.
5. Mark reviewed → approve (immutable payload created).
6. Publish → print single + bulk.
7. Recalculate Results with a mark change → drafts show outdated; approval blocked until regenerate after unpublish/void rules.
8. Confirm previously published payload still shows old academic values.
9. Unpublish with reason; void a draft with reason; confirm history rows.

## Validation gate (implementation)

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
node scripts/phase2d2-report-cards-verify.cjs --offline
git diff --check
```

Do not apply migrations, commit, push, or deploy as part of the implementation-only milestone.
