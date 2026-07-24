# Production deployment checklist (automatic CI/CD)

**Repository root:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`  
**Branch:** `master`  
**Remote:** `origin` → `https://github.com/Nasalifya100/blessed-faith-academy.git`  
**Supabase project:** `blessed-faith-academy` (`qaczvlbgsxcrdcdgsfpo`)  
**Worker:** `bfa-sms-staging`  
**Live URL:** https://bfa-sms-staging.nasalifya007.workers.dev  

Working rule: run every command from the **repository root**. Do not use older local clones.

---

## Developer workflow (automatic)

```bash
git add .
git commit -m "message"
git push origin master
```

↓ GitHub **Deploy staging** runs automatically:

| Step | Action |
| --- | --- |
| ✓ Verify | lint, test, tsc, build, cf:build |
| ✓ Migrate | pending migrations only (gate + `db push`) |
| ✓ DB verify | `phase2b-staging-verify.cjs all` |
| ✓ Upload | `wrangler versions upload` |
| ✓ Promote | `wrangler versions deploy <id>@100%` |
| ✓ Summary | commit SHA + Worker version |

Manual deploy: **Actions → Deploy staging → Run workflow** (`workflow_dispatch` still enabled).

**Concurrency:** `production-deploy` with `cancel-in-progress: false` — production deploys are **serialized**. Newer pushes **wait**; they do not cancel an active run that may be applying migrations.

**Verification:** mandatory for every deployment (Phase 1 always; Phase 4 DB verification always when Deploy is enabled).

---

## Pre-flight (already verified)

| Check | Expected |
| --- | --- |
| Git top-level | Canonical Documents path above |
| `master` vs `origin/master` | Aligned before you dispatch the workflow |
| Migration history | Local == Remote for `20260715120000` … `20260723130300` |
| `npx supabase db push --dry-run` | `Remote database is up to date.` |
| Local Docker / `supabase status` | Not used (remote project only) |

---

## Workflow sequence (`Deploy staging`)

```text
1. Phase 1 — verify
   checkout → Node 22 (.nvmrc) → npm ci
   → npm run lint → npm test → npx tsc --noEmit
   → npm run build → npm run cf:build

2. Phase 2–3 — migrations (always on push; optional on manual dispatch)
   checkout → Node 22 → supabase/setup-cli
   → supabase link --project-ref $SUPABASE_PROJECT_REF
   → supabase migration list
   → node scripts/ci-supabase-migration-gate.cjs
   → supabase db push   (only if gate = safe)

   Gate outcomes:
   - exit 0 synced / pending_safe → allow db push
   - exit 2 reconciliation → block push (empty Remote after successful parse)
   - exit 3 parse error → block push; do NOT run migration repair

3. Phase 4 — verification (always on push; always when Deploy=true on manual dispatch)
   AFTER migrations succeed or are skipped
   → node scripts/phase2b-staging-verify.cjs all
   (cannot be skipped when deploying)

4. Phase 5 — Cloudflare deploy (always on push; optional on manual dispatch)
   AFTER verification succeeds (required — skipped verification blocks deploy)
   → npm run deploy
     (= OpenNext build
      → wrangler versions upload
      → wrangler versions deploy <version-id>@100% --name bfa-sms-staging --yes)

5. Phase 6 — summary (always)
```

**Important:** `wrangler versions upload` alone does **not** move live traffic. Promotion to 100% is required and must succeed or the job fails.


CI workflow (`.github/workflows/ci.yml`) runs lint/test/typecheck/build/cf:build on push/PR to `master` and does **not** touch Supabase or deploy.

### Automatic vs manual triggers

| Trigger | Migrations | Verification | Deploy |
| --- | --- | --- | --- |
| Push to `master` | Always | Always | Always |
| `workflow_dispatch` | Input (default `false`) | Forced when Deploy=true; else input | Input (default `true`) |

With history already synced, automatic `db push` should be a no-op and still safe.

---

## GitHub Environment secrets (`staging`)

| Secret | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | App + verify |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | App + verify |
| `NEXT_PUBLIC_SITE_URL` | App / Worker public URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Verification script only |
| `SUPABASE_ACCESS_TOKEN` | Supabase CLI auth |
| `SUPABASE_DB_PASSWORD` | `supabase link` / `db push` |
| `SUPABASE_PROJECT_REF` | Must be `qaczvlbgsxcrdcdgsfpo` |
| `CLOUDFLARE_API_TOKEN` | `npm run deploy` |
| `CLOUDFLARE_ACCOUNT_ID` | Wrangler account |

Confirm Environment name is exactly **`staging`** and the workflow is allowed to use it.

---

## Package commands (must match workflows)

| Intent | Command |
| --- | --- |
| Lint | `npm run lint` |
| Tests | `npm test` |
| Typecheck | `npx tsc --noEmit` |
| Next.js build | `npm run build` |
| OpenNext build | `npm run cf:build` |
| Staging verify | `node scripts/phase2b-staging-verify.cjs all` |
| Cloudflare deploy | `npm run deploy` |

---

## Rollback plan

1. **Worker only:** In Cloudflare dashboard (or Wrangler), roll back `bfa-sms-staging` to the previous deployment version. App code reverts; database schema does not.
2. **Failed `db push`:** Check Actions logs and `supabase migration list`. Do **not** edit already applied migration files. Fix forward with a **new** timestamped migration if schema repair is needed.
3. **Bad verify after deploy:** Redeploy the previous Worker version; investigate DB/app mismatch offline.
4. **Emergency stop:** Cancel the in-progress Actions run manually if required. Newer pushes **wait** (they do not cancel an active `production-deploy` run).
5. **Worker rollback:** Cloudflare Dashboard → `bfa-sms-staging` → Deployments → roll back to previous version.
6. **Redeploy good commit:** Revert on `master` and push, or run **workflow_dispatch** on a known-good SHA with migrations off (verification still required when Deploy=true).

Tag `v1.0-pre-cicd` marks the pre-automation checkpoint on GitHub.

---

## Post-deploy verification checklist

- [ ] Actions run: all selected phases green; summary shows commit SHA and Worker version
- [ ] Open https://bfa-sms-staging.nasalifya007.workers.dev — login page loads
- [ ] Sign in as administrator — dashboard loads
- [ ] Spot-check: Students, Fees, Examinations (periods/rooms) routes
- [ ] Confirm no accidental schema drift: `npx supabase migration list` still Local == Remote
- [ ] Confirm `npx supabase db push --dry-run` still reports up to date

---

## Future migration workflow

1. Create a **new** file: `supabase/migrations/YYYYMMDDHHMMSS_short_name.sql`
2. Never edit or re-paste already applied migrations
3. From the repository root: `npx supabase db push --dry-run`, then `npx supabase db push` (or enable **Apply migrations** in Deploy staging)
4. Run verification: `node scripts/phase2b-staging-verify.cjs all`
5. Deploy: push to `master` (automatic) or **Deploy staging** workflow_dispatch, or `npm run deploy` locally with Cloudflare credentials

Do **not** run `supabase status`, `supabase start`, or `supabase stop` — this project uses the remote linked project only.
