# Password Reset Wrong-Account Security Fix

**System:** Blessed Faith Academy School Management System  
**Date:** 2026-07-23  
**Severity:** CRITICAL SECURITY DEFECT  
**Deploy status:** Code fix complete — **not deployed** in this phase (manual deploy required)

---

## Root cause

The reset page treated **any existing browser session** as sufficient to show the password form and call `supabase.auth.updateUser({ password })`.

When an administrator was already signed in and opened a staff recovery link (or landed on `/auth/reset-password` after a failed/partial recovery), the form could become “ready” against the **administrator session**. Submitting the new password then updated the **admin Auth user**, not the staff Auth user named in the email.

Contributing factors:

1. Fallback path: `getSession()` → if session exists → `setLinkState("ready")` (no recovery proof).
2. That check could win before / instead of establishing a recovery session from `code` / `token_hash` / hash tokens / `PASSWORD_RECOVERY`.
3. `updateUser` always mutates the **currently authenticated** Supabase user — so a leftover admin session was the wrong target.

Email delivery to the staff address was not the bug. Session targeting on the reset page was.

---

## Impact — was an administrator password changed?

**Unknown from code alone.** Any prior reset attempt in a browser that still held an administrator session **may** have changed that administrator’s password.

**Required operational follow-up (before or immediately after deploy):**

1. Do **not** re-test first with the real primary administrator account.
2. Use disposable admin + disposable staff Auth users for verification.
3. For any real administrator who may have opened a staff reset link while signed in: treat the account as potentially compromised/changed — set a known password via a controlled Admin Auth path or a fresh recovery link opened in a **private window**, then confirm sign-in.

Do not record actual passwords in tickets or this document.

---

## Staff ↔ Auth linkage

| Concept | Relationship in this codebase |
|---|---|
| Staff / profile ID | `profiles.id` |
| Auth user ID | `auth.users.id` |
| Linkage | **Same UUID:** `profiles.id === auth.users.id` (created via `auth.admin.createUser` then profile row with that id) |
| Email for reset | Taken from `admin.auth.admin.getUserById(staffId)` → `user.email` — **not** a free-text contact field alone |

`adminSendPasswordResetAction`:

- Requires active administrator.
- Loads `profiles` by `staffId`.
- Requires Auth user + email via service-role `getUserById`.
- If missing → returns account-not-activated message; does **not** pretend success.
- Sends `resetPasswordForEmail(authEmail, { redirectTo })` via the **service-role** client (server-only).
- Never calls `updateUser` from the staff dashboard.
- Never exposes the service-role key to the browser.

---

## Recovery mechanism used

Repository-native `@supabase/ssr` browser client (same stack as login). No competing auth architecture.

On `/auth/reset-password`:

1. Map Supabase error query params → clear expired/invalid message; scrub URL.
2. If URL has recovery credentials (`code`, `token_hash`+`type=recovery`, or recovery hash):
   - **`signOut({ scope: "local" })` first** — drop any admin/other session.
   - PKCE: `exchangeCodeForSession(code)`.
   - OTP: `verifyOtp({ type: "recovery", token_hash })` only.
   - Implicit: `setSession` from hash tokens, or wait for `PASSWORD_RECOVERY`.
3. Write short-lived **recovery proof** in `sessionStorage` (`bfa_pw_recovery_v1`: userId, email, establishedAt).
4. Show form only when proof matches `getUser()`.
5. Display masked target email from the recovery user (not a staff id query param).
6. On submit: gate again with proof → `updateUser({ password })` → audit → clear proof → `signOut({ scope: "global" })` → redirect `/login`.

Middleware already treats `/auth/*` as public (`src/lib/supabase/middleware.ts`).

---

## Stale-session protection

| Condition | Behaviour |
|---|---|
| Ordinary admin/staff session, no recovery credential, no proof | Form blocked (`stale_session_not_recovery`) |
| Session user ≠ recovery proof user | Rejected |
| Expired proof (> 2 hours) | Rejected |
| `updateUser` without valid proof | Blocked client-side |
| Non-recovery OTP types in URL | Not treated as recovery credentials |
| Success | Recovery session signed out; admin session is **not** restored |

---

## Files changed

| File | Change |
|---|---|
| `src/features/auth/password-recovery.ts` | **New** — URL signal parsing, recovery proof, present/update gates |
| `src/features/auth/password-recovery.test.ts` | **New** — focused security unit tests |
| `src/features/auth/components/reset-password-form.tsx` | Sign out before recovery; require proof; masked email; gated `updateUser` |
| `src/features/auth/password-reset-actions.ts` | Account-not-activated message; send reset via service-role client |
| `docs/PASSWORD_RESET_WRONG_ACCOUNT_SECURITY_FIX.md` | This report |

No finance / student / attendance / academic modules modified.

---

## Tests added

`src/features/auth/password-recovery.test.ts` covers:

- Ordinary authenticated session insufficient to present reset form
- Recovery proof required for `updateUser` gate
- Session / proof user mismatch rejected
- Expired proof rejected
- PKCE / token_hash / hash credential detection
- Bare URL has no recovery credential
- Masked email helper

Existing redirect/OTP tests in `password-reset-schemas.test.ts` remain.

---

## Repository verification results

| Command | Result |
|---|---|
| `npm run lint` | Pass (0 errors; pre-existing unrelated warnings) |
| `npm test` | Pass — **106** tests |
| `npm run build` | Pass |
| `npm run cf:build` | Pass |

---

## Manual test results

**Not executed in this phase** (requires disposable Auth users + live email / Supabase project). After deploy, run:

1. Disposable admin logged in → open staff recovery link in same browser → confirm admin password unchanged; staff password updated only after recovery session; UI shows masked staff email.
2. Staff link in private window → staff password updates.
3. Different staff already logged in → existing session cannot change that account without recovery credentials for that user.
4. Expired / reused link → no update; clear message.
5. Staff profile without Auth user → admin action shows account-not-activated message.
6. Record (no secrets): admin Auth user id, staff Auth user id, which email received the link, recovery-established user id, which account accepted the new password.

---

## Deployment requirements

1. Deploy this build to the target Worker/environment (**manual** — do not auto-deploy from this task).
2. Ensure Worker build-time `NEXT_PUBLIC_SITE_URL` is the public app origin (not localhost).
3. After deploy, run the disposable-account manual matrix above.
4. Re-secure any real administrator who may have been affected by prior attempts.

---

## Supabase configuration requirements

**Authentication → URL configuration**

- Site URL = public app origin (e.g. staging Worker URL).
- Redirect allowlist includes `{origin}/auth/reset-password`.

**Email Templates → Reset password**

- Use `{{ .ConfirmationURL }}` (or equivalent); do not hardcode localhost.

Do not weaken OTP expiry or one-time-use settings.

---

## Verdict

Code and automated verification for account-targeting are complete. Manual disposable-account confirmation remains a deploy-time checklist item; prior possible admin password change must be treated as an incident follow-up.
