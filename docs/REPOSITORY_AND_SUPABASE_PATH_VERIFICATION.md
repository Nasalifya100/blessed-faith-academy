# Repository and Supabase path verification

**Audit date:** 2026-07-23  
**Mode:** Read-only verification (no real `db push`, no deploy, no schema changes)

## Canonical paths

| Role | Path |
| --- | --- |
| **Canonical repository (only valid)** | `C:\Users\nasa\Documents\GitHub\blessed-faith-academy` |
| **Deprecated — do not use** | `C:\Users\nasa\Desktop\Blessed_Faith_Academy` (and any nested `blessed-faith-academy` under Desktop) |
| **Git remote** | `https://github.com/Nasalifya100/blessed-faith-academy.git` |
| **Supabase project** | `blessed-faith-academy` |
| **Supabase project ref** | `qaczvlbgsxcrdcdgsfpo` |

Always run Git, Supabase CLI, npm, verification, and documentation updates from the **repository root** (the canonical path above). Prefer saying “run from the repository root” over hard-coding machine paths in scripts or GitHub Actions.

## Commands that must run from the repository root

```powershell
cd C:\Users\nasa\Documents\GitHub\blessed-faith-academy

git status
git pull origin master

npx supabase migration list
npx supabase db push --dry-run
# Only when a *new* timestamped migration exists and history is synced:
# npx supabase db push

npm run lint
npm test
npx tsc --noEmit
npm run build
npm run cf:build
node scripts/phase2b-staging-verify.cjs all
npm run deploy
```

## Local Docker / `supabase status`

This project uses the **remote** linked Supabase project only.

- Do **not** run `supabase status`, `supabase start`, or `supabase stop`.
- No local Docker Supabase stack is required for day-to-day work or CI/CD.

## Migration history (verified)

From the canonical repository root:

- `supabase/migrations` contains 58 SQL migrations plus `.gitkeep` (59 entries).
- `.gitkeep` is skipped by the CLI (harmless).
- All SQL filenames match `^\d{14}_.+\.sql$`.
- `npx supabase migration list`: **Local and Remote match exactly** for every version from `20260715120000` through `20260723130300`.
- `npx supabase db push --dry-run`: **`Remote database is up to date.`**

### Rules for future schema work

1. **Never** edit or manually re-run an already applied migration file.
2. **Every** future schema change must be a **new** timestamped file under `supabase/migrations/`.
3. Prefer applying new migrations with `npx supabase db push` (or the Deploy staging workflow with **Apply migrations: true**) — not by pasting SQL into the Dashboard Editor.

## Future automated staging flow

```text
CI (lint / test / typecheck / build / cf:build)
  → Supabase db push (optional, gated)
  → Staging verification (phase2b-staging-verify)
  → Cloudflare deploy (npm run deploy)
```

Workflows live in `.github/workflows/` on `origin/master` (`ci.yml`, `deploy-staging.yml`). They use repository-relative paths only and link via `SUPABASE_PROJECT_REF` (expected: `qaczvlbgsxcrdcdgsfpo`).

Recommended first manual workflow inputs:

| Input | Value |
| --- | --- |
| Apply migrations | `true` |
| Run verification | `true` |
| Deploy | `true` |

(With history already synced, `db push` should be a no-op and still safe.)

## Package script reference

| Intent | Command |
| --- | --- |
| Lint | `npm run lint` |
| Tests | `npm test` |
| Typecheck | `npx tsc --noEmit` (no `typecheck` script in `package.json`) |
| Next.js build | `npm run build` |
| Cloudflare / OpenNext build | `npm run cf:build` |
| Staging verification | `node scripts/phase2b-staging-verify.cjs all` |
| Cloudflare deploy | `npm run deploy` |

## Ignore / generated files

Ensure these stay out of Git (see `.gitignore` on `origin/master`):

- `node_modules/`, `.next/`, `.open-next/`, `.wrangler/`
- `.env*` (except `.env.example`)
- `supabase/.temp/` (CLI link cache; may include pooler URLs)
- Probe / cleanup JSON under `scripts/.*.json` patterns

GitHub Actions must **not** rely on a developer’s local `supabase/.temp` link. The deploy workflow explicitly runs `supabase link --project-ref "$SUPABASE_PROJECT_REF"`.

## Duplicate clone warning

A second clone may still exist under the deprecated Desktop path. Prefer the Documents path only. After switching, run `git pull origin master` so the working tree includes the pre-automation checkpoint (`v1.0-pre-cicd` / commit `612a93d` or later).
