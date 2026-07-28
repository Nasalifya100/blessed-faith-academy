# Phase 2D.2 — Pre-Commit Architecture Review

**Date:** 2026-07-28
**Repository:** `C:\Users\nasa\Documents\GitHub\blessed-faith-academy`
**Scope:** Report Cards and Result Publishing
**Constraint:** No commit, push, migration apply, or deploy performed by this review.

---

## Authoritative data flow

```
Phase 2D.1 student_*_result_snapshots (fingerprinted, engine-versioned)
  → generate_or_refresh_report_card_draft
       · validates term snapshot ownership + fingerprint + batch + engine
       · assert SUBMITTED/LOCKED gradebook revisions still match
       · rebuilds attendance from attendance_records (ignores client JSON)
       · loads settings from report_card_settings (ignores client JSON)
  → remarks / review RPCs (revision-locked)
  → approve_report_card
       · rebuilds academic checks against live Phase 2D.1 rows
       · rejects forged averages / subjects / remarks / attendance
       · freezes render_payload + checksum
  → publish_report_card (requires immutable payload; does not recalculate)
  → print routes render render_payload only
```

Browsers never supply authoritative academic totals. Approval regenerates the document from server-loaded Phase 2D.1 snapshots and the RPC re-validates every academic field.

---

## Defects found and fixed in this review

1. **Client attendance/settings trusted on generate** — RPC now rebuilds both server-side; client args ignored.
2. **Approve accepted forged academic JSON** — RPC now compares summary + every subject row + remarks + attendance to Phase 2D.1 / card state.
3. **Gradebook drift not enforced on approve/review** — shared `report_card_assert_results_current` helper.
4. **Remarks HTML only stripped in TypeScript** — SQL `report_card_sanitize_remark`.
5. **Publish did not verify approved fingerprint integrity** — now checks payload fingerprint + checksum length.
6. **Settings nav gated on approve instead of SETTINGS_MANAGE** — fixed.
7. **Bulk print ordering unstable** — sorted by student name.
8. **Action feedback not announced** — `role="status"` / `role="alert"` + `aria-live`.

---

## Security checklist (RPC)

| RPC | auth.uid | capability | search_path | FOR UPDATE / lock | revision | PUBLIC revoked |
|---|---|---|---|---|---|---|
| ensure_report_card_settings | yes | VIEW/VIEW_ALL/SETTINGS | public | n/a | n/a | yes |
| generate_or_refresh_report_card_draft | yes | VIEW_ALL/APPROVE or scoped VIEW | public | advisory + row | increments | yes |
| save_report_card_remarks | yes | EDIT_REMARKS (+ head gate) | public | FOR UPDATE | yes | yes |
| mark_report_card_reviewed | yes | REVIEW/APPROVE | public | FOR UPDATE | yes | yes |
| approve_report_card | yes | APPROVE | public | FOR UPDATE | yes | yes |
| publish / unpublish | yes | PUBLISH | public | FOR UPDATE | yes | yes |
| void_report_card | yes | APPROVE/PUBLISH | public | FOR UPDATE | yes | yes |
| update_report_card_settings | yes | SETTINGS_MANAGE | public | n/a | n/a | yes |

Internal helpers are revoked from `public, anon, authenticated`.

---

## Validation

```bash
npm run lint
npm test
npx tsc --noEmit
npm run build
node scripts/phase2d2-report-cards-verify.cjs --offline
git diff --check
```

Ready for commit only after human approval of this review.
