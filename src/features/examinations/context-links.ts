/**
 * Shared examination context links — preserve year/term/class via URL params.
 * Authority stays server-side; these are navigation aids only.
 * Never emit absolute or off-dashboard URLs.
 */

export type ExamNavContext = {
  academicYearId?: string | null;
  termId?: string | null;
  classId?: string | null;
  subjectId?: string | null;
  examPeriodId?: string | null;
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function safeId(value: string | null | undefined): string | null {
  if (!value || value === "all") return null;
  const trimmed = value.trim();
  if (!UUID_RE.test(trimmed)) return null;
  return trimmed;
}

function append(
  params: URLSearchParams,
  key: string,
  value: string | null | undefined,
) {
  const id = safeId(value);
  if (id) params.set(key, id);
}

function dashboardPath(pathname: string, params: URLSearchParams): string {
  const base = pathname.startsWith("/dashboard/")
    ? pathname
    : `/dashboard/${pathname.replace(/^\/+/, "")}`;
  const q = params.toString();
  return q ? `${base}?${q}` : base;
}

/** Gradebook hub uses year/term/class/subject query names. */
export function gradebookHref(ctx: ExamNavContext = {}): string {
  const params = new URLSearchParams();
  append(params, "year", ctx.academicYearId);
  append(params, "term", ctx.termId);
  append(params, "class", ctx.classId);
  append(params, "subject", ctx.subjectId);
  return dashboardPath("/dashboard/gradebook", params);
}

/** Results hub uses academic_year_id / term_id / class_id. */
export function resultsHref(ctx: ExamNavContext = {}): string {
  const params = new URLSearchParams();
  append(params, "academic_year_id", ctx.academicYearId);
  append(params, "term_id", ctx.termId);
  append(params, "class_id", ctx.classId);
  append(params, "subject_id", ctx.subjectId);
  return dashboardPath("/dashboard/results", params);
}

/** Report cards hub uses academic_year_id / term_id / class_id. */
export function reportCardsHref(ctx: ExamNavContext = {}): string {
  const params = new URLSearchParams();
  append(params, "academic_year_id", ctx.academicYearId);
  append(params, "term_id", ctx.termId);
  append(params, "class_id", ctx.classId);
  return dashboardPath("/dashboard/report-cards", params);
}

export function examPeriodHref(periodId: string): string {
  const id = safeId(periodId);
  return id
    ? `/dashboard/examinations/periods/${id}`
    : "/dashboard/examinations";
}

export function examSettingsHref(): string {
  return "/dashboard/settings/academics";
}
