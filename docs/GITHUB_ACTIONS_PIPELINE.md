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
| Deploy live Worker | `npm run deploy` (`opennextjs-cloudflare build` → `versions upload` → `wrangler versions deploy <id>@100% --yes`) |
| Phase 2B verification | `node scripts/phase2b-staging-verify.cjs all` |
| Migration safety gate | `node scripts/ci-supabase-migration-gate.cjs` |

Node version for CI: **22** LTS (see `.nvmrc`; `docs/OPERATIONS.md` requires Node.js 22+). Wrangler 4.111+ and current Supabase packages require Node.js >=22.

---

## Workflows

| File | Trigger | Deploys? | Touches Supabase? |
|---|---|---|---|
| `.github/workflows/ci.yml` | Push / PR → `master` | No | No |
| `.github/workflows/deploy-staging.yml` | **Push → `master`** + manual `workflow_dispatch` | Yes (automatic on push) | Yes (automatic on push) |

Both workflows run on push to `master`. CI is a fast, secret-free verify-only pass for PRs and pushes. **Deploy staging** is the production pipeline (verify → migrate → DB verify → upload → promote).

**Concurrency:** deploy workflow uses `group: production-deploy` with `cancel-in-progress: false`. Production runs are **serialized**: only one deploy runs at a time; newer pushes **wait** until the active deployment finishes (they do not cancel a run that may be applying migrations).

**Verification is mandatory for every deployment.** Phase 1 (lint/test/tsc/build/cf:build) always runs. Phase 4 (DB verification) always runs when Deploy is enabled — including manual `workflow_dispatch` even if **Run verification** is set to false.

---

## Developer workflow (automatic production deploy)

After CI/CD automation is enabled, pushing to `master` deploys production automatically:

```bash
git add .
git commit -m "message"
git push origin master
```

GitHub then runs **Deploy staging** automatically:

```text
✓ Phase 1 — verify        lint, test, tsc, build, cf:build
✓ Phase 2–3 — migrations  migration list → gate → supabase db push (pending only)
✓ Phase 4 — verification  node scripts/phase2b-staging-verify.cjs all
✓ Phase 5 — deploy        npm run deploy (upload + promote @100%)
✓ Phase 6 — summary       commit SHA, Worker version, live URL
```

**Deploy only proceeds if every required phase succeeds.** Any failure in verify, migrations, verification, upload, or promotion fails the workflow immediately.

Manual deployments remain available: **Actions → Deploy staging → Run workflow** (`workflow_dispatch`).

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

`npm run deploy` uploads with `--keep-vars` (dashboard variables/secrets retained), then promotes the new version to **100%** traffic. Ensure the Worker already has:

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

Or rely on the deploy workflow’s **Migration history gate** (`scripts/ci-supabase-migration-gate.cjs`).

### Parse failure vs empty history (important)

| Gate status | Meaning | Action |
|---|---|---|
| `MIGRATION_LIST_PARSE_ERROR` (`parsed_rows=0`, exit `3`) | CLI output could not be parsed | **Do not** run `migration repair`. Fix the parser / inspect CLI output. |
| `MIGRATION_RECONCILIATION_REQUIRED` (exit `2`) | Parsed rows exist and **every** Remote column is empty while local SQL files exist | Independently verify history, then repair if needed |
| `synced` / `pending_safe` (exit `0`) | Histories aligned, or only Local-only pending versions | Safe to `db push` for pending only |

**`parsed_rows=0` must never trigger automatic repair instructions.** Manual `supabase migration repair` is only for independently verified history discrepancies (empty or divergent Remote columns after a successful parse).

The gate prefers `supabase migration list --output-format json` when available, and otherwise parses the human table (backticks, ANSI colours, CRLF, `.gitkeep` skip lines, variable spacing).

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

## Deployment triggers

### Automatic (push to `master`)

Every push to `master` runs the **full** pipeline:

| Phase | Runs on push? |
|---|---|
| Verify (lint, test, tsc, build, cf:build) | Always |
| Migrations (gate + pending `db push`) | Always |
| Phase 2B verification | Always |
| Cloudflare upload + promote @100% | Always |

No workflow inputs are required. Secrets are read from GitHub Environment **`staging`**.

### Manual (`workflow_dispatch`)

**Actions → Deploy staging → Run workflow** with optional inputs:

| Input | Default | Purpose |
|---|---|---|
| Apply migrations | `false` | Run migration gate + `supabase db push` |
| Run verification | `true` | Run Phase 2B DB verification (verification-only / diagnostics) |
| Deploy | `true` | Upload Worker version and promote to 100% |

**Safety rules for manual runs:**

- Phase 1 (lint, test, tsc, build, cf:build) **always** runs — it cannot be skipped.
- If **Deploy = true**, Phase 4 DB verification **always** runs, even when **Run verification = false**.
- Deploy requires `needs.verification.result == 'success'` — skipped or failed verification blocks deploy.
- Use **Run verification = true** with **Deploy = false** for verification-only diagnostic runs.

Use manual dispatch to redeploy without migrations, or run diagnostics without deploying.

### Deployment sequence (all paths)

1. **Verify:** `lint` → `test` → `tsc` → `build` → `cf:build`  
2. **Migrations:** `migration list` → `ci-supabase-migration-gate.cjs` → `db push` (pending only; never reset; never re-run applied migrations)  
3. **Verification:** `node scripts/phase2b-staging-verify.cjs all`  
4. **Deploy:** `npm run deploy` → `wrangler versions upload` → `wrangler versions deploy <version-id>@100% --yes`  
5. **Summary:** commit, job results, promoted Worker version, live URL  

Verification writes a temporary `.env.local` from secrets (script expects that file).

**Migration safety:** the gate blocks `db push` when remote history is unsynchronized. `db push` applies **only** pending migrations. The workflow never runs `db reset` or re-applies already-recorded versions.

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

### Application (Worker) — fastest

1. **Cloudflare Dashboard** → Workers → `bfa-sms-staging` → **Deployments** → select the previous good version → **Rollback** (or promote an earlier version to 100% traffic).  
2. **Redeploy a known-good commit via GitHub:** checkout the good SHA on `master` (revert commit or cherry-pick fix), push, and let the automatic pipeline run — or use **workflow_dispatch** on the good commit with **Apply migrations = false**.  
3. **Local emergency redeploy** (requires Cloudflare credentials):

```bash
git checkout <good-sha>
npm run deploy
```

Database schema is **not** rolled back when you roll back the Worker.

### Database

- Prefer **forward-fix** migrations (new timestamped file).  
- Do **not** edit or re-run already applied migration files.  
- Do **not** use `supabase db reset` on staging/production.  
- If `db push` fails mid-way, inspect Actions logs and `supabase migration list`; fix the failing migration and push a new migration.  
- `migration repair` only adjusts **history**, not schema — use carefully.

### Cancel a bad deploy in progress

Cancel the run manually in **Actions** if you must stop it. Concurrency group `production-deploy` with `cancel-in-progress: false` **queues** newer pushes — they wait for the active production deploy (and any in-flight migrations) to finish; they do **not** cancel it.

---

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| CI build fails missing Supabase env | Placeholders missing | CI sets placeholders; check `ci.yml` `env` |
| Deploy fails Cloudflare auth | Bad/missing token or account id | Check `CLOUDFLARE_*` secrets on Environment `staging` |
| `supabase link` fails | Wrong password or token | Refresh `SUPABASE_DB_PASSWORD` / `SUPABASE_ACCESS_TOKEN` |
| Gate exit 2 / reconciliation required | Parsed empty Remote history | Follow § Migration reconciliation (only after confirming parse succeeded) |
| Gate exit 3 / `MIGRATION_LIST_PARSE_ERROR` | Parser could not read list output | Fix gate/parser; **never** run `migration repair` for `parsed_rows=0` |
| `db push` tries to recreate existing tables | History not repaired | `migration repair --status applied …` (only after verified empty/divergent history) |
| Verify cannot find tables | Migration 303+ not on staging | Apply pending migrations after gate is safe |
| Verify Auth JWT flakiness | Transient Auth API | Re-run job; script retries some Auth calls |
| OpenNext Windows issues | Local Windows limits | Use Linux CI (these workflows) or WSL |

### Common errors

- **`Missing Supabase environment variables`** during build — public `NEXT_PUBLIC_*` not set for that job.  
- **`Could not find the function … in the schema cache`** — RPC not applied; migrations incomplete.  
- **`MIGRATION_LIST_PARSE_ERROR`** / `parsed_rows=0` — table/JSON parse failed; **not** empty history; do **not** run `migration repair`.  
- **`MIGRATION_RECONCILIATION_REQUIRED`** — parsed rows show empty Remote columns while local SQL exists; do not force `db push` until independently verified.  
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
