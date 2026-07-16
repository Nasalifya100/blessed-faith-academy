"use client";

import { useState } from "react";
import { useForm, useFieldArray, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import {
  createStudentSchema,
  type CreateStudentInput,
  emptyGuardian,
  GENDERS,
  GENDER_LABELS,
} from "@/features/students/schemas";
import { createStudentAction } from "@/features/students/actions";
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

interface AddStudentFormProps {
  classes: ClassOption[];
  suggestedAdmissionNumber: string | null;
}

const today = () => schoolToday();

export function AddStudentForm({
  classes,
  suggestedAdmissionNumber,
}: AddStudentFormProps) {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    control,
    reset,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<CreateStudentInput>({
    resolver: zodResolver(createStudentSchema),
    defaultValues: {
      admission_number: suggestedAdmissionNumber ?? "",
      first_name: "",
      middle_name: "",
      last_name: "",
      date_of_birth: "",
      gender: "male",
      enrollment_date: today(),
      class_id: classes[0]?.id ?? "",
      place_of_birth: "",
      religious_denomination: "",
      previous_school: "",
      proposed_admission_date: "",
      vaccinated_smallpox: false,
      vaccination_date: "",
      medical_notes: "",
      is_zambian_citizen: true,
      guardians: [emptyGuardian(true)],
    },
  });

  const { fields, append, remove } = useFieldArray({
    control,
    name: "guardians",
  });

  const watchedGuardians = useWatch({ control, name: "guardians" });

  async function onSubmit(values: CreateStudentInput) {
    setServerError(null);
    setSuccess(null);

    const result = await createStudentAction(values);
    if (result.error) {
      setServerError(result.error);
      return;
    }

    setSuccess(
      `Enrolled ${values.first_name} ${values.last_name} (${values.admission_number}). Add the next student below.`,
    );
    reset({
      admission_number: result.nextAdmissionNumber ?? "",
      first_name: "",
      middle_name: "",
      last_name: "",
      date_of_birth: "",
      gender: "male",
      enrollment_date: today(),
      class_id: values.class_id,
      place_of_birth: "",
      religious_denomination: "",
      previous_school: "",
      proposed_admission_date: "",
      vaccinated_smallpox: false,
      vaccination_date: "",
      medical_notes: "",
      is_zambian_citizen: true,
      guardians: [emptyGuardian(true)],
    });
    router.refresh();
  }

  const guardiansError = errors.guardians as
    | { message?: string; root?: { message?: string } }
    | undefined;

  if (classes.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        There are no classes set up for the current academic year yet, so
        students cannot be assigned to a class. Please set up classes first.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-8" noValidate>
      <section className="space-y-4">
        <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
          Student details
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
            <Label htmlFor="class_id">Class (current year)</Label>
            <SelectNative id="class_id" {...register("class_id")}>
              {classes.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.gradeName}
                </option>
              ))}
            </SelectNative>
            {errors.class_id ? (
              <p className="text-sm text-destructive">
                {errors.class_id.message}
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

          <div className="space-y-2">
            <Label htmlFor="enrollment_date">Enrollment date</Label>
            <Input
              id="enrollment_date"
              type="date"
              aria-invalid={Boolean(errors.enrollment_date)}
              {...register("enrollment_date")}
            />
            {errors.enrollment_date ? (
              <p className="text-sm text-destructive">
                {errors.enrollment_date.message}
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <StudentExtraFields register={register} errors={errors} />

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

      {serverError ? (
        <p className="text-sm text-destructive" role="alert">
          {serverError}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-emerald-600" role="status">
          {success}
        </p>
      ) : null}

      <Button type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Saving..." : "Enrol student"}
      </Button>
    </form>
  );
}
