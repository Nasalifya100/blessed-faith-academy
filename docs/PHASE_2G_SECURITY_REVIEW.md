# Phase 2G — Security Review

Focused review for the live `bfa-sms-staging` + single Supabase stack. No destructive penetration testing was performed.

## Environment note

The Worker and GitHub Environment are labeled **staging** but carry real school operations. Treat secrets, RLS, and audit integrity as production-grade.

## Findings

| ID | Risk | Severity | Status |
|---|---|---|---|
| S-01 | Staging/production naming confusion leading to unsafe operator actions | High | Documented; Recommendation A |
| S-02 | No public health / release identity for incident triage | High | Fixed — `/api/health` + metadata |
| S-03 | No dedicated audit review UI | Medium | Fixed — `/dashboard/settings/audit-log` |
| S-04 | Some server actions still return raw provider messages | Medium | Partial — shared `normalizeOpsError`; gradual adoption |
| S-05 | No application rate limits | Medium | Partial — per-actor limits with school-safe floors; fail-open documented |
| S-06 | Unbounded student directory fetch | Medium | Mitigated — `MAX_LIST_ROWS` cap |
| S-07 | File upload abuse | Accepted | No upload pipeline in release |
| S-08 | Cross-school leakage | Low (controls exist) | RLS + school_id helpers; regression contract tests |
| S-09 | Privilege escalation via public signup | Low | Staff created via admin/service role paths; no public privileged signup |
| S-10 | Disabled staff continuing sessions | Low–Medium | Layout + `is_active` gates; JWT may linger until refresh — accepted Supabase limitation |
| S-11 | SECURITY DEFINER search_path | Low | Dominant pattern uses `set search_path = public` |
| S-12 | Service-role key exposure | Blocker if leaked | Not in git; Cloudflare Secret + CI secret — keep monitoring |
| S-13 | Error/log PII leakage | Medium | Logger scrubber + health redaction |
| S-14 | CSV injection on exports | Medium | Limited export surfaces; document sanitization when expanding exports |
| S-15 | Backup unverified | High | Documented Unknown; see backup doc |
| S-16 | IDOR on student URLs | Low | RLS school scoping; capability checks on actions |
| S-17 | CSRF | Accepted | Same-site cookies + Supabase SSR patterns |
| S-18 | Production reset misuse | High if unlocked | Gated by `ALLOW_PRODUCTION_RESET=false` on Worker |

## Blocker / High fixes this phase

- Release identity + shallow health (S-02)
- Audit review surface (S-03)
- Operational docs for backups/incidents (S-01, S-15)
- Logging redaction helpers (S-13)
- Student list volume guard (S-06)

## Medium deferred / gradual

- Universal adoption of `normalizeOpsError` across every legacy action
- Shared Durable Object / KV rate-limit store (current: isolate memory)
- Server-side cursor pagination for all directories (cap first; full pagination later)
- Audit “All modules” pagination merges independent stream pages (prefer single-module filters for exact paging)
- Student directory hard cap is silent when > `MAX_LIST_ROWS` match (unlikely for current school size)

## SECURITY DEFINER contract

Expected:

- `security definer`
- `set search_path = public`
- capability/`is_active` checks inside mutation RPCs
- revoke direct table writes for `authenticated` on audit streams
- actor from `auth.uid()`, not client-supplied actor fields

Integrity offline verifier confirms schema artifacts exist in migrations.

## Accepted operational limitations

- In-memory rate limits are not globally consistent across Workers isolates
- Supabase Auth session may remain until expiry after role/deactivation until claims refresh
- No object storage buckets; logo is URL text only
- Backup success cannot be asserted by the app without Dashboard/API evidence
