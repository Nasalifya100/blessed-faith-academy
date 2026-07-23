# First automated staging deployment checklist

**Repository root:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`  
**Branch:** `master`  
**Remote:** `origin` → `https://github.com/Nasalifya100/blessed-faith-academy.git`  
**Supabase project:** `blessed-faith-academy` (`qaczvlbgsxcrdcdgsfpo`)  
**Worker:** `bfa-sms-staging`  
**Staging URL:** https://bfa-sms-staging.nasalifya007.workers.dev  

Working rule: run every command from the **repository root**. Do not use older local clones.

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
   checkout → Node 20 (.nvmrc) → npm ci
   → npm run lint → npm test → npx tsc --noEmit
   → npm run build → npm run cf:build

2. Phase 2–3 — migrations (if Apply migrations = true)
   checkout → Node 20 → supabase/setup-cli
   → supabase link --project-ref $SUPABASE_PROJECT_REF
   → supabase migration list
   → node scripts/ci-supabase-migration-gate.cjs
   → supabase db push   (only if gate = safe)

3. Phase 4 — verification (if Run verification = true)
   AFTER migrations succeed or are skipped
   → node scripts/phase2b-staging-verify.cjs all

4. Phase 5 — Cloudflare deploy (if Deploy = true)
   AFTER verification succeeds or is skipped
   → npm run deploy

5. Phase 6 — summary (always)
```

CI workflow (`.github/workflows/ci.yml`) runs lint/test/typecheck/build/cf:build on push/PR to `master` and does **not** touch Supabase or deploy.

### Recommended first run inputs

| Input | Value |
| --- | --- |
| Apply migrations | `true` |
| Run verification | `true` |
| Deploy | `true` |

With history already synced, `db push` should be a no-op and still safe.

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
4. **Emergency stop:** Cancel the in-progress Actions run; concurrency group `deploy-staging` prevents overlapping deploys.

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
5. Deploy: GitHub Actions **Deploy staging** or `npm run deploy` from the repository root with Cloudflare credentials

Do **not** run `supabase status`, `supabase start`, or `supabase stop` — this project uses the remote linked project only.
