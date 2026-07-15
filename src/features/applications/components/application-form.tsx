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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";
import { schoolToday } from "@/lib/dates";

interface ApplicationFormProps {
  classes: ClassOption[];
  suggestedAdmissionNumber: string | null;
}

const today = () => schoolToday();

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

      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <StudentExtraFields register={register as any} errors={errors} />

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
            <GuardianFields
              key={field.id}
              index={index}
              /* eslint-disable-next-line @typescript-eslint/no-explicit-any */
              register={register as any}
              errors={errors}
              isPrimary={Boolean(watchedGuardians?.[index]?.is_primary_contact)}
              canRemove={fields.length > 1}
              onMakePrimary={() =>
                makePrimaryHelper(getValues, setValue, index)
              }
              onRemove={() => remove(index)}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Declaration &amp; consent
        </h3>
        <div className="space-y-3 rounded-lg border bg-muted/40 p-4 text-sm text-muted-foreground">
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

        <div className="space-y-2">
          <Label htmlFor="emergency_contact_phone">
            Emergency medical authorization — contact me on
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

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Submitting..." : "Submit application"}
      </Button>
    </form>
  );
}
