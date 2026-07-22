# Database tests — payment allocations

For the full staging cutover checklist (backup → migrations → diagnostics → dry-run → backfill → validate → activate → functional tests → readiness report), see:

- `docs/FINANCE_ALLOCATION_STAGING_RUNBOOK.md`
- `supabase/diagnostics/finance_allocation_staging_verification.sql`

## Scope

`payment_allocations_hardening.sql` is a **manual SQL verification suite** for Phase 2 finance allocations.

It is intended for:

- a disposable local Postgres / Supabase branch; or
- a dedicated non-production project

**Never run this suite against production.**

## Prerequisites

1. Apply migrations through `20260719150200_payment_allocations_activation.sql`.
2. Connect as a role that can execute SECURITY DEFINER console functions (typically the SQL editor / service role / table owner).

## How to run

In the Supabase SQL editor (non-production):

```sql
\i supabase/tests/payment_allocations_hardening.sql
```

Or via `psql`:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/payment_allocations_hardening.sql
```

## What “pass” looks like

The script raises notices for each assertion and ends with:

`payment_allocations_hardening: ALL CHECKS PASSED`

Any failed assertion raises an exception and stops the script.
