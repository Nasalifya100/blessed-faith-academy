import Link from "next/link";

import { getCurrentUser } from "@/features/auth/queries/current-user";
import {
  getCurrentYearClasses,
  listStudents,
} from "@/features/students/queries";
import {
  STUDENT_STATUSES,
  STUDENT_STATUS_LABELS,
} from "@/features/students/schemas";
import { StudentStatusBadge } from "@/features/students/components/status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { canManageStudents } from "@/features/auth/permissions";

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
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

  const current = await getCurrentUser();
  const role = current?.profile?.role;
  const canManage = canManageStudents(role);

  const [{ classes }, students] = await Promise.all([
    getCurrentYearClasses(),
    listStudents({ q, status, classId }),
  ]);

  const hasFilters = Boolean(q || !statusFilterUnset || classId);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Students</h1>
          <p className="text-muted-foreground">
            {students.length} student{students.length === 1 ? "" : "s"}
            {hasFilters ? " match your filters" : ""}.
          </p>
        </div>
        {canManage ? (
          <Link href="/dashboard/students/new" className={buttonVariants()}>
            Add student
          </Link>
        ) : null}
      </div>

      <form
        method="get"
        action="/dashboard/students"
        className="grid gap-4 rounded-lg border p-4 sm:grid-cols-[1fr_auto_auto_auto]"
      >
        <div className="space-y-2">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            name="q"
            defaultValue={q}
            placeholder="Name or admission number"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="status">Status</Label>
          <SelectNative
            id="status"
            name="status"
            defaultValue={statusFilterUnset ? "enrolled" : status}
            className="w-40"
          >
            <option value="">All statuses</option>
            {STUDENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STUDENT_STATUS_LABELS[value]}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-2">
          <Label htmlFor="class">Class</Label>
          <SelectNative
            id="class"
            name="class"
            defaultValue={classId}
            className="w-40"
          >
            <option value="">All classes</option>
            {classes.map((option) => (
              <option key={option.id} value={option.id}>
                {option.gradeName}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="flex items-end gap-2">
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
        </div>
      </form>

      {students.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No students found{hasFilters ? " for these filters" : " yet"}.
        </p>
      ) : (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Admission #</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Class</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {students.map((student) => (
                <TableRow key={student.id}>
                  <TableCell className="font-mono text-xs">
                    {student.admissionNumber}
                  </TableCell>
                  <TableCell className="font-medium">
                    <Link
                      href={`/dashboard/students/${student.id}`}
                      className="hover:underline"
                    >
                      {student.fullName}
                    </Link>
                  </TableCell>
                  <TableCell>{student.className ?? "-"}</TableCell>
                  <TableCell>
                    <StudentStatusBadge status={student.status} />
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/dashboard/students/${student.id}`}
                      className="text-sm hover:underline"
                    >
                      View
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
