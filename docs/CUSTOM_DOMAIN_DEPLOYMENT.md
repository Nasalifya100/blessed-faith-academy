# Custom Domain Deployment — portal.blessedfaithacademy.com

Runbook for serving the School Management System from a permanent custom
domain, plus the recorded result of the cutover release.

**Status: completed on 2026-09-20.** Operator-side Cloudflare, Supabase, and
GitHub configuration was done manually; the application-side release is
recorded in [Cutover release record](#cutover-release-record). Nothing in this
repository changes DNS or Supabase settings.

## Target architecture

| Property | Value |
|---|---|
| Cloudflare Worker (unchanged) | `bfa-sms-staging` |
| Canonical School Management System | https://portal.blessedfaithacademy.com |
| Legacy Workers URL (temporary cutover support) | https://bfa-sms-staging.nasalifya007.workers.dev |
| Public website (separate site, not this Worker) | https://blessedfaithacademy.com |
| Supabase project | unchanged |
| Database schema | unchanged (no migrations in this change set) |

The Worker name does **not** change. Only the hostname in front of it changes,
so Worker versions, rollback history, and deployment tooling stay intact.

The apex domain `blessedfaithacademy.com` must **not** be routed to this Worker.
The portal is a private staff application; the marketing website is a separate
origin owned by whoever builds the public site.

## How the application resolves its own URL

The canonical origin comes from `NEXT_PUBLIC_SITE_URL` only. After the
preparation changes, no application source file contains a deployment hostname.

| Consumer | Behaviour |
|---|---|
| Password-reset emails | `getPasswordResetRedirectUrl()` → `${NEXT_PUBLIC_SITE_URL}/auth/reset-password` |
| Trusted request origins | `NEXT_PUBLIC_SITE_URL` host, `localhost`, plus any host in `NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS` |
| Page metadata base | `NEXT_PUBLIC_SITE_URL` when set, otherwise omitted |
| Login / auth redirects | relative paths only (`/login`, `/auth/...`) — host-independent |
| Middleware auth gate | clones the inbound request URL — host-independent |
| `/api/health` | returns status, version, environment, short commit — no hostname |

## Environment variables

| Variable | Where | Value after cutover |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Cloudflare Worker **Variables**, Worker **Build variables**, GitHub Environment `staging` secret | `https://portal.blessedfaithacademy.com` |
| `NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS` | Cloudflare Worker Variables + GitHub repo variable `ADDITIONAL_TRUSTED_HOSTS` | `bfa-sms-staging.nasalifya007.workers.dev` during cutover, then empty |
| `PUBLIC_APP_URL` | GitHub repository **variable** | `https://portal.blessedfaithacademy.com` (job-summary display only) |
| `NEXT_PUBLIC_SUPABASE_URL` | unchanged | unchanged |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | unchanged | unchanged |
| `SUPABASE_SERVICE_ROLE_KEY` | unchanged **Secret** | unchanged |
| `NEXT_PUBLIC_WORKER_NAME` | unchanged | `bfa-sms-staging` |

No secret is created, rotated, or modified by this change.

`NEXT_PUBLIC_SITE_URL` must be set in **both** the build environment and the
Worker runtime variables. A build performed with the old value keeps emitting
the old hostname in password-reset emails even after DNS moves.

## Cloudflare steps

Perform in this order. Steps 1–3 are safe while the Workers URL keeps serving
traffic; the switch only becomes user-visible at step 5.

1. **Zone.** Confirm `blessedfaithacademy.com` is an active zone in the same
   Cloudflare account as the Worker. If the domain is registered elsewhere,
   move the nameservers to Cloudflare first and wait for the zone to show
   **Active**.
2. **Do not** point the apex `blessedfaithacademy.com` at this Worker. It is
   reserved for the public website.
3. **Attach the custom domain.** Dashboard → Workers & Pages → `bfa-sms-staging`
   → **Settings** → **Domains & Routes** → **Add** → **Custom domain** →
   `portal.blessedfaithacademy.com`.
   - Cloudflare creates the required proxied DNS record automatically.
   - Cloudflare issues an edge certificate for the hostname automatically.
   - This is deliberately **not** declared in `wrangler.jsonc`, so a routine
     `npm run deploy` can never create or mutate DNS.
4. **Update Worker variables.** Same Worker → **Settings** → **Variables and
   Secrets** → set `NEXT_PUBLIC_SITE_URL` to the portal URL (and
   `NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS` if using the cutover allowlist).
   Mirror both under **Build variables and secrets**.
5. **Rebuild and redeploy** so the new origin is embedded at build time:
   update the GitHub Environment secret `NEXT_PUBLIC_SITE_URL`, then run
   **Deploy staging**. A deploy is required — changing the variable alone does
   not rewrite an existing bundle.

### DNS expectations

| Record | Name | Target | Proxy |
|---|---|---|---|
| Created by Cloudflare | `portal` | the Worker | Proxied (orange cloud) |
| Owned by the website project | `@` / `www` | public marketing site | per that project |

- Do not create a manual `CNAME portal → *.workers.dev`. Worker Custom Domains
  manage their own record; a manual record conflicts with it.
- Keep any existing MX/TXT records untouched — email and domain verification
  are unrelated to this change.

### SSL expectations

- Cloudflare issues and renews the edge certificate for
  `portal.blessedfaithacademy.com` automatically.
- Certificate issuance is usually minutes but can take up to ~24 hours.
- Until the certificate is active the hostname may return TLS errors; the
  workers.dev URL keeps working throughout.
- SSL/TLS mode stays at the zone default; no origin certificate is needed
  because the Worker *is* the origin.

### Propagation

- Inside Cloudflare the change is near-immediate once the record exists.
- Resolver caches elsewhere can lag; allow up to 24 hours before declaring the
  old hostname dead.
- Keep the workers.dev hostname reachable during this window and list it in
  `NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS` so in-flight password-reset links
  still resolve to a trusted origin.

## Supabase Auth steps

Supabase → **Authentication** → **URL Configuration**. Manual dashboard change;
nothing in this repository connects to Supabase to do it.

| Setting | Value |
|---|---|
| Site URL | `https://portal.blessedfaithacademy.com` |
| Redirect URLs | `https://portal.blessedfaithacademy.com/**` |
| Redirect URLs (keep during cutover) | `https://bfa-sms-staging.nasalifya007.workers.dev/**` |
| Redirect URLs (local development) | `http://localhost:3000/**` |

Additional callback paths actually used by the application:

| Path | Purpose |
|---|---|
| `/auth/reset-password` | Password-reset landing page (the only `redirectTo` the app sends) |

There is no OAuth provider, magic-link flow, or third-party callback configured,
so no provider-specific callback URL needs updating.

Also confirm, unchanged:

- Public email signup remains **OFF**.
- Email templates use the Supabase-provided link variables (no hardcoded host).

Remove the workers.dev redirect entry only after the portal domain has been
verified and no reset emails from the old build remain in flight (reset links
expire quickly; one day is comfortable).

## Ordered cutover checklist

1. [ ] Zone `blessedfaithacademy.com` active in Cloudflare
2. [ ] Custom domain `portal.blessedfaithacademy.com` attached to `bfa-sms-staging`
3. [ ] Certificate shows **Active**
4. [ ] `https://portal.blessedfaithacademy.com/api/health` returns 200
5. [ ] Worker runtime + build variables updated (`NEXT_PUBLIC_SITE_URL`)
6. [ ] GitHub Environment secret `NEXT_PUBLIC_SITE_URL` updated
7. [ ] GitHub repository variables `PUBLIC_APP_URL`, `ADDITIONAL_TRUSTED_HOSTS` set
8. [ ] Supabase Site URL + Redirect URLs updated
9. [ ] Deploy staging run completed successfully after the variable change
10. [ ] Password-reset email received on the portal host
11. [ ] Apex domain still **not** pointed at the Worker
12. [ ] `ADDITIONAL_TRUSTED_HOSTS` cleared once the old hostname is retired

## Post-deployment verification

Public (unauthenticated):

| Check | Expected |
|---|---|
| `GET https://portal.blessedfaithacademy.com/api/health` | 200, JSON with `status`, `applicationVersion`, `environment`, `commit` |
| `GET https://portal.blessedfaithacademy.com/login` | 200 |
| `GET https://portal.blessedfaithacademy.com/dashboard` | 307 → `/login` |
| `GET https://portal.blessedfaithacademy.com/dashboard/examinations` | 307 → `/login` |
| `GET https://portal.blessedfaithacademy.com/robots.txt` | 200, `Disallow: /` |
| `commit` in health | matches the deployed commit |

Authenticated (operator-owned):

| Check | Expected |
|---|---|
| Staff sign-in on the portal host | succeeds; session cookie set for the new host |
| Admin-triggered password reset | email link host is `portal.blessedfaithacademy.com`, path `/auth/reset-password` |
| Reset link completion | sets the new password and returns to login |
| Examinations / gradebook / results / report cards | load normally |
| Report-card print view | renders; links stay relative |

Sessions are cookie-bound to the hostname, so everyone signs in again after the
switch. This is expected, not a defect.

## Rollback checklist

The old hostname keeps serving the same Worker throughout, which makes rollback
cheap. No database action is ever part of a domain rollback.

1. Announce the fallback URL: https://bfa-sms-staging.nasalifya007.workers.dev
2. Revert `NEXT_PUBLIC_SITE_URL` to the workers.dev origin in the Worker
   variables, Worker build variables, and the GitHub Environment secret.
3. Re-run **Deploy staging** so reset emails point back at the working host.
4. Revert Supabase **Site URL** to the workers.dev origin and keep its
   `/**` redirect entry.
5. Optionally detach the custom domain in Workers → Domains & Routes. Detaching
   removes the `portal` DNS record; the Worker itself is untouched.
6. Do **not** reset the database, revert migrations, or rebuild Worker history.

Application-level rollback (unrelated to DNS) remains the usual path: promote
the previous known-good Worker version for `bfa-sms-staging`.

## SEO boundary

The portal must never compete with, or stand in for, the public website.

Already enforced in the application:

- `src/app/robots.ts` serves `Disallow: /` for all agents on this origin, and
  `/robots.txt` is listed in the middleware public paths so crawlers receive the
  file itself rather than a redirect to `/login`.
- Root layout metadata sets `robots: { index: false, follow: false, nocache: true }`,
  so every page emits `noindex, nofollow`.
- `metadataBase` derives from `NEXT_PUBLIC_SITE_URL`, so no hostname is baked in.
- The root path `/` redirects to `/dashboard`, which redirects unauthenticated
  visitors to `/login` — there is no public marketing content to index.

Recommended for the separate public website project (not this repository):

- Own the apex and `www` records, canonical tags, sitemap, and OpenGraph assets.
- Link to the portal with a plain, `nofollow` "Staff login" link.
- Do not add the portal to the website's sitemap.

Optional hardening for this origin, if ever required: add a
`X-Robots-Tag: noindex, nofollow` response header at the Cloudflare edge. This
is not currently configured, and the meta-level controls above are sufficient.

---

# Cutover release record

**Date:** 2026-09-20 · **Outcome:** deployed successfully, no rollback.

## Commits

| Role | SHA | Message |
|---|---|---|
| Base before release | `6b486d81d37592b468ce2a88d0db554e4ae7a835` | docs(examinations): record examinations release |
| Domain release | `5dd7554f3c86fde0901ad1f6bb4f0c0d1d3ce96d` | feat(deployment): prepare portal custom domain |
| Hotfix | `123133326e443509d51dbde62d44c7231f38ed07` | fix(deployment): serve portal robots.txt without auth redirect |

Domain release: 11 files, +415 / −40. Hotfix: 1 file, +1 / −1.

## Validation

`npm run lint` pass (0 errors, 4 pre-existing warnings) · `npm test` **306
passed** · `npx tsc --noEmit` pass · `npm run build` pass · `npm run cf:build`
pass · `production-preflight --offline` PASSED (fail=0) · `phase2g-ops-verify`
PASSED · `examinations-integrity-verify --offline` PASSED (56 checks) ·
`git diff --check` clean. Re-run in full after the hotfix with identical results.

## Workflow runs

| Run | Commit | Started (UTC) | Completed (UTC) | Result |
|---|---|---|---|---|
| Deploy staging **#16** | `5dd7554` | 2026-09-20T16:32:34Z | 2026-09-20T16:38:07Z | success |
| Deploy staging **#17** | `1231333` | 2026-09-20T16:45:55Z | 2026-09-20T16:51:28Z | success |

Both runs: Phase 1 repository checks, Phase 2–3 Supabase migrations, Phase 4
staging verification (2B/2C/2D.1/2D.2), Phase 5 Cloudflare upload + promote to
100%, Phase 6 summary — all succeeded.

## Migrations

No migrations in this release. The migration gate ran and the apply step was a
safe no-op on both runs. No database reset; no migration history change.

## Portal verification (after run #17)

| Route | Result |
|---|---|
| `/` | 307 → `/login` |
| `/login` | 200 |
| `/api/health` | 200 |
| `/dashboard` | 307 → `/login` |
| `/dashboard/examinations` | 307 → `/login` |
| `/dashboard/gradebook` | 307 → `/login` |
| `/dashboard/results` | 307 → `/login` |
| `/dashboard/report-cards` | 307 → `/login` |
| `/dashboard/settings/system-health` | 307 → `/login` |
| `/robots.txt` | 200 — `User-Agent: * / Disallow: /` |

HTTPS negotiated with a valid certificate (default .NET chain validation). All
redirects are relative — none point at `workers.dev` or the apex domain. No
redirect loop, no 5xx, no OpenNext chunk error, no stack trace or secret in any
response. `/login` emits `<meta name="robots" content="noindex, nofollow, nocache">`.

## Deployment metadata

`GET https://portal.blessedfaithacademy.com/api/health`

```json
{
  "status": "ok",
  "applicationVersion": "0.1.0",
  "environment": "effective-production",
  "commit": "123133326e44"
}
```

Matches the hotfix commit `1231333`.

## Public website boundary

`blessedfaithacademy.com` does not resolve and is not routed to this Worker. The
application never claims the apex: the canonical origin comes only from
`NEXT_PUBLIC_SITE_URL`, and no apex reference appears in served HTML.

## Legacy Workers URL

`https://bfa-sms-staging.nasalifya007.workers.dev` remains reachable and healthy,
serving the same Worker and the same commit with identical relative redirects.
It is **temporary cutover support only** — not the canonical URL. Retire it by
clearing `NEXT_PUBLIC_ADDITIONAL_TRUSTED_HOSTS` and removing the workers.dev
entry from the Supabase redirect list once no reset links remain in flight.

## Password-reset domain verification

Verified statically and by unit test (21 assertions in
`password-reset-schemas.test.ts`):

- the configured portal origin is trusted and produces
  `https://portal.blessedfaithacademy.com/auth/reset-password`;
- the legacy Workers host is trusted **only** when explicitly allowlisted;
- arbitrary external hosts and forwarded headers are rejected;
- open redirects remain blocked (`safePostAuthPath`).

Live email verification is **pending — operator-owned**. The deployed value of
the `NEXT_PUBLIC_SITE_URL` secret cannot be read remotely, so the operator
should confirm one admin-triggered reset to an approved test account and check
that the link host is the portal.

## Authenticated smoke

**Pending — operator-owned.** No approved staff credentials were available, so
no authenticated journey was exercised. Staff will be signed out by the
hostname change and must sign in again; this is expected.

## Cloudflare

Worker remains `bfa-sms-staging`; no new Worker was created, no secret was
changed by this release, and the custom domain serves this Worker. Upload and
promotion to 100% succeeded on both runs, and the prior version remains
available for rollback.

## Known limitations

- Live password-reset email host unconfirmed (operator-owned).
- Authenticated portal smoke unconfirmed (operator-owned).
- The workers.dev hostname is still live and still trusted; clear it when retiring.
- The public website does not exist yet, so the apex is unresolved.
- A docs-only commit still retriggers the full Deploy staging workflow.

## Defect found and fixed during cutover

Run #16 deployed correctly, but `/robots.txt` returned `307 → /login` because
the auth middleware matcher intercepted it, which would have left crawlers
without a valid robots file. Adding `/robots.txt` to the middleware public paths
(commit `1231333`, run #17) fixed it; `/robots.txt` now returns 200 with
`Disallow: /`. No other defect was found.

## Rollback decision

**No rollback.** Portal resolves over HTTPS, authentication gates hold,
health reports the expected commit, the verifier chain passed, and the legacy
hostname remains as a fallback.
