# GitHub Actions CI/CD — Blessed Faith Academy SMS

**Repository:** `blessed-faith-academy`  
**Canonical local path:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`  
**Working rule:** Run from the **repository root** only.  
**Worker:** `bfa-sms-staging`  
**Staging URL:** https://bfa-sms-staging.nasalifya007.workers.dev  
**Supabase project ref:** `qaczvlbgsxcrdcdgsfpo` (staging / pre-production)

Path and migration verification: `docs/REPOSITORY_AND_SUPABASE_PATH_VERIFICATION.md`.  
First automated deploy checklist: `docs/FIRST_AUTOMATED_DEPLOYMENT_CHECKLIST.md`.

This document matches the **actual** repository scripts and deployment path (OpenNext Cloudflare), not a generic template.

---

## Repository commands (discovered)

| Purpose | Command |
|---|---|
| Lint | `npm run lint` |
| Tests | `npm test` (`vitest run`) |
| Typecheck | `npx tsc --noEmit` (no `typecheck` script; `typescript` is a dependency; `npm run build` also typechecks) |
| Next.js build | `npm run build` (`next build --webpack`) |
| OpenNext / Cloudflare build | `npm run cf:build` |
| Deploy staging Worker | `npm run deploy` (`opennextjs-cloudflare build && opennextjs-cloudflare deploy -- --keep-vars`) |
| Phase 2B verification | `node scripts/phase2b-staging-verify.cjs all` |
| Migration safety gate | `node scripts/ci-supabase-migration-gate.cjs` |

Node version for CI: **20** (see `.nvmrc`; `docs/OPERATIONS.md` requires Node.js 20+).

---

## Workflows

| File | Trigger | Deploys? | Touches Supabase? |
|---|---|---|---|
| `.github/workflows/ci.yml` | Push / PR → `master` | No | No |
| `.github/workflows/deploy-staging.yml` | Manual `workflow_dispatch` | Optional | Optional |

---

## Required GitHub configuration

### 1. Environment

Create a GitHub Environment named **`staging`**:

Repository → **Settings** → **Environments** → **New environment** → `staging`

Optional: add required reviewers for production-like caution.

### 2. Secrets (Environment `staging`)

Configure these on the **staging** environment (not only repository secrets, unless you prefer repo-wide).

| Secret | Used by | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | build, verify, deploy | Staging Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | build, verify, deploy | Staging anon key |
| `NEXT_PUBLIC_SITE_URL` | build, deploy | Must be `https://bfa-sms-staging.nasalifya007.workers.dev` for Worker builds |
| `SUPABASE_SERVICE_ROLE_KEY` | verification | Service role for `phase2b-staging-verify.cjs` |
| `SUPABASE_ACCESS_TOKEN` | migrations | Supabase CLI auth ([account tokens](https://supabase.com/dashboard/account/tokens)) |
| `SUPABASE_PROJECT_REF` | migrations | `qaczvlbgsxcrdcdgsfpo` |
| `SUPABASE_DB_PASSWORD` | migrations | Database password (Project Settings → Database) |
| `CLOUDFLARE_API_TOKEN` | deploy | Token with Workers deploy permission |
| `CLOUDFLARE_ACCOUNT_ID` | deploy | Cloudflare account id |

**CI workflow** does **not** read these secrets (uses build placeholders only).

Never commit secrets. Never print secret values in logs or summaries.

### 3. Cloudflare runtime secrets

`npm run deploy` uses `--keep-vars`, so existing Worker dashboard variables/secrets are retained. Ensure the Worker already has:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `NEXT_PUBLIC_SITE_URL`
- `SUPABASE_SERVICE_ROLE_KEY` (Secret)

as documented in `docs/OPERATIONS.md` and `wrangler.jsonc` comments.

---

## First-time setup

1. Push workflows to `master` (or open a PR; CI will run).  
2. Create Environment **`staging`**.  
3. Add all staging secrets above.  
4. Confirm Cloudflare Worker `bfa-sms-staging` exists and dashboard vars are set.  
5. Create a Supabase access token; set `SUPABASE_ACCESS_TOKEN`.  
6. Run **Deploy staging** once with:
   - Apply migrations = **false**
   - Run verification = **false**
   - Deploy = **false**  
   (validates secrets / environment wiring without side effects — or enable only verify after migrations are reconciled).  
7. Complete **Migration reconciliation** (next section) before enabling Apply migrations.

---

## Migration reconciliation

### Why this is required

Many migrations in `supabase/migrations/` were applied historically via the **Supabase SQL Editor**. The CLI migration history table may be empty or incomplete even though database objects already exist.

**Never** run `supabase db push` blindly in that state — it can attempt to re-apply SQL and fail or corrupt history.

### Inspect

With CLI authenticated and linked:

```bash
supabase link --project-ref qaczvlbgsxcrdcdgsfpo
supabase migration list
```

Or rely on the deploy workflow’s **Migration history gate** (`scripts/ci-supabase-migration-gate.cjs`), which fails with exit code `2` when remote history looks empty while many local files exist.

### Exact repair procedure (staging only)

1. Confirm you are linked to **staging** ref `qaczvlbgsxcrdcdgsfpo` (not production).  
2. Confirm which migration versions are **already live as objects** (tables/functions present).  
3. For each already-applied version, mark history **without re-running SQL**:

```bash
supabase migration repair --status applied 20260715120000
```

Use the **14-digit prefix** from each filename, e.g.  
`20260723130300_exam_references_and_status_workflow.sql` → `20260723130300`.

4. Repeat for every migration that is already applied.  
5. Re-run:

```bash
supabase migration list
node scripts/ci-supabase-migration-gate.cjs
```

6. When the gate prints `MIGRATION_STATUS=pending_safe` or `synced`, it is safe to enable **Apply migrations** in the workflow (or run `supabase db push` for pending versions only).

### Pending-only push

After reconciliation:

```bash
supabase db push
```

This applies **only** versions that are Local and not yet Remote. Stop immediately on failure.

---

## Normal deployment workflow

1. Open **Actions** → **Deploy staging** → **Run workflow**.  
2. Choose inputs:

| Input | Typical production-like run |
|---|---|
| Apply migrations | `true` only after history is reconciled |
| Run verification | `true` |
| Deploy | `true` |

3. Phases:

1. Repository: `lint` → `test` → `tsc` → `build` → `cf:build`  
2. Supabase: `migration list` → gate → optional `db push`  
3. Verification: `node scripts/phase2b-staging-verify.cjs all`  
4. Deploy: `npm run deploy`  
5. Job summary: commit, migration/verify results, Worker name/version, URL  

Verification writes a temporary `.env.local` from secrets (script expects that file).

---

## CI workflow (automatic)

On push/PR to `master`:

- `npm ci`
- `npm run lint`
- `npm test`
- `npx tsc --noEmit`
- `npm run build`
- `npm run cf:build`
- Upload `.open-next` artifact (7-day retention)

No deploy. No Supabase. Duplicate runs cancelled via concurrency.

---

## Rollback

### Application (Worker)

1. Cloudflare Dashboard → Workers → `bfa-sms-staging` → Deployments → roll back to previous version.  
2. Or redeploy a known-good git SHA:

```bash
git checkout <good-sha>
npm run deploy
```

### Database

- Prefer forward-fix migrations.  
- Do **not** re-run old SQL Editor files.  
- If a `db push` fails mid-way, fix the failing migration and re-run; use `supabase migration list` to see what applied.  
- `migration repair` only adjusts **history**, not schema — use carefully.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| CI build fails missing Supabase env | Placeholders missing | CI sets placeholders; check `ci.yml` `env` |
| Deploy fails Cloudflare auth | Bad/missing token or account id | Check `CLOUDFLARE_*` secrets on Environment `staging` |
| `supabase link` fails | Wrong password or token | Refresh `SUPABASE_DB_PASSWORD` / `SUPABASE_ACCESS_TOKEN` |
| Gate exit 2 / reconciliation required | Manual SQL history | Follow § Migration reconciliation |
| `db push` tries to recreate existing tables | History not repaired | `migration repair --status applied …` |
| Verify cannot find tables | Migration 303+ not on staging | Apply pending migrations after gate is safe |
| Verify Auth JWT flakiness | Transient Auth API | Re-run job; script retries some Auth calls |
| OpenNext Windows issues | Local Windows limits | Use Linux CI (these workflows) or WSL |

### Common errors

- **`Missing Supabase environment variables`** during build — public `NEXT_PUBLIC_*` not set for that job.  
- **`Could not find the function … in the schema cache`** — RPC not applied; migrations incomplete.  
- **`MIGRATION_RECONCILIATION_REQUIRED`** — do not force `db push`.  
- **Wrangler keep-vars** — dashboard secrets remain; forgetting dashboard `SUPABASE_SERVICE_ROLE_KEY` breaks runtime even if CI deploy succeeds.

---

## Security notes

- CI never receives service-role or Cloudflare secrets.  
- Staging deploy secrets live in Environment **`staging`**.  
- Verification uses service role only inside the ephemeral runner and a gitignored `.env.local`.  
- Do not log secret values in step summaries.

---

## Related docs

- `docs/OPERATIONS.md` — env vars, Worker, migrations process  
- `docs/EXAMINATIONS_PHASE_2B_IMPLEMENTATION.md` — Phase 2B behaviour  
- `docs/EXAMINATIONS_PHASE_2B_DEPLOYMENT_REPORT.md` — current deploy/blocker status  
- `wrangler.jsonc` — Worker name `bfa-sms-staging`  
