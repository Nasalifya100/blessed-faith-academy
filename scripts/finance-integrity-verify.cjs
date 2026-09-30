#!/usr/bin/env node
/**
 * Finance integrity verifier (offline).
 *
 * Reads the finance migrations and application source and asserts the
 * invariants FIN-01 … FIN-20 that can be proven statically. It never connects
 * to a database and never needs credentials, so it is safe to run anywhere,
 * including CI.
 *
 * Invariants that can only be proven against live data (for example that no
 * account balance has drifted) are listed at the end as "requires online
 * verification" and are deliberately NOT attempted here.
 *
 * Usage:  node scripts/finance-integrity-verify.cjs
 * Exit:   0 when every static invariant holds, 1 otherwise.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const MIGRATIONS_DIR = path.join(ROOT, "supabase", "migrations");
const SRC_DIR = path.join(ROOT, "src");

const FINANCE_MIGRATIONS = [
  "20260929120000_finance_funds_accounts_capabilities.sql",
  "20260929120100_finance_ledger.sql",
  "20260929120200_finance_expenses_transfers_salaries.sql",
  "20260929120300_finance_rpcs.sql",
  "20260929120400_finance_reporting.sql",
  "20260929120500_finance_cutover_attribution.sql",
];

function readMigration(name) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

function readAllFinanceSql() {
  return FINANCE_MIGRATIONS.map(readMigration).join("\n");
}

function walk(dir, predicate, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, predicate, found);
    } else if (predicate(full)) {
      found.push(full);
    }
  }
  return found;
}

/** Strips `-- line comments` so a comment can never satisfy a check. */
function stripComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

const checks = [];

function check(id, name, fn) {
  try {
    const result = fn();
    if (result === true || result === undefined) {
      checks.push({ id, name, ok: true, detail: "" });
    } else {
      checks.push({ id, name, ok: false, detail: String(result) });
    }
  } catch (error) {
    checks.push({ id, name, ok: false, detail: error.message });
  }
}

function runStaticChecks() {
  checks.length = 0;

  const allSql = readAllFinanceSql();
  const sql = stripComments(allSql);
  const ledgerSql = stripComments(readMigration(FINANCE_MIGRATIONS[1]));
  const tablesSql = stripComments(readMigration(FINANCE_MIGRATIONS[2]));
  const rpcSql = stripComments(readMigration(FINANCE_MIGRATIONS[3]));
  const reportSql = stripComments(readMigration(FINANCE_MIGRATIONS[4]));
  const capsSql = stripComments(readMigration(FINANCE_MIGRATIONS[0]));

  check("MIGRATIONS", "all finance migrations are present", () => {
    const missing = FINANCE_MIGRATIONS.filter(
      (name) => !fs.existsSync(path.join(MIGRATIONS_DIR, name)),
    );
    return missing.length === 0 || `missing: ${missing.join(", ")}`;
  });

  check("FIN-01", "ledger and money amounts must be positive", () => {
    const required = [
      "constraint finance_ledger_amount_positive check (amount > 0)",
      "constraint expenses_amount_positive check (amount > 0)",
      "constraint finance_transfers_amount_positive check (amount > 0)",
      "constraint salary_payments_gross_positive check (gross_amount > 0)",
    ];
    const missing = required.filter((clause) => !sql.includes(clause));
    return missing.length === 0 || `missing: ${missing.join(" | ")}`;
  });

  check("FIN-02", "posted transactions cannot be deleted", () => {
    const guards = [
      "Financial transactions cannot be deleted",
      "Expenses cannot be deleted",
      "Salary records cannot be deleted",
      "Transfers cannot be deleted",
    ];
    const missing = guards.filter((message) => !sql.includes(message));
    if (missing.length > 0) return `missing guards: ${missing.join(" | ")}`;
    const revoked = [
      "revoke insert, update, delete on public.finance_ledger_entries",
      "revoke insert, update, delete on public.expenses",
      "revoke insert, update, delete on public.finance_transfers",
      "revoke insert, update, delete on public.salary_payments",
    ];
    const notRevoked = revoked.filter((clause) => !sql.includes(clause));
    return (
      notRevoked.length === 0 || `client writes not revoked: ${notRevoked.join(" | ")}`
    );
  });

  check("FIN-03", "posted transactions cannot be freely edited", () => {
    if (!ledgerSql.includes("finance_ledger_enforce_immutability")) {
      return "ledger immutability trigger function missing";
    }
    if (!ledgerSql.includes("before update or delete on public.finance_ledger_entries")) {
      return "ledger immutability trigger not attached to update/delete";
    }
    if (!ledgerSql.includes("app.allow_ledger_reversal")) {
      return "reversal flag guard missing";
    }
    if (!tablesSql.includes("A paid expense cannot be edited")) {
      return "paid expenses are not frozen";
    }
    if (!tablesSql.includes("A paid salary cannot be edited")) {
      return "paid salaries are not frozen";
    }
    return true;
  });

  check("FIN-04", "a reversal references the original transaction", () => {
    if (!ledgerSql.includes("reverses_entry_id uuid references public.finance_ledger_entries(id)")) {
      return "reverses_entry_id is not a self-reference";
    }
    return (
      ledgerSql.includes("constraint finance_ledger_reversal_shape") ||
      "reversal shape constraint missing"
    );
  });

  check("FIN-05", "a transaction cannot be reversed twice", () => {
    if (!ledgerSql.includes("finance_ledger_one_reversal_uidx")) {
      return "unique index on reverses_entry_id missing";
    }
    if (!rpcSql.includes("This transaction has already been reversed.")) {
      return "runtime double-reversal guard missing";
    }
    return (
      rpcSql.includes("A reversal cannot itself be reversed.") ||
      "reversal-of-a-reversal is not blocked"
    );
  });

  check("FIN-06", "transfers are atomic and never one-sided", () => {
    if (!tablesSql.includes("constraint finance_transfers_both_legs")) {
      return "both-legs constraint missing";
    }
    if (!rpcSql.includes("create or replace function public.record_account_transfer")) {
      return "transfer RPC missing";
    }
    const body = rpcSql.slice(
      rpcSql.indexOf("function public.record_account_transfer"),
    );
    const legs = (body.match(/finance_post_entry\(/g) || []).length;
    return legs >= 2 || "transfer RPC does not post two legs";
  });

  check("FIN-07", "transfers never count as income", () => {
    const generated = ledgerSql.includes("income_effect numeric(12, 2) generated always as");
    if (!generated) return "income_effect is not a generated column";
    const block = ledgerSql.slice(
      ledgerSql.indexOf("income_effect numeric(12, 2) generated always as"),
      ledgerSql.indexOf("expense_effect numeric(12, 2) generated always as"),
    );
    if (block.includes("transfer_in") || block.includes("transfer_out")) {
      return "income_effect references transfer types";
    }
    return (
      block.includes("entry_type = 'income'::public.finance_entry_type") ||
      "income_effect is not restricted to income entries"
    );
  });

  check("FIN-08", "transfers never count as expenditure", () => {
    const marker = "expense_effect numeric(12, 2) generated always as";
    if (!ledgerSql.includes(marker)) {
      return "expense_effect is not a generated column";
    }
    const start = ledgerSql.indexOf(marker);
    const block = ledgerSql.slice(start, start + 600);
    if (block.includes("transfer_in") || block.includes("transfer_out")) {
      return "expense_effect references transfer types";
    }
    return (
      block.includes("entry_type = 'expense'::public.finance_entry_type") ||
      "expense_effect is not restricted to expense entries"
    );
  });

  check(
    "FIN-09",
    "school fee balances exclude uniforms, meals, and tuck shop",
    () => {
      if (!reportSql.includes("create or replace function public.get_student_finance_breakdown")) {
        return "student breakdown function missing";
      }
      if (!reportSql.includes("f.is_school_fees")) {
        return "breakdown does not key on the school fees fund";
      }
      const overview = reportSql.slice(
        reportSql.indexOf("function public.get_finance_overview"),
      );
      return (
        overview.includes("f.is_school_fees") ||
        "outstanding receivables are not restricted to the school fees fund"
      );
    },
  );

  check("FIN-10", "each fund can be reported independently", () => {
    if (!reportSql.includes("create or replace function public.get_finance_fund_positions")) {
      return "fund position function missing";
    }
    return (
      reportSql.includes("from public.finance_funds f") ||
      "fund positions are not derived per fund"
    );
  });

  check("FIN-11", "funds and physical accounts are never conflated", () => {
    if (!ledgerSql.includes("constraint finance_ledger_fund_presence")) {
      return "fund presence constraint missing";
    }
    const start = ledgerSql.indexOf("constraint finance_ledger_fund_presence");
    const block = ledgerSql.slice(start, start + 700);
    if (!block.includes("then fund_id is null")) {
      return "transfers are allowed to carry a fund";
    }
    return (
      ledgerSql.includes("account_id uuid not null references public.financial_accounts(id)") ||
      "ledger entries do not require an account"
    );
  });

  check("FIN-12", "no duplicate salary for the same pay period", () => {
    if (!tablesSql.includes("salary_payments_unique_period_uidx")) {
      return "unique pay-period index missing";
    }
    return (
      rpcSql.includes(
        "A salary record already exists for this staff member and pay period.",
      ) || "runtime duplicate guard missing"
    );
  });

  check("FIN-13", "existing payment idempotency is untouched", () => {
    const schema = stripComments(
      readMigration("20260719150000_payment_allocations_schema.sql"),
    );
    const modified = FINANCE_MIGRATIONS.some((name) => {
      const body = stripComments(readMigration(name));
      return (
        /drop function[^;]*record_payment\s*\(/.test(body) &&
        !body.includes("record_payment_to_account")
      );
    });
    if (modified) return "a finance migration drops record_payment";
    const allowedAlter =
      /alter table public\.payments\s+add column if not exists financial_account_id\b/;
    const unexpected = FINANCE_MIGRATIONS.filter((name) => {
      const body = stripComments(readMigration(name));
      const alters = body.match(/alter table public\.payments[^;]*/g) ?? [];
      return alters.some((statement) => !allowedAlter.test(statement));
    });
    if (unexpected.length > 0) {
      return `unexpected change to public.payments in ${unexpected.join(", ")}`;
    }
    return schema.length > 0;
  });

  check("FIN-14", "completed-payment protections are untouched", () => {
    // Word boundaries matter here: salary_payments_enforce_immutability is a
    // new trigger of our own and must not be mistaken for the payments one.
    const forbidden = [
      /\bdrop\s+trigger[^;]*\bon\s+public\.charges\b/,
      /\bdrop\s+policy[^;]*\bon\s+public\.payments\b/,
      /\bdrop\s+policy[^;]*\bon\s+public\.charges\b/,
      /(?<![\w.])payments_enforce_immutability\b/,
      /(?<![\w.])charges_enforce_immutability\b/,
      /\bgrant\s+(insert|update|delete)[^;]*\bon\s+public\.payments\b/,
    ];
    const offenders = [];
    for (const name of FINANCE_MIGRATIONS) {
      const body = stripComments(readMigration(name));
      for (const pattern of forbidden) {
        if (pattern.test(body)) offenders.push(`${name} (${pattern.source})`);
      }
      const paymentDrops =
        body.match(/\bdrop\s+trigger[^;]*\bon\s+public\.payments\b/g) ?? [];
      const protectedDrop = paymentDrops.find(
        (statement) => !statement.includes("payments_assign_financial_account"),
      );
      if (protectedDrop) {
        offenders.push(`${name} (drops a payment trigger other than attribution)`);
      }
    }
    return (
      offenders.length === 0 ||
      `finance migrations touch payment/charge protections: ${offenders.join(", ")}`
    );
  });

  check("FIN-15", "every financial mutation writes an audit event", () => {
    const mutating = [
      "record_fund_income",
      "record_expense",
      "approve_expense",
      "pay_expense",
      "reverse_expense",
      "record_account_transfer",
      "reverse_account_transfer",
      "record_salary_payment",
      "approve_salary_payment",
      "pay_salary_payment",
      "reverse_salary_payment",
    ];
    const missing = [];
    for (const name of mutating) {
      const start = rpcSql.indexOf(`function public.${name}(`);
      if (start < 0) {
        missing.push(`${name} (not found)`);
        continue;
      }
      const end = rpcSql.indexOf("\n$$;", start);
      const body = rpcSql.slice(start, end);
      if (!body.includes("log_finance_event")) missing.push(name);
    }
    if (missing.length > 0) return `no audit event: ${missing.join(", ")}`;
    return (
      capsSql.includes("finance_event_audits_event_type_check") ||
      "the audit event vocabulary was not extended"
    );
  });

  check("FIN-16", "no cross-school access is expressible", () => {
    // Only client-callable functions matter. Internal helpers such as
    // finance_post_entry do take a school id, but they are revoked from every
    // client role and are only ever called with a caller-resolved school.
    const callable = [
      ...new Set(
        [...rpcSql.matchAll(/grant execute on function public\.(\w+)\(/g)].map(
          (match) => match[1],
        ),
      ),
    ];
    const offenders = callable.filter((name) => {
      const start = rpcSql.indexOf(`function public.${name}(`);
      const signatureEnd = rpcSql.indexOf(")", start);
      const signature = rpcSql.slice(start, signatureEnd);
      return /p_school_id/.test(signature);
    });
    if (offenders.length > 0) {
      return `RPCs accept a school id: ${offenders.join(", ")}`;
    }
    if (!rpcSql.includes("public.current_user_school_id()")) {
      return "school is not resolved from the caller";
    }
    const crossSchoolGuards = [
      "The selected fund belongs to a different school.",
      "The selected account belongs to a different school.",
    ];
    const missing = crossSchoolGuards.filter(
      (message) => !ledgerSql.includes(message),
    );
    return missing.length === 0 || `missing guards: ${missing.join(" | ")}`;
  });

  check("FIN-17", "salary data is withheld at the database level", () => {
    if (!tablesSql.includes("policy salary_payments_select")) {
      return "salary select policy missing";
    }
    const start = tablesSql.indexOf("policy salary_payments_select");
    const block = tablesSql.slice(start, start + 400);
    if (!block.includes("FINANCE_SALARY_VIEW")) {
      return "salary policy does not require FINANCE_SALARY_VIEW";
    }
    if (!ledgerSql.includes("FINANCE_SALARY_VIEW")) {
      return "salary ledger entries are not withheld from the general ledger";
    }
    const secretaryStart = capsSql.indexOf(
      "if v_role = 'secretary'::public.staff_role then",
    );
    const secretaryBlock = capsSql.slice(
      secretaryStart,
      capsSql.indexOf("end if;", secretaryStart),
    );
    return (
      !secretaryBlock.includes("SALARY") ||
      "secretary is granted a salary capability"
    );
  });

  check("FIN-18", "historical attribution survives deactivation", () => {
    if (!capsSql.includes("finance_fund_identity_guard")) {
      return "fund identity guard missing";
    }
    if (!ledgerSql.includes("financial_account_identity_guard")) {
      return "account identity guard missing";
    }
    return (
      ledgerSql.includes("The opening balance cannot change once this account has transactions") ||
      "opening balance is not frozen after use"
    );
  });

  check("FIN-19", "deactivation never deletes", () => {
    const offenders = FINANCE_MIGRATIONS.filter((name) => {
      const body = stripComments(readMigration(name));
      return /delete\s+from\s+public\.(charges|payments|finance_ledger_entries|expenses|salary_payments|finance_transfers)/.test(
        body,
      );
    });
    if (offenders.length > 0) {
      return `migrations delete financial rows: ${offenders.join(", ")}`;
    }
    return (
      capsSql.includes("is_active boolean not null default true") ||
      "no deactivation flag on reference data"
    );
  });

  check("FIN-20", "reports derive from authoritative records", () => {
    if (!reportSql.includes("create or replace view public.finance_student_fund_income")) {
      return "student income view missing";
    }
    if (!reportSql.includes("with (security_invoker = true)")) {
      return "the reporting view bypasses the caller's RLS";
    }
    if (!reportSql.includes("from public.payment_allocations pa")) {
      return "student income is not derived from payment allocations";
    }
    const duplicated = FINANCE_MIGRATIONS.some((name) => {
      const body = stripComments(readMigration(name));
      return /insert\s+into\s+public\.finance_ledger_entries[\s\S]{0,400}from\s+public\.payments/.test(
        body,
      );
    });
    return !duplicated || "student payments are copied into the ledger";
  });

  check("SEC-01", "every SECURITY DEFINER function locks search_path", () => {
    const offenders = [];
    for (const name of FINANCE_MIGRATIONS) {
      const body = stripComments(readMigration(name));
      const parts = body.split("security definer");
      for (let index = 1; index < parts.length; index += 1) {
        const following = parts[index].slice(0, 200);
        if (!following.includes("set search_path = public")) {
          offenders.push(`${name} #${index}`);
        }
      }
    }
    return (
      offenders.length === 0 ||
      `unlocked search_path: ${offenders.join(", ")}`
    );
  });

  check("SEC-02", "internal helpers are not callable by clients", () => {
    const internal = [
      "public.finance_require(text)",
      "public.finance_post_entry(",
      "public.finance_reverse_entry(uuid, text)",
    ];
    const exposed = internal.filter((name) => {
      const revokeIndex = rpcSql.indexOf(`revoke all on function ${name}`);
      if (revokeIndex < 0) return true;
      const clause = rpcSql.slice(revokeIndex, revokeIndex + 400);
      return !clause.includes("authenticated");
    });
    return (
      exposed.length === 0 ||
      `not revoked from authenticated: ${exposed.join(", ")}`
    );
  });

  check("SEC-03", "no service-role credentials in browser-reachable code", () => {
    const files = walk(
      SRC_DIR,
      (file) =>
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.includes(".test."),
    );
    const problems = [];
    for (const file of files) {
      const body = fs.readFileSync(file, "utf8");
      const relative = path.relative(ROOT, file);
      // Only an actual read of the key counts. Mentioning the name in a
      // deny-list (as the password-reset logger scrubber does) is a control,
      // not a leak.
      const readsServiceRole =
        /process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(body) ||
        /process\.env\[\s*["']SUPABASE_SERVICE_ROLE_KEY["']\s*\]/.test(body);

      if (readsServiceRole && /^\s*["']use client["']/m.test(body)) {
        problems.push(`${relative} (client component)`);
      }

      // The key must never be exposed through a NEXT_PUBLIC_ variable, which
      // would inline it into the browser bundle.
      if (/NEXT_PUBLIC_[A-Z_]*SERVICE_ROLE/.test(body)) {
        problems.push(`${relative} (NEXT_PUBLIC service role)`);
      }

      // Anything that reads the key directly must be server-only.
      if (readsServiceRole && !body.includes('import "server-only"')) {
        problems.push(`${relative} (missing server-only guard)`);
      }
    }
    return (
      problems.length === 0 ||
      `service-role exposure risk: ${problems.join(", ")}`
    );
  });

  check("SEC-04", "finance RPCs check a capability before mutating", () => {
    const granted = [
      ...rpcSql.matchAll(/grant execute on function public\.(\w+)\(/g),
    ].map((match) => match[1]);
    const unique = [...new Set(granted)];
    const missing = unique.filter((name) => {
      const start = rpcSql.indexOf(`function public.${name}(`);
      const end = rpcSql.indexOf("\n$$;", start);
      const body = rpcSql.slice(start, end);
      return !body.includes("public.finance_require(");
    });
    return (
      missing.length === 0 ||
      `no capability check: ${missing.join(", ")}`
    );
  });

  check("SEC-05", "the fee catalogue maps deterministically to funds", () => {
    if (!capsSql.includes("fee_items_default_fund")) {
      return "fee item fund default trigger missing";
    }
    if (!capsSql.includes("LEGACY_ADDITIONAL")) {
      return "no safe category for unclassifiable historical charges";
    }
    return (
      capsSql.includes("where fi.fund_id is null") ||
      "the backfill is not rerun-safe"
    );
  });

  check("UX-01", "finance never offers Delete for a posted transaction", () => {
    const componentsDir = path.join(SRC_DIR, "features", "finance");
    if (!fs.existsSync(componentsDir)) return "finance feature folder missing";
    const files = walk(
      componentsDir,
      (file) => file.endsWith(".tsx") && !file.includes(".test."),
    );
    const offenders = files.filter((file) =>
      /(>|")\s*Delete\b/.test(fs.readFileSync(file, "utf8")),
    );
    return (
      offenders.length === 0 ||
      `delete control found in: ${offenders
        .map((file) => path.relative(ROOT, file))
        .join(", ")}`
    );
  });

  check("CUT-01", "account balances do not guess from payment method", () => {
    const cutover = stripComments(readMigration(FINANCE_MIGRATIONS[5]));
    const start = cutover.indexOf("function public.finance_account_balance(");
    const end = cutover.indexOf("\n$$;", start);
    const body = cutover.slice(start, end);
    if (body.includes("default_for_method") || body.includes("p.method")) {
      return "finance_account_balance still attributes receipts by payment method";
    }
    if (!body.includes("p.financial_account_id = v_account.id")) {
      return "receipts are not restricted to the account named on the receipt";
    }
    if (!body.includes("opening_balance_date")) {
      return "the opening-balance date is not a cutover";
    }
    if (!body.includes("p.paid_on > v_account.opening_balance_date")) {
      return "receipts on the opening-balance date would be counted twice";
    }
    if (!body.includes("e.entry_date > v_account.opening_balance_date")) {
      return "ledger rows on the opening-balance date would be counted twice";
    }
    return true;
  });

  check("CUT-02", "retried income, expenses, and transfers cannot post twice", () => {
    const cutover = stripComments(readMigration(FINANCE_MIGRATIONS[5]));
    const required = [
      "finance_ledger_client_request_uidx",
      "expenses_client_request_uidx",
      "finance_transfers_client_request_uidx",
    ];
    const missing = required.filter((name) => !cutover.includes(name));
    return missing.length === 0 || `missing ${missing.join(", ")}`;
  });

  check("CUT-03", "a new school is provisioned with finance defaults", () => {
    const cutover = stripComments(readMigration(FINANCE_MIGRATIONS[5]));
    return (
      (cutover.includes("schools_finance_defaults") &&
        cutover.includes("finance_seed_school_defaults")) ||
      "new-school provisioning trigger missing"
    );
  });

  check("CUT-04", "overlapping salary periods are rejected", () => {
    const cutover = stripComments(readMigration(FINANCE_MIGRATIONS[5]));
    return (
      cutover.includes("daterange(s.period_start, s.period_end, '[]')") ||
      "salary overlap guard missing"
    );
  });

  check("CUT-05", "self-approval is written into the audit trail", () => {
    const cutover = stripComments(readMigration(FINANCE_MIGRATIONS[5]));
    const marks = cutover.match(/'self_approved'/g) ?? [];
    return marks.length >= 2 || "self-approval is not audited for expenses and salaries";
  });

  check("PAY-01", "a new receipt cannot be dated after today in Lusaka", () => {
    const name = "20260930180000_payment_paid_on_not_future.sql";
    const full = path.join(MIGRATIONS_DIR, name);
    if (!fs.existsSync(full)) return "future payment-date guard migration missing";
    const body = stripComments(fs.readFileSync(full, "utf8"));
    if (!body.includes("p_paid_on > (now() at time zone 'Africa/Lusaka')::date")) {
      return "database does not reject a future paid_on";
    }
    if (!body.includes("v_year < 1000 or v_year > 9999")) {
      return "database does not reject a year that is not four digits";
    }
    if (!/before insert on public\.payments/i.test(body)) {
      return "the date guard is not limited to insert";
    }
    if (/before update on public\.payments/i.test(body)) {
      return "the date guard would block void of a historical bad date";
    }
    if (/update\s+public\.payments/i.test(body)) {
      return "the date guard rewrites existing payments";
    }
    const schema = fs.readFileSync(
      path.join(SRC_DIR, "features", "fees", "schemas.ts"),
      "utf8",
    );
    return (
      schema.includes("paymentPaidOnError") ||
      "server schema does not check the payment date"
    );
  });

  check("PAY-02", "historical paid_on correction changes only the date", () => {
    const name = "20260930180100_payment_paid_on_correction.sql";
    const full = path.join(MIGRATIONS_DIR, name);
    if (!fs.existsSync(full)) return "payment date correction migration missing";
    const body = stripComments(fs.readFileSync(full, "utf8"));
    if (body.includes("BFA-R-2026-")) {
      return "a production receipt correction is embedded in the migration";
    }
    if (!body.includes("new.paid_on = old.paid_on")) {
      return "void no longer freezes paid_on";
    }
    if (!body.includes("'payment_date_corrected'")) {
      return "date correction is not audited";
    }
    if (!/revoke all on function public\.correct_payment_paid_on[\s\S]*service_role/i.test(body)) {
      return "portal or service roles can execute date correction";
    }
    if (!body.includes("'database_operator'")) {
      return "a null actor is not identified as the database operator";
    }
    if (!body.includes("Only a completed payment can have its date corrected.")) {
      return "a voided payment can have its date corrected";
    }
    if (!body.includes("The payment is already dated on that day.")) {
      return "a same-date correction writes an audit";
    }
    if (!body.includes("opening-balance date")) {
      return "a correction can cross an opening-balance date";
    }
    if (!/for update/i.test(body)) {
      return "the payment row is not locked";
    }
    const update = body.match(/update public\.payments[\s\S]*?returning id into v_id;/);
    if (!update || !/set paid_on = p_corrected_paid_on/.test(update[0])) {
      return "correction does not update only paid_on";
    }
    return true;
  });

  check("MONEY-01", "money math never uses floating point directly", () => {
    const mathFile = path.join(SRC_DIR, "features", "finance", "ledger-math.ts");
    const body = fs.readFileSync(mathFile, "utf8");
    if (!body.includes("toNgwee") || !body.includes("fromNgwee")) {
      return "ledger math does not go through integer ngwee";
    }
    return (
      body.includes('from "@/lib/money"') ||
      "ledger math does not use the shared money helpers"
    );
  });

  return {
    ok: checks.every((entry) => entry.ok),
    checks: checks.map((entry) => ({ ...entry })),
  };
}

/** Invariants that genuinely need live data. Reported, never attempted. */
const ONLINE_ONLY = [
  "Every account balance equals opening balance plus recorded movements.",
  "No orphaned transfer leg exists in production data.",
  "No school fee balance changed as a result of the fund backfill.",
];

function main() {
  const result = runStaticChecks();

  console.log("Finance integrity verification (offline)\n");
  for (const entry of result.checks) {
    const status = entry.ok ? "PASS" : "FAIL";
    console.log(`  [${status}] ${entry.id}  ${entry.name}`);
    if (!entry.ok) console.log(`         ${entry.detail}`);
  }

  const passed = result.checks.filter((entry) => entry.ok).length;
  console.log(`\n${passed}/${result.checks.length} static checks passed.`);

  console.log("\nRequires online verification (not attempted, needs approval):");
  for (const item of ONLINE_ONLY) {
    console.log(`  - ${item}`);
  }

  process.exit(result.ok ? 0 : 1);
}

module.exports = { runStaticChecks, ONLINE_ONLY };

if (require.main === module) {
  main();
}
