# Custom Domain Deployment — portal.blessedfaithacademy.com

Preparation runbook for moving the School Management System from the Cloudflare
Workers hostname to a permanent custom domain.

**Nothing in this document has been executed.** No DNS record, Cloudflare
setting, or Supabase setting was changed by the preparation work.

## Target architecture

| Property | Value |
|---|---|
| Cloudflare Worker (unchanged) | `bfa-sms-staging` |
| Current URL | https://bfa-sms-staging.nasalifya007.workers.dev |
| Future School Management System | https://portal.blessedfaithacademy.com |
| Future public website | https://blessedfaithacademy.com (separate site, not this Worker) |
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

- `src/app/robots.ts` serves `Disallow: /` for all agents on this origin.
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
