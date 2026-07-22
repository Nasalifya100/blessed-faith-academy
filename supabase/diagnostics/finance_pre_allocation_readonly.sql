-- Read-only finance diagnostics (prefer RPC after Stage A migrations).
--
-- After applying 20260719150000 + 20260719150010:
--
--   select public.diagnose_finance_pre_allocation();
--
-- Or in SQL console as privileged role for a specific school:
--
--   select public.diagnose_finance_pre_allocation_for_school('<school-uuid>');
--
-- Do NOT run backfill from this file.
-- Live production results are only valid after this query is executed and reviewed.

select public.diagnose_finance_pre_allocation();
