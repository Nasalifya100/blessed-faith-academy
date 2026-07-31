# Phase 2G — Incident Response Playbooks

Live URL: https://bfa-sms-staging.nasalifya007.workers.dev  
Worker: `bfa-sms-staging` (effective production)

General rules for every incident:

1. Preserve evidence (timestamps, actor ids, correlation/incident refs, Actions run URLs).
2. Prefer containment over irreversible “fixes”.
3. Never paste service-role keys, cookies, or full mark/report payloads into tickets.
4. Check `/api/health` and System Health for release identity first.

---

## 1. User cannot log in

**Symptoms:** Redirect loop to `/login`, invalid credentials, deactivated message.  
**First checks:** `/api/health`; Supabase Auth status; profile `is_active`; correct site URL.  
**Diagnostics:** Confirm email exists; check `password_reset_audits`; browser cookies for project.  
**Containment:** Disable suspected compromised accounts (`is_active=false`).  
**Recovery:** Admin password reset email; verify `NEXT_PUBLIC_SITE_URL`.  
**Never:** Reset DB; disable Auth entirely; share temporary passwords in WhatsApp without out-of-band confirm.

## 2. Teacher cannot enter marks

**Symptoms:** Gradebook read-only / marks window errors.  
**First checks:** Exam status Completed; marks-entry window; gradebook DRAFT/REOPENED; teacher assignment; `is_active`.  
**Diagnostics:** Gradebook status + revision; capability `GRADEBOOK_*`; academic audits.  
**Containment:** Stop bulk reopen storms; use single reopen with reason.  
**Recovery:** Authorized reopen; fix assignment; wait for window.  
**Never:** Direct SQL update of marks bypassing RPCs.

## 3. Result recalculation fails

**Symptoms:** Results action error / incomplete snapshots.  
**First checks:** Source gradebooks SUBMITTED/LOCKED; engine version; System Health DB checks.  
**Diagnostics:** Incident ref from UI; academic_event_audits; RPC error category only.  
**Containment:** Pause class-wide recalc; limit to one class.  
**Recovery:** Fix source gradebooks; retry bounded recalc.  
**Never:** Invent a second calculation path in the client.

## 4. Report card will not approve

**Symptoms:** Approve rejected; checksum/fingerprint errors.  
**First checks:** Snapshot freshness vs 2D.1; card status DRAFT/REVIEWED; capabilities.  
**Diagnostics:** `report_card_events`; gradebook drift helper outcomes.  
**Containment:** Do not publish.  
**Recovery:** Regenerate from snapshots; re-review; approve.  
**Never:** Manually edit `render_payload` in SQL.

## 5. Report card published incorrectly

**Symptoms:** Wrong remark/content live.  
**First checks:** Publication event actor/time; payload checksum.  
**Containment:** Unpublish immediately (authorized).  
**Recovery:** Void/regenerate per lifecycle rules; notify affected staff.  
**Evidence:** report_card_events + academic audits.  
**Never:** Delete published rows.

## 6. Payment recorded incorrectly

**Symptoms:** Wrong amount/student/allocation.  
**First checks:** Fee statement; finance_event_audits; payment status.  
**Containment:** Stop further allocations; void via supported RPC if appropriate.  
**Recovery:** Correcting payment per finance runbook; never “edit amount” in place.  
**Never:** Delete payment rows; disable finance audits.

## 7. Worker deployment fails

**Symptoms:** Actions deploy job red; site old/new mismatch.  
**First checks:** GitHub Actions log; Cloudflare observability; `/api/health` commit.  
**Containment:** Do not re-run migrations blindly.  
**Recovery:** Fix build; redeploy; or promote previous Workers version.  
**Never:** Force-push; `--no-verify`; apply unrelated migrations “to unblock”.

## 8. Database migration fails

**Symptoms:** `supabase db push` error; history gate fail.  
**First checks:** `migration list`; preflight script; backup confirmation.  
**Containment:** Halt deploy; keep Worker on last good version.  
**Recovery:** Fix forward-only migration; never rewrite applied history on live.  
**Never:** Repair live history casually; drop tables to clear errors.

## 9. Database unavailable

**Symptoms:** Health Unavailable; app errors dependency.  
**First checks:** Supabase status; health page; Cloudflare.  
**Containment:** Pause fee posting / publishing; communicate downtime.  
**Recovery:** Wait for platform; restore only per backup drill to disposable first.  
**Never:** Point Worker at a random other project without auth URL updates.

## 10. Suspected unauthorized access

**Symptoms:** Unexpected role changes, voids, publishes.  
**First checks:** Audit log UI; staff activation; recent password resets.  
**Containment:** Deactivate suspect accounts; rotate affected passwords; revoke sessions if available in Auth admin.  
**Recovery:** Revert business actions via supported workflows; preserve audits.  
**Evidence:** Export audit ids + timestamps (not full PII payloads).  
**Never:** Wipe audits.

## 11. Deleted/archived student error

**Symptoms:** Missing student; enrolment blocked.  
**First checks:** Student status; archive flags; enrolment rows.  
**Containment:** Stop duplicate re-enrolment.  
**Recovery:** Unarchive via supported flow if available; else admin SQL with ticket.  
**Never:** Recreate duplicate admission numbers.

## 12. Backup restore required

**Symptoms:** Corruption / catastrophic loss.  
**First checks:** Confirm blast radius; RPO needs; available backups.  
**Containment:** Freeze writes; snapshot current broken state if possible.  
**Recovery:** Follow `PHASE_2G_BACKUP_AND_RESTORE.md` disposable drill, then approved live restore with dual operator sign-off.  
**Never:** Restore directly onto live without rehearsal when avoidable.
