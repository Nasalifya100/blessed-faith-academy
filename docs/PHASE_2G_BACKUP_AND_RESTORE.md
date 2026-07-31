# Phase 2G — Backup and Restore Readiness

## Evidence status

**Do not claim automated backups succeed without Dashboard evidence.**

As of Phase 2G coding:

| Item | Status |
|---|---|
| In-app backup success signal | **Unknown** (not implemented; intentionally not fabricated) |
| Supabase plan automated backups / PITR | **Operator must confirm** in Supabase Dashboard → Database → Backups |
| Off-platform export job in repo | **None** |
| Storage bucket backup | **N/A** — no school file buckets in schema |

Previous finance/exam docs mention “confirm backup before cutover” as a human checklist. That remains the control.

## Strategy (target operating model)

### Database

- **Primary:** Supabase managed daily backups + PITR if the project plan includes it.
- **Off-platform copy:** Periodic logical dump (schema + data) stored encrypted outside Supabase (operator-owned drive/cloud). Frequency: weekly minimum while live, daily during exam weeks if PITR is unavailable.
- **Encryption:** At rest via platform; off-platform copies encrypted at rest (BitLocker / provider KMS).
- **Retention:** Align to school policy (suggested: 30 days daily, 12 weeks weekly, exam-term freeze copies).
- **Owner:** School system administrator (technical) + headteacher awareness for RTO/RPO decisions.

### Storage

- No buckets today. When uploads ship, enable private buckets + lifecycle + separate backup of object prefixes.

### Application / Worker

- Cloudflare Workers version history supports rollback of **code**, not database state.
- GitHub `master` + Actions logs are the release audit trail.

## Objectives (proposed)

| Metric | Target | Notes |
|---|---|---|
| RPO | ≤ 24h (≤ 1h with PITR) | Confirm plan |
| RTO | ≤ 4h for schema+data restore to disposable env | First successful drill sets baseline |

## Restore drill plan (safe)

**Never overwrite the live database.**

1. Provision a **disposable** Supabase project or local Postgres.
2. Restore schema from migrations (`supabase db reset` locally) **or** restore a dump into the disposable project.
3. Load representative anonymized/sample data only.
4. Run migration reconciliation (`supabase migration list`) — expect alignment.
5. Run verifiers:
   - `node scripts/phase2b-staging-verify.cjs all` (against disposable credentials)
   - `node scripts/phase2c-stage1-verify.cjs`
   - `node scripts/phase2d-stage1-verify.cjs`
   - `node scripts/phase2d2-report-cards-verify.cjs`
   - `node scripts/operational-integrity-verify.cjs --online`
6. Verify RLS with a non-admin authenticated user (cross-school denial).
7. Verify audit tables are readable and append-only grants still revoke client writes.
8. Verify approved/published report cards retain checksum + render payload immutability.
9. Record elapsed time, issues, and whether RTO/RPO targets held.

## Restore prerequisites

- Valid Supabase access token / DB password for the **target disposable** project only
- Matching app env pointing at disposable project (never reuse live Worker secrets for a restore target without changing Worker)
- Known-good git SHA for application code
- Operator checklist sign-off

## Actions never to take during restore incidents

- `supabase db push` to live without preflight
- Restoring a dump onto the live project “to test”
- Disabling RLS “temporarily”
- Sharing service-role keys in chat/tickets
- Deleting audit tables to “free space”
