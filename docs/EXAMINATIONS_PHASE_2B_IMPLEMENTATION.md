# Examinations Phase 2B — Assessment & Examination Setup

**System:** Blessed Faith Academy School Management System  
**Date:** 2026-07-23  
**Depends on:** Phase 2A academic foundations (deployed)  
**Marks entry:** Not implemented (Phase 2C)

---

## Scope

Phase 2B lets schools **prepare examinations** without recording scores:

1. Exam periods (named sitting windows)
2. Exams (subject × grade × assessment type × max marks)
3. Optional reusable templates + copy previous period
4. Exam schedule (date/time/room/invigilators)
5. Lightweight room catalogue
6. Students taking this exam = whole grade or class + optional exclusions
7. Optional exam instructions
8. Teacher “Upcoming exams” view
9. Printable A4 timetables
10. Conflict detection with how-to-fix guidance
11. Bulk date/room/archive tools
12. Audit events + capability-gated RPCs

**Not included:** marks entry, gradebook, report cards, rankings, promotion, parent portal score views.

---

## Architecture

| Layer | Choice |
|---|---|
| UI language | Exam Period, Exam, Exam Schedule, Students Taking This Exam |
| Tables | `exam_periods`, `exams`, `exam_schedules`, `exam_rooms`, `exam_invigilators`, `exam_exclusions`, `exam_templates`, `exam_template_items` |
| Writes | SECURITY DEFINER RPCs only |
| Reads | RLS + `EXAM_VIEW` (teachers/office) |
| Audit | `log_academic_event` into `academic_event_audits` |
| Capabilities | Extended `has_academic_capability` |

Default cohort: **everyone in grade** (or class). Exclusions are advanced exceptions only. No per-student mark rows.

---

## Migrations (apply in order)

1. `20260723130000_exam_rooms_and_capabilities.sql`
2. `20260723130100_exam_periods_exams_schedules.sql`
3. `20260723130200_exam_setup_rpcs.sql`
4. `20260723130300_exam_references_and_status_workflow.sql` — **polish** (references + lifecycle)

Apply in the Supabase SQL Editor (staging first), full file contents, in order.

---

## Exam references

**Format:** `EX-{YEAR}-{TERM_CODE}-{SEQ4}`

Examples:

- `EX-2026-T1-0001`
- `EX-2026-T2-0003`
- `EX-2026-TY-0001` (no term on the exam period)

| Part | Source |
|---|---|
| `YEAR` | First 4-digit year found in `academic_years.name` (fallback: sanitized label) |
| `TERM_CODE` | `T` + `terms.term_number` (1–4), or `TY` when term is null |
| `SEQ4` | Zero-padded counter per **school + academic year + term_code** |

**Safety:**

- Allocated only in Postgres via `allocate_exam_reference` (upsert counter row)
- Unique `(school_id, exam_reference)`
- Immutable after create (updates never rewrite the reference)
- Copy/template paths allocate **new** references and start as **Draft**
- Gaps after deletes are expected; numbers are never reused

Displayed as **Exam reference** on lists, schedule, upcoming, print, and audits. UUIDs are never shown.

---

## Exam status workflow

User-facing statuses (enum `exam_lifecycle_status`):

| Status | Meaning |
|---|---|
| Draft | Created; schedule may be incomplete |
| Scheduled | Valid date/time; schedule checks passed |
| Ready | Room + primary invigilator + cohort ready |
| Completed | Sitting done; eligible for Phase 2C marks later |
| Archived | Historical; hidden from normal active use |

Normal path: Draft → Scheduled → Ready → Completed → Archived.

Backward moves allowed with **reason** from Ready / Completed / Archived.

Status changes use explicit buttons (not a free-form select). Blockers return plain-language missing items with links to the schedule screen.

**Exam period** statuses remain Draft / Open / Completed (DB `CLOSED`) / Archived — separate from individual exam lifecycle.

---

## Capabilities

| Capability | Administrator | Headteacher | Teacher / secretary / bursar |
|---|---|---|---|
| `EXAM_VIEW` | ✓ | ✓ | ✓ |
| `EXAM_ROOMS_MANAGE` | ✓ | ✓ | — |
| `EXAM_PERIODS_MANAGE` | ✓ | ✓ | — |
| `EXAMS_MANAGE` | ✓ | ✓ | — |
| `EXAM_SCHEDULE_MANAGE` | ✓ | ✓ | — |
| `EXAM_TEMPLATES_MANAGE` | ✓ | ✓ | — |

Teachers are **read-only** for setup; they see **Upcoming exams** for invigilation assignments.

---

## Key RPCs

- `upsert_exam_room`, `list_exam_staff_candidates`
- `upsert_exam_period`, `duplicate_exam_period`, `set_exam_period_status`
- `upsert_exam`, `upsert_exam_schedule`
- `allocate_exam_reference` (internal), `transition_exam_status`, `exam_status_blockers`
- `detect_exam_schedule_conflicts`
- `upsert_exam_exclusion`, `remove_exam_exclusion`
- `save_exam_template_from_period`, `apply_exam_template`
- `bulk_shift_exam_dates`, `bulk_assign_room_to_period`, `bulk_archive_closed_exam_periods`

---

## Conflict rules

Warnings include actionable **How to fix** text for:

- Teacher double-booked
- Room double-booked
- Grade has two exams at the same time
- Exam outside period dates
- End before start
- Inactive teacher / room / subject

Hard blocks reject invalid duration and inactive entities. Soft clashes can be confirmed with “Save anyway”.

---

## Routes

| Route | Purpose |
|---|---|
| `/dashboard/examinations` | Exam periods hub |
| `/dashboard/examinations/periods/new` | Create exam period |
| `/dashboard/examinations/periods/[id]` | Exams, templates, copy |
| `/dashboard/examinations/periods/[id]/schedule` | Calendar + table + assign |
| `/dashboard/examinations/rooms` | Room catalogue |
| `/dashboard/examinations/upcoming` | Teacher-friendly list |
| `/dashboard/examinations/print` | Printable timetable filters |

Nav: **Examinations** for admin, headteacher, teacher, secretary, bursar.

---

## Template system

Optional productivity helpers:

- **Save as template** from an exam period (subjects, types, max marks, duration/room hints, instructions)
- **Apply template** into another period (skips duplicates)
- **Copy exam period** (“Copy last term”) with optional exam and schedule copy

---

## Printing

- School name / motto / address / phone header
- A4 via browser print (`window.print` + existing `@page` margins)
- Filters: entire period, grade, room
- Includes exam instructions when present

---

## Mobile UX

- Upcoming exams as stacked cards (subject, date, time, room)
- Large controls (`h-11`)
- Schedule table scrolls horizontally on small screens; calendar list does not require side scroll

---

## Audit events

`EXAM_PERIOD_CREATED`, `EXAM_CREATED`, `EXAM_UPDATED`, `EXAM_REFERENCE_ASSIGNED`, `TIMETABLE_UPDATED`, `INVIGILATOR_ASSIGNED`, `ROOM_ASSIGNED`, `EXAM_TEMPLATE_USED`, `EXAM_PERIOD_ARCHIVED`, `EXAM_MARKED_SCHEDULED`, `EXAM_MARKED_READY`, `EXAM_MARKED_COMPLETED`, `EXAM_ARCHIVED`, `EXAM_RETURNED_TO_DRAFT`, `EXAM_REOPENED`, `EXAM_STATUS_CHANGED`

Status audits include exam reference, previous/new status, actor, reason when required.

---

## Known limitations

- Exclusion editing is collapsed under “Advanced”; default remains whole grade/class.
- Invigilator listing uses profiles (no Auth emails required).
- No marks / assessment_results tables.
- Supabase TypeScript types not regenerated (RPC calls loosely typed).
- Migrations must be applied manually in the SQL Editor (no `DATABASE_URL` in local env).
- Polish migration `20260723130300` must be applied before references/status workflows work on staging.

---

## Verification checklist

1. Create Mid-Term exam period  
2. Add Grade 7 Mathematics exam (50 marks) — confirm auto **Exam reference**  
3. Confirm duplicate subject/type in same period is rejected  
4. Save template / apply template — new references, Draft status  
5. Copy period — new references, Draft status  
6. Assign room + primary invigilator  
7. Draft → Scheduled → Ready → Completed → Archived  
8. Invalid backward transition without reason denied  
9. Trigger room/teacher conflict and confirm fix text  
10. Print timetable shows references  
11. Teacher sees Upcoming exams; cannot create periods  
12. Confirm audit rows; confirm no score fields anywhere  

Repository checks for this phase:

- `npm test` — **124** passed  
- `npm run lint` — 0 errors  
- `npm run build` — pass (examinations routes present)  
- `npm run cf:build` — pass  

---

## Next phase

**Phase 2C — Teacher Gradebook** introduces marks entry against these exams/assessments. Do not enable scoring until Phase 2B is deployed and verified.
