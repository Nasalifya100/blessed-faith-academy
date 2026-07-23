# Password Reset Fix Report

**System:** Blessed Faith Academy School Management System  
**Date:** 2026-07-23  
**Deployed app:** https://bfa-sms-staging.nasalifya007.workers.dev  
**Status:** Code fix complete — **deploy required** (not deployed in this phase)

---

## Root cause

Two compounding issues caused `http://localhost:3000/auth/reset-password?error=access_denied&error_code=otp_expired…`:

1. **Wrong `redirectTo` in reset emails**  
   `adminSendPasswordResetAction` called `resetPasswordForEmail` with `getPasswordResetRedirectUrl()`, which reads `NEXT_PUBLIC_SITE_URL`.  
   Local `.env.local` (and any Worker built from it) used:

   `NEXT_PUBLIC_SITE_URL=http://localhost:3000`

   So emails pointed staff to localhost instead of the staging Worker. Supabase then completed (or failed) the recovery against that URL.

2. **Expired / invalid OTP presentation**  
   When Supabase redirected with `error=access_denied&error_code=otp_expired`, the reset page did not map those query params to a clear message (and left noisy URL state). Old or already-consumed one-time links correctly fail; the UI now explains that safely.

`docs/OPERATIONS.md` previously claimed `NEXT_PUBLIC_SITE_URL` was unused — that was outdated and has been corrected.

---

## Files changed

| File | Change |
|---|---|
| `src/lib/site-url.ts` | Allowlisted request-origin redirect; reject localhost in production; OTP error message helpers |
| `src/features/auth/password-reset-actions.ts` | Resolve `redirectTo` from trusted `x-forwarded-*` / `host` when present |
| `src/features/auth/components/reset-password-form.tsx` | Handle `error`/`otp_expired`, PKCE `code`, `token_hash`+`verifyOtp`, scrub URL, clearer errors/success |
| `src/features/auth/password-reset-schemas.test.ts` | Expanded redirect + error tests |
| `docs/OPERATIONS.md` | Document `NEXT_PUBLIC_SITE_URL` correctly |
| `docs/PASSWORD_RESET_FIX_REPORT.md` | This report |

No finance / student / attendance / academic modules were modified.

---

## Callback / session flow (repository-native)

Uses existing `@supabase/ssr` browser client (same as login). No second auth stack.

Order on `/auth/reset-password`:

1. If URL has Supabase error params → show invalid/expired message; scrub query.  
2. If `?code=` → `exchangeCodeForSession(code)` (PKCE).  
3. If `?token_hash=` + `type=` → `verifyOtp({ type, token_hash })`.  
4. Else if session already present → ready.  
5. Else if hash contains recovery tokens → brief wait + `getSession()`.  
6. Else → invalid link message.  
7. On submit → `updateUser({ password })` → audit → `signOut` → success → `/login`.

Middleware already treats `/auth/*` as public (`src/lib/supabase/middleware.ts`).

---

## Supabase Dashboard configuration required

Confirm in **Authentication → URL configuration**:

**Site URL**

```text
https://bfa-sms-staging.nasalifya007.workers.dev
```

**Redirect URLs** (exact entries recommended)

```text
https://bfa-sms-staging.nasalifya007.workers.dev/auth/reset-password
http://localhost:3000/auth/reset-password
```

Optional: a carefully scoped wildcard such as `https://bfa-sms-staging.nasalifya007.workers.dev/**` only if already used intentionally — prefer exact paths for recovery.

**Email template**

In **Authentication → Email Templates → Reset password**, ensure the CTA uses the Supabase template variable (e.g. `{{ .ConfirmationURL }}`) and does **not** hardcode `http://localhost:3000`.

Do not weaken OTP expiry or one-time-use settings.

---

## Environment variables required

| Variable | Local | Cloudflare Worker (runtime + build) |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` | `https://bfa-sms-staging.nasalifya007.workers.dev` |
| `NEXT_PUBLIC_SUPABASE_URL` | staging project | same |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | staging anon | same |
| `SUPABASE_SERVICE_ROLE_KEY` | secret (server only) | Cloudflare **Secret** only |

**Deploy note:** Before `npm run deploy` from a machine whose `.env.local` still has localhost, either:

- temporarily set `NEXT_PUBLIC_SITE_URL` to the staging origin for that build, **or**
- rely on the new allowlisted request-origin path (admin must trigger reset from the staging host) **and** keep the Cloudflare dashboard variable set correctly for fallback.

Never put the service-role key in `NEXT_PUBLIC_*`.

---

## Tests run

| Command | Result |
|---|---|
| `npm test` | **Pass** — 93 tests |
| `npm run lint` | **Pass** — 0 errors (4 pre-existing warnings) |
| `npm run build` | **Pass** |
| `npm run cf:build` | **Pass** |

Covered: production redirect, local redirect, no localhost in production without trusted origin, OTP error mapping, open-redirect blocking, password mismatch schema.

---

## Manual verification steps (after deploy + dashboard check)

1. Confirm Supabase Site URL + Redirect URLs as above.  
2. Confirm Cloudflare `NEXT_PUBLIC_SITE_URL` = staging origin.  
3. Deploy this build to `bfa-sms-staging`.  
4. As Administrator on **staging**, Staff → send password reset for a test staff user.  
5. Open the email link — host must be `bfa-sms-staging.nasalifya007.workers.dev`, path `/auth/reset-password`.  
6. Set a new password → success message → land on `/login` → sign in works.  
7. Re-open the **same** email link → clear “invalid or expired” message (one-time OTP).  
8. Optionally repeat from local `next dev` and confirm localhost redirect only when using local admin session.

---

## Deployment required?

**Yes.** The fix is in application code and must be deployed to Cloudflare for staging emails to stop pointing at localhost. Dashboard Auth URL settings must also match.

**Not done in this phase:** deploy, commit, push.

---

## Verdict

# PASSWORD RESET FIX READY TO DEPLOY

Application redirect generation, OTP/error handling, and tests are in place. Complete the Supabase Auth URL checklist, ensure Cloudflare `NEXT_PUBLIC_SITE_URL` is the staging origin, then deploy and run the manual verification steps above.
