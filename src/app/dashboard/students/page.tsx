import Link from "next/link";
import { redirect } from "next/navigation";
import { GraduationCap, Plus, Search, UserRoundPlus, Users } from "lucide-react";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  canBrowseStudents,
  canManageStudents,
  canMigrateExistingStudents,
} from "@/features/auth/permissions";
import {
  getCurrentYearClasses,
  listStudents,
} from "@/features/students/queries";
import {
  STUDENT_STATUSES,
  STUDENT_STATUS_LABELS,
} from "@/features/students/schemas";
import { StudentsTable } from "@/features/students/components/students-table";
import { PageHeader, PageShell } from "@/components/layout/page-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function chipClass(active: boolean) {
  return cn(
    buttonVariants({ variant: active ? "default" : "outline", size: "sm" }),
    "min-h-10 rounded-full px-4",
  );
}

function buildStudentsHref(opts: {
  q: string;
  status: string | null;
  classId: string;
}): string {
  const sp = new URLSearchParams();
  if (opts.q) sp.set("q", opts.q);
  if (opts.status !== null) sp.set("status", opts.status);
  if (opts.classId) sp.set("class", opts.classId);
  const qs = sp.toString();
  return qs ? `/dashboard/students?${qs}` : "/dashboard/students";
}

export default async function StudentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const q = firstValue(params.q);
  const statusParam = firstValue(params.status);
  const statusFilterUnset = params.status === undefined;
  const status = statusFilterUnset ? "enrolled" : statusParam;
  const classId = firstValue(params.class);
  const showingAllStatuses = !statusFilterUnset && status === "";

  const current = await getCurrentUser();
  const role = current?.profile?.role;
  if (!canBrowseStudents(role)) {
    redirect("/dashboard");
  }
  const canManage = canManageStudents(role);
  const canMigrate = canMigrateExistingStudents(role);

  const [{ classes }, students] = await Promise.all([
    getCurrentYearClasses(),
    listStudents({ q, status, classId }),
  ]);

  const hasFilters = Boolean(q || !statusFilterUnset || classId);

  return (
    <PageShell>
      <PageHeader
        eyebrow="Students"
        title="Directory"
        description={
          <>
            <span className="font-medium text-foreground">
              {students.length}
            </span>{" "}
            student{students.length === 1 ? "" : "s"}
            {hasFilters ? " match your filters" : " in view"}
          </>
        }
      />

      {canManage || canMigrate ? (
        <section
          aria-label="Add students"
          className="rounded-xl border bg-card p-4 shadow-sm sm:p-5"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1">
              <p className="text-sm font-semibold tracking-tight">
                Add students
              </p>
              <p className="max-w-xl text-sm text-muted-foreground">
                For learners who joined the school before the digital system
                was introduced.
              </p>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              {canManage ? (
                <Link
                  href="/dashboard/students/new"
                  className={cn(
                    buttonVariants(),
                    "min-h-11 justify-center gap-2",
                  )}
                >
                  <Plus className="size-4" aria-hidden />
                  Enrol New Student
                </Link>
              ) : null}
              {canMigrate ? (
                <Link
                  href="/dashboard/students/existing/new"
                  className={cn(
                    buttonVariants({ variant: "secondary" }),
                    "min-h-11 justify-center gap-2 border",
                  )}
                >
                  <UserRoundPlus className="size-4" aria-hidden />
                  Add Existing Student
                </Link>
              ) : null}
            </div>
          </div>
          {canMigrate ? (
            <p className="mt-3 text-xs text-muted-foreground">
              Use <span className="font-medium text-foreground">Add Existing Student</span>{" "}
              for learners who joined the school before the digital system was
              introduced. Use{" "}
              <span className="font-medium text-foreground">Enrol New Student</span>{" "}
              for new admissions.
            </p>
          ) : null}
        </section>
      ) : null}

      <section
        aria-label="Search and filters"
        className="space-y-4 rounded-xl border bg-card p-4 shadow-sm"
      >
        <form
          method="get"
          action="/dashboard/students"
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1 space-y-2">
            <Label htmlFor="q">Search</Label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <Input
                id="q"
                name="q"
                defaultValue={q}
                placeholder="Name or admission number"
                className="pl-9"
              />
            </div>
          </div>
          {!showingAllStatuses && status ? (
            <input type="hidden" name="status" value={status} />
          ) : null}
          {showingAllStatuses ? (
            <input type="hidden" name="status" value="" />
          ) : null}
          {classId ? <input type="hidden" name="class" value={classId} /> : null}
          <button type="submit" className={buttonVariants()}>
            Search
          </button>
          {hasFilters ? (
            <Link
              href="/dashboard/students"
              className={buttonVariants({ variant: "ghost" })}
            >
              Clear
            </Link>
          ) : null}
        </form>

        <div className="space-y-3">
          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Status
            </p>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Status filters">
              <Link
                href={buildStudentsHref({ q, status: "", classId })}
                className={chipClass(showingAllStatuses)}
                aria-current={showingAllStatuses ? "page" : undefined}
              >
                All
              </Link>
              {STUDENT_STATUSES.map((value) => {
                const isActive =
                  !showingAllStatuses &&
                  ((statusFilterUnset && value === "enrolled") ||
                    status === value);
                return (
                  <Link
                    key={value}
                    href={buildStudentsHref({ q, status: value, classId })}
                    className={chipClass(isActive)}
                    aria-current={isActive ? "page" : undefined}
                  >
                    {STUDENT_STATUS_LABELS[value]}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Class / grade
            </p>
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Class filters"
            >
              <Link
                href={buildStudentsHref({
                  q,
                  status: showingAllStatuses
                    ? ""
                    : statusFilterUnset
                      ? "enrolled"
                      : status,
                  classId: "",
                })}
                className={chipClass(!classId)}
                aria-current={!classId ? "page" : undefined}
              >
                All classes
              </Link>
              {classes.map((option) => {
                const active = classId === option.id;
                return (
                  <Link
                    key={option.id}
                    href={buildStudentsHref({
                      q,
                      status: showingAllStatuses
                        ? ""
                        : statusFilterUnset
                          ? "enrolled"
                          : status,
                      classId: option.id,
                    })}
                    className={chipClass(active)}
                    aria-current={active ? "page" : undefined}
                  >
                    {option.gradeName}
                  </Link>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {students.length === 0 ? (
        <EmptyState
          size="lg"
          title={hasFilters ? "No students match" : "No students yet"}
          description={
            hasFilters
              ? "Try clearing filters or searching with a different name or admission number."
              : "Enrol the first pupil to start building your school directory."
          }
          icon={
            hasFilters ? (
              <Users className="size-7 text-muted-foreground" aria-hidden />
            ) : (
              <GraduationCap
                className="size-7 text-muted-foreground"
                aria-hidden
              />
            )
          }
          action={
            canManage && !hasFilters ? (
              <div className="flex flex-wrap justify-center gap-2">
                <Link
                  href="/dashboard/students/new"
                  className={cn(buttonVariants(), "min-h-10 gap-2")}
                >
                  <Plus className="size-4" aria-hidden />
                  Enrol New Student
                </Link>
                {canMigrate ? (
                  <Link
                    href="/dashboard/students/existing/new"
                    className={cn(
                      buttonVariants({ variant: "secondary" }),
                      "min-h-11 gap-2 border",
                    )}
                  >
                    <UserRoundPlus className="size-4" aria-hidden />
                    Add Existing Student
                  </Link>
                ) : null}
              </div>
            ) : hasFilters ? (
              <Link
                href="/dashboard/students"
                className={buttonVariants({ variant: "outline" })}
              >
                Clear filters
              </Link>
            ) : null
          }
        />
      ) : (
        <StudentsTable students={students} />
      )}
    </PageShell>
  );
}
