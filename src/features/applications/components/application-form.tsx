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
  emptyGuardian,
  DECLARATION_CLAUSES,
  GENDERS,
  GENDER_LABELS,
} from "@/features/students/schemas";
import type { ClassOption } from "@/features/students/queries";
import { StudentExtraFields } from "@/features/students/components/student-extra-fields";
import {
  GuardianFields,
  makePrimaryHelper,
} from "@/features/students/components/guardian-fields";
import { Button } from "@/components/ui/button";
import { stickyFormFooterClass } from "@/components/ui/admin-chrome";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { schoolToday } from "@/lib/dates";

interface ApplicationFormProps {
  classes: ClassOption[];
  suggestedAdmissionNumber: string | null;
}

const today = () => schoolToday();

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      *
    </span>
  );
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
      place_of_birth: "",
      religious_denomination: "",
      previous_school: "",
      proposed_admission_date: "",
      vaccinated_smallpox: false,
      vaccination_date: "",
      medical_notes: "",
      is_zambian_citizen: true,
      consent_agreed: false,
      consent_signed_by: "",
      consent_signed_at: today(),
      emergency_contact_phone: "",
      media_release_agreed: false,
      guardians: [emptyGuardian(true)],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "guardians",
  });

  const watchedGuardians = useWatch({ control, name: "guardians" });

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
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="relative space-y-6 pb-24"
      noValidate
    >
      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">
            Applicant details
          </h3>
          <p className="text-sm text-muted-foreground">
            Fields marked <RequiredMark /> are required.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="admission_number">
              Admission number <RequiredMark />
            </Label>
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
            <Label htmlFor="applied_class_id">
              Applying for class <RequiredMark />
            </Label>
            <SelectNative
              id="applied_class_id"
              {...register("applied_class_id")}
            >
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
            <Label htmlFor="first_name">
              First name <RequiredMark />
            </Label>
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
            <Label htmlFor="last_name">
              Last name <RequiredMark />
            </Label>
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
            <Label htmlFor="gender">
              Gender <RequiredMark />
            </Label>
            <SelectNative id="gender" {...register("gender")}>
              {GENDERS.map((value) => (
                <option key={value} value={value}>
                  {GENDER_LABELS[value]}
                </option>
              ))}
            </SelectNative>
          </div>

          <div className="space-y-2">
            <Label htmlFor="date_of_birth">
              Date of birth <RequiredMark />
            </Label>
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

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">
            Additional student information
          </h3>
          <p className="text-sm text-muted-foreground">
            Background and health details for admissions.
          </p>
        </div>
        <StudentExtraFields register={register} errors={errors} />
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <h3 className="text-base font-semibold tracking-tight">
              Parents / guardians
            </h3>
            <p className="text-sm text-muted-foreground">
              At least one primary contact is required.
            </p>
          </div>
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
            <GuardianFields
              key={field.id}
              index={index}
              register={register}
              errors={errors}
              isPrimary={Boolean(watchedGuardians?.[index]?.is_primary_contact)}
              canRemove={fields.length > 1}
              onMakePrimary={() =>
                makePrimaryHelper(getValues, setValue, index)
              }
              onRemove={() => remove(index)}
              nationalId={watchedGuardians?.[index]?.national_id ?? ""}
              phone={watchedGuardians?.[index]?.phone ?? ""}
              existingGuardianId={
                watchedGuardians?.[index]?.existing_guardian_id ?? ""
              }
              onSelectExistingGuardian={(id) =>
                setValue(`guardians.${index}.existing_guardian_id`, id, {
                  shouldDirty: true,
                })
              }
              onClearExistingGuardian={() =>
                setValue(`guardians.${index}.existing_guardian_id`, "", {
                  shouldDirty: true,
                })
              }
            />
          ))}
        </div>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-6">
        <div className="space-y-1">
          <h3 className="text-base font-semibold tracking-tight">
            Declaration &amp; consent
          </h3>
          <p className="text-sm text-muted-foreground">
            Parent or guardian must agree before submission.
          </p>
        </div>
        <div className="space-y-3 rounded-xl border bg-muted/40 p-4 text-sm text-muted-foreground">
          <p>
            I declare that the information on this form is to the best of my
            knowledge and belief true and correct and that if the child is
            enrolled as a pupil I agree to the following:
          </p>
          <ol className="list-decimal space-y-1 pl-5">
            {DECLARATION_CLAUSES.map((clause) => (
              <li key={clause}>{clause}</li>
            ))}
          </ol>
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input"
            {...register("consent_agreed")}
          />
          <span>
            The parent/guardian has read and agreed to the declaration above.{" "}
            <RequiredMark />
          </span>
        </label>
        {errors.consent_agreed ? (
          <p className="text-sm text-destructive">
            {errors.consent_agreed.message}
          </p>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="consent_signed_by">
              Agreed by (name) <RequiredMark />
            </Label>
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
            <Label htmlFor="consent_signed_at">
              Date <RequiredMark />
            </Label>
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

        <div className="space-y-2">
          <Label htmlFor="emergency_contact_phone">
            Emergency medical authorization — contact me on <RequiredMark />
          </Label>
          <Input
            id="emergency_contact_phone"
            aria-invalid={Boolean(errors.emergency_contact_phone)}
            {...register("emergency_contact_phone")}
          />
          {errors.emergency_contact_phone ? (
            <p className="text-sm text-destructive">
              {errors.emergency_contact_phone.message}
            </p>
          ) : null}
        </div>

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 size-4 rounded border-input"
            {...register("media_release_agreed")}
          />
          I give permission for photographs and videos of my child to be used
          for school promotional purposes.
        </label>
      </section>

      {serverError ? (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      ) : null}

      <div className={stickyFormFooterClass}>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground">
            Submit to place this application in the review queue.
          </p>
          <Button type="submit" disabled={isSubmitting} className="sm:min-w-44">
            {isSubmitting ? "Submitting…" : "Submit application"}
          </Button>
        </div>
      </div>
    </form>
  );
}
