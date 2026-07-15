"use client";

import { useState } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import {
  createApplicationSchema,
  type CreateApplicationInput,
} from "@/features/applications/schemas";
import { createApplicationAction } from "@/features/applications/actions";
import {
  GENDERS,
  GENDER_LABELS,
  GUARDIAN_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
} from "@/features/students/schemas";
import type { ClassOption } from "@/features/students/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

interface ApplicationFormProps {
  classes: ClassOption[];
  suggestedAdmissionNumber: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

function emptyGuardian(
  isPrimary: boolean,
): CreateApplicationInput["guardians"][number] {
  return {
    first_name: "",
    last_name: "",
    relationship: "mother",
    phone: "",
    alt_phone: "",
    email: "",
    national_id: "",
    occupation: "",
    address: "",
    is_primary_contact: isPrimary,
    is_emergency_contact: false,
  };
}

export function ApplicationForm({
  classes,
  suggestedAdmissionNumber,
}: ApplicationFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<CreateApplicationInput>({
    resolver: zodResolver(createApplicationSchema),
    defaultValues: {
      admission_number: suggestedAdmissionNumber ?? "",
      first_name: "",
      middle_name: "",
      last_name: "",
      date_of_birth: "",
      gender: "male",
      applied_class_id: classes[0]?.id ?? "",
      consent_agreed: false,
      consent_signed_by: "",
      consent_signed_at: today(),
      guardians: [emptyGuardian(true)],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "guardians",
  });

  const watchedGuardians = useWatch({ control, name: "guardians" });

  function makePrimary(index: number) {
    const guardians = getValues("guardians");
    guardians.forEach((_, i) => {
      setValue(`guardians.${i}.is_primary_contact`, i === index, {
        shouldValidate: true,
      });
    });
  }

  async function onSubmit(values: CreateApplicationInput) {
    setServerError(null);
    const result = await createApplicationAction(values);
    if (result.error || !result.applicationId) {
      setServerError(result.error ?? "Something went wrong. Please try again.");
      return;
    }
    router.push(`/dashboard/applications/${result.applicationId}`);
    router.refresh();
  }

  const guardiansError = errors.guardians as
    | { message?: string; root?: { message?: string } }
    | undefined;

  if (classes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no classes set up for the current academic year yet, so
        applications cannot be created. Please set up classes first.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
      <section className="space-y-4">
        <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Applicant details
        </h3>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="admission_number">Admission number</Label>
            <Input
              id="admission_number"
              aria-invalid={Boolean(errors.admission_number)}
              {...register("admission_number")}
            />
            {errors.admission_number ? (
              <p className="text-sm text-destructive">
                {errors.admission_number.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="applied_class_id">Applying for class</Label>
            <SelectNative id="applied_class_id" {...register("applied_class_id")}>
              {classes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.gradeName}
                </option>
              ))}
            </SelectNative>
            {errors.applied_class_id ? (
              <p className="text-sm text-destructive">
                {errors.applied_class_id.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="first_name">First name</Label>
            <Input
              id="first_name"
              aria-invalid={Boolean(errors.first_name)}
              {...register("first_name")}
            />
            {errors.first_name ? (
              <p className="text-sm text-destructive">
                {errors.first_name.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="middle_name">Middle name (optional)</Label>
            <Input id="middle_name" {...register("middle_name")} />
          </div>

          <div className="space-y-2">
            <Label htmlFor="last_name">Last name</Label>
            <Input
              id="last_name"
              aria-invalid={Boolean(errors.last_name)}
              {...register("last_name")}
            />
            {errors.last_name ? (
              <p className="text-sm text-destructive">
                {errors.last_name.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="gender">Gender</Label>
            <SelectNative id="gender" {...register("gender")}>
              {GENDERS.map((value) => (
                <option key={value} value={value}>
                  {GENDER_LABELS[value]}
                </option>
              ))}
            </SelectNative>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date_of_birth">Date of birth</Label>
            <Input
              id="date_of_birth"
              type="date"
              aria-invalid={Boolean(errors.date_of_birth)}
              {...register("date_of_birth")}
            />
            {errors.date_of_birth ? (
              <p className="text-sm text-destructive">
                {errors.date_of_birth.message}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            Parents / guardians
          </h3>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => append(emptyGuardian(false))}
          >
            Add another guardian
          </Button>
        </div>

        {guardiansError?.message ?? guardiansError?.root?.message ? (
          <p className="text-sm text-destructive">
            {guardiansError?.message ?? guardiansError?.root?.message}
          </p>
        ) : null}

        <div className="space-y-6">
          {fields.map((field, index) => (
            <div key={field.id} className="space-y-4 rounded-lg border p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium">Guardian {index + 1}</p>
                {fields.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => remove(index)}
                  >
                    Remove
                  </Button>
                ) : null}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`g-${index}-first`}>First name</Label>
                  <Input
                    id={`g-${index}-first`}
                    aria-invalid={Boolean(errors.guardians?.[index]?.first_name)}
                    {...register(`guardians.${index}.first_name`)}
                  />
                  {errors.guardians?.[index]?.first_name ? (
                    <p className="text-sm text-destructive">
                      {errors.guardians[index]?.first_name?.message}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`g-${index}-last`}>Last name</Label>
                  <Input
                    id={`g-${index}-last`}
                    aria-invalid={Boolean(errors.guardians?.[index]?.last_name)}
                    {...register(`guardians.${index}.last_name`)}
                  />
                  {errors.guardians?.[index]?.last_name ? (
                    <p className="text-sm text-destructive">
                      {errors.guardians[index]?.last_name?.message}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`g-${index}-rel`}>Relationship</Label>
                  <SelectNative
                    id={`g-${index}-rel`}
                    {...register(`guardians.${index}.relationship`)}
                  >
                    {GUARDIAN_RELATIONSHIPS.map((value) => (
                      <option key={value} value={value}>
                        {RELATIONSHIP_LABELS[value]}
                      </option>
                    ))}
                  </SelectNative>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`g-${index}-phone`}>Phone</Label>
                  <Input
                    id={`g-${index}-phone`}
                    {...register(`guardians.${index}.phone`)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`g-${index}-alt`}>Alternate phone</Label>
                  <Input
                    id={`g-${index}-alt`}
                    {...register(`guardians.${index}.alt_phone`)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`g-${index}-email`}>Email</Label>
                  <Input
                    id={`g-${index}-email`}
                    type="email"
                    aria-invalid={Boolean(errors.guardians?.[index]?.email)}
                    {...register(`guardians.${index}.email`)}
                  />
                  {errors.guardians?.[index]?.email ? (
                    <p className="text-sm text-destructive">
                      {errors.guardians[index]?.email?.message}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`g-${index}-nrc`}>NRC / national ID</Label>
                  <Input
                    id={`g-${index}-nrc`}
                    {...register(`guardians.${index}.national_id`)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor={`g-${index}-occ`}>Occupation</Label>
                  <Input
                    id={`g-${index}-occ`}
                    {...register(`guardians.${index}.occupation`)}
                  />
                </div>

                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor={`g-${index}-addr`}>Address</Label>
                  <Input
                    id={`g-${index}-addr`}
                    {...register(`guardians.${index}.address`)}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-6">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    checked={Boolean(
                      watchedGuardians?.[index]?.is_primary_contact,
                    )}
                    onChange={() => makePrimary(index)}
                  />
                  Primary contact
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 rounded border-input"
                    {...register(`guardians.${index}.is_emergency_contact`)}
                  />
                  Emergency contact
                </label>
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Declaration &amp; consent
        </h3>
        <p className="rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
          I declare that the information provided in this application is true and
          correct. I agree to abide by the rules and policies of Blessed Faith
          Academy and to meet the school fees and other financial obligations
          for my child.
        </p>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input"
            {...register("consent_agreed")}
          />
          The parent/guardian has read and agreed to the declaration above.
        </label>
        {errors.consent_agreed ? (
          <p className="text-sm text-destructive">
            {errors.consent_agreed.message}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="consent_signed_by">Agreed by (name)</Label>
            <Input
              id="consent_signed_by"
              aria-invalid={Boolean(errors.consent_signed_by)}
              {...register("consent_signed_by")}
            />
            {errors.consent_signed_by ? (
              <p className="text-sm text-destructive">
                {errors.consent_signed_by.message}
              </p>
            ) : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="consent_signed_at">Date</Label>
            <Input
              id="consent_signed_at"
              type="date"
              aria-invalid={Boolean(errors.consent_signed_at)}
              {...register("consent_signed_at")}
            />
            {errors.consent_signed_at ? (
              <p className="text-sm text-destructive">
                {errors.consent_signed_at.message}
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

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit application"}
      </Button>
    </form>
  );
}
