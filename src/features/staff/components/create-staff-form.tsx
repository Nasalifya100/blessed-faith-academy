"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import {
  createStaffSchema,
  type CreateStaffInput,
  STAFF_ROLES,
} from "@/features/staff/schemas";
import { createStaffAction } from "@/features/staff/actions";
import { ROLE_LABELS } from "@/features/auth/types";
import { StaffRoleBadge } from "@/features/staff/components/staff-badges";
import { SectionHeading } from "@/components/layout/page-shell";
import { Button } from "@/components/ui/button";
import { stickyFormFooterClass } from "@/components/ui/admin-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { StaffRole } from "@/features/auth/types";

export function CreateStaffForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CreateStaffInput>({
    resolver: zodResolver(createStaffSchema),
    defaultValues: { full_name: "", email: "", password: "", role: "teacher" },
  });

  const selectedRole = watch("role") as StaffRole;

  async function onSubmit(values: CreateStaffInput) {
    setServerError(null);
    setSuccess(null);

    const result = await createStaffAction(values);
    if (result.error) {
      setServerError(result.error);
      return;
    }

    setSuccess(`Account created for ${values.full_name}.`);
    reset();
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          className="min-h-11"
          onClick={() => setOpen(true)}
        >
          Add staff member
        </Button>
        {success ? (
          <p className="text-sm text-emerald-700 dark:text-emerald-300" role="status">
            {success}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="relative space-y-4 pb-24"
      noValidate
    >
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
          <div>
            <CardTitle>Create staff account</CardTitle>
            <CardDescription>
              They can sign in immediately with the email and temporary password
              you set. Ask them to keep the password private.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          <section className="space-y-4">
            <SectionHeading
              title="Identity"
              description="Name and role appear across the school system."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="full_name">
                  Full name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="full_name"
                  className="h-11"
                  aria-invalid={Boolean(errors.full_name)}
                  {...register("full_name")}
                />
                {errors.full_name ? (
                  <p className="text-sm text-destructive">
                    {errors.full_name.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">
                  Role <span className="text-destructive">*</span>
                </Label>
                <SelectNative id="role" className="h-11" {...register("role")}>
                  {STAFF_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role]}
                    </option>
                  ))}
                </SelectNative>
                <div className="pt-1">
                  <StaffRoleBadge role={selectedRole} />
                </div>
              </div>
            </div>
          </section>

          <section className="space-y-4">
            <SectionHeading
              title="Sign-in credentials"
              description="Use a school email when possible. Password must be at least 8 characters."
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="email">
                  Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="off"
                  className="h-11"
                  aria-invalid={Boolean(errors.email)}
                  {...register("email")}
                />
                {errors.email ? (
                  <p className="text-sm text-destructive">
                    {errors.email.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">
                  Temporary password <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="new-password"
                  className="h-11"
                  aria-invalid={Boolean(errors.password)}
                  {...register("password")}
                />
                {errors.password ? (
                  <p className="text-sm text-destructive">
                    {errors.password.message}
                  </p>
                ) : null}
              </div>
            </div>
          </section>

          {serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <div className={stickyFormFooterClass}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            className="min-h-11"
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            className="min-h-11 min-w-[10rem]"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating…" : "Create staff account"}
          </Button>
        </div>
      </div>
    </form>
  );
}
