# Phase 2D.2 — Report Cards and Result Publishing

## Scope

Phase 2D.2 builds official report cards, approval, publication, and print workflows on top of **Phase 2D.1 academic result snapshots**.

It does **not**:

- calculate averages, grades, rankings, or promotion recommendations
- read DRAFT / REOPENED gradebooks as academic sources
- invent marks when snapshots are missing
- deliver parent/student portals, email, SMS, WhatsApp, or public links
- auto-promote students or produce multi-year transcripts

## Authoritative source rule

Phase 2D.1 remains the only authoritative calculation engine.

Report cards consume persisted snapshots for:

- subject results, marks, percentages, grades, grade points
- totals, averages, rankings, statistics
- promotion recommendations
- source fingerprints, engine version, stale state

Draft generation and approval fail closed when:

- snapshots are missing
- snapshots are stale / gradebooks drifted
- class fingerprints / computation batches are incoherent
- engine version mismatches `RESULTS_ENGINE_VERSION`

## Lifecycle

Statuses:

`DRAFT → REVIEWED → APPROVED → PUBLISHED`

Also:

- `PUBLISHED ↔ UNPUBLISHED`
- `DRAFT | REVIEWED | APPROVED | UNPUBLISHED → VOIDED`
- `VOIDED` is terminal

Published academic content is never edited silently. Corrections require unpublish (then re-approve) or void + regenerate.

## Permissions (defaults)

| Capability | Teacher | Head | Admin | Secretary | Bursar |
|---|---|---|---|---|---|
| VIEW | yes (scoped) | yes | yes | no | no |
| VIEW_ALL | no | yes | yes | no | no |
| EDIT_REMARKS | yes | yes | yes | no | no |
| REVIEW | no | yes | yes | no | no |
| APPROVE | no | yes | yes | no | no |
| PUBLISH | no | yes | yes | no | no |
| PRINT | yes | yes | yes | no | no |
| SETTINGS_MANAGE | no | yes | yes | no | no |

Teachers generate drafts only for classes they can view via results scope helpers.

## Database design

Additive migrations:

1. `20260728160000_report_cards_enums_and_tables.sql`
2. `20260728160100_report_cards_capabilities.sql`
3. `20260728160200_report_cards_rpcs.sql`

Tables:

- `report_card_settings` — school template defaults
- `student_report_cards` — one row per student×year×term×class
- `report_card_events` — publication/approval history

Immutable publication fields on `student_report_cards`:

- `render_payload` + `render_payload_checksum` (frozen on approve)
- source fingerprint / engine version / computation batch / term snapshot id
- attendance + settings snapshots captured at draft generation
- remarks preserved; locked after approval/publication

Clients receive **SELECT only**. All mutations go through SECURITY DEFINER RPCs.

## Immutable publication snapshot

On approve, the server builds a render payload from:

- Phase 2D.1 subject + term snapshots (current fingerprint only)
- attendance snapshot already stored on the card
- remarks at approval time
- school identity / signatory names / grading key / settings

The RPC independently validates student, class, fingerprint, and required payload fields before freezing.

Later changes to logo, scheme, remarks, attendance, or recalculated results **do not** alter approved/published payloads.

## Source readiness and stale blocking

Class readiness counts:

- eligible students
- results ready / missing / stale
- draft / reviewed / approved / published / outdated

UI and actions block generate/approve/publish when results are stale or fingerprints diverge. Drafts whose fingerprint no longer matches live term snapshots are treated as outdated (read-time comparison).

## Attendance policy

Source: `attendance_records` for student + class between term `start_date` and `end_date`.

- Missing term dates → unavailable
- Zero registers → unavailable (“Not available”), never fake 0%
- Rate = `(present + late) / total * 100`
- Summary is frozen into the card at draft generation and copied into the approve payload

## Remarks policy

- Class teacher remark + head teacher remark
- Plain text, max 2000 chars, HTML stripped server-side
- Optional required remarks via settings (`require_*`)
- Locked for APPROVED / PUBLISHED / VOIDED

## Template and print strategy

One A4 portrait HTML template (`ReportCardDocument`) with `@media print`.

Routes:

- `/dashboard/report-cards`
- `/dashboard/report-cards/[reportCardId]`
- `/dashboard/report-cards/[reportCardId]/print`
- `/dashboard/report-cards/print` (bulk approved/published)
- `/dashboard/settings/report-cards`

No Chromium PDF binary on Cloudflare Workers. Browser print-to-PDF is the supported export path.

Print pages render from `render_payload` only (never live recalculation).

## Batch workflow

Class workspace: filter year → term → class → readiness → generate drafts → review students → approve → publish → print.

Bulk print excludes draft-only cards and warns when empty.

## Audit

`report_card_events` + `log_academic_event` for:

- draft generated
- remarks changed
- reviewed / approved / published / unpublished / voided
- settings changed

Metadata includes status transitions, fingerprint, checksum — not full subject payloads or private student data dumps.

## Security and concurrency

- RLS enabled; SELECT-only grants
- RPCs require `auth.uid()`, capability checks, school scope, `FOR UPDATE`, `p_expected_revision`
- fixed `search_path = public`
- revoke PUBLIC; grant EXECUTE to authenticated only

## CI verification

Staging workflow order (after migrations):

Phase 2B → Phase 2C → Phase 2D.1 → **Phase 2D.2** → build → Worker upload → promote

Verifier: `node scripts/phase2d2-report-cards-verify.cjs` (offline + online structural; no fixtures).

## Known limitations

- Teacher scope depends on existing class-results helpers / assignments
- No digital ink signatures (text signature lines only)
- No parent/student portal delivery in this phase
- Settings changes affect future drafts only

## Deferred

Parent/student portals, email/SMS/WhatsApp, public links, transcripts, cumulative multi-year reports, automated promotion enrolment, external certificate signatures, report-access payments.
