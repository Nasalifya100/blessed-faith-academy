"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  useForm,
  useFieldArray,
  useWatch,
  type Path,
  type Resolver,
} from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useRouter } from "next/navigation";

import {
  createExistingStudentSchema,
  emptyOpeningChargeLine,
  openingOutstanding,
  sumOpeningOutstanding,
  isRecentAdmissionDate,
  EXISTING_STUDENT_STATUSES,
  type CreateExistingStudentInput,
  type OpeningChargeLineInput,
} from "@/features/students/existing-student-schemas";
import {
  emptyGuardian,
  GENDERS,
  GENDER_LABELS,
  STUDENT_STATUS_LABELS,
  RELATIONSHIP_LABELS,
} from "@/features/students/schemas";
import { createExistingStudentAction } from "@/features/students/actions";
import { StudentExtraFields } from "@/features/students/components/student-extra-fields";
import {
  GuardianFields,
  makePrimaryHelper,
} from "@/features/students/components/guardian-fields";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionHeading } from "@/components/layout/page-shell";
import { stickyFormFooterClass } from "@/components/ui/admin-chrome";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatKwacha } from "@/lib/money";
import { Button } from "@/components/ui/button";
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
import { schoolToday } from "@/lib/dates";

interface AddExistingStudentFormProps {
  classes: { id: string; name: string; gradeName: string }[];
  suggestedAdmissionNumber: string | null;
  academicYearName: string | null;
  feeItems: { id: string; name: string; category: string }[];
  years: { id: string; name: string; isCurrent: boolean }[];
  terms: {
    id: string;
    name: string;
    academicYearId: string;
    isCurrent: boolean;
  }[];
  currentYearId: string;
}

const STEPS = [
  { title: "History", description: "Admission record and migration notes" },
  { title: "Personal", description: "Child details" },
  { title: "Guardians", description: "Parents and emergency contacts" },
  { title: "Placement", description: "Class assignment" },
  { title: "Opening finance", description: "Outstanding balances to migrate" },
  { title: "Review", description: "Confirm before creating the record" },
] as const;

const STEP_FIELDS: Record<number, Path<CreateExistingStudentInput>[]> = {
  0: [
    "admission_number",
    "admission_date",
    "status",
    "legacy_reference",
    "migration_notes",
  ],
  1: [
    "first_name",
    "middle_name",
    "last_name",
    "gender",
    "date_of_birth",
    "place_of_birth",
    "religious_denomination",
    "previous_school",
    "proposed_admission_date",
    "vaccinated_smallpox",
    "vaccination_date",
    "medical_notes",
    "is_zambian_citizen",
  ],
  2: ["guardians"],
  3: ["class_id", "placement_effective_date"],
  4: ["opening_charges"],
  5: [],
};

function RequiredMark() {
  return (
    <span className="text-destructive" aria-hidden>
      *
    </span>
  );
}

function statusTone(
  status: string,
): "success" | "warning" | "danger" | "info" | "neutral" {
  if (status === "enrolled") return "success";
  if (status === "withdrawn") return "danger";
  if (status === "graduated") return "neutral";
  return "info";
}

export function AddExistingStudentForm({
  classes,
  suggestedAdmissionNumber,
  academicYearName,
  feeItems,
  years,
  terms,
  currentYearId,
}: AddExistingStudentFormProps) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const {
    register,
    handleSubmit,
    control,
    trigger,
    setValue,
    getValues,
    formState: { errors, isSubmitting },
  } = useForm<CreateExistingStudentInput>({
    resolver: zodResolver(
      createExistingStudentSchema,
    ) as Resolver<CreateExistingStudentInput>,
    defaultValues: {
      admission_number: suggestedAdmissionNumber ?? "",
      admission_date: "",
      legacy_reference: "",
      status: "enrolled",
      migration_notes: "",
      first_name: "",
      middle_name: "",
      last_name: "",
      date_of_birth: "",
      gender: "male",
      class_id: classes[0]?.id ?? "",
      placement_effective_date: "",
      place_of_birth: "",
      religious_denomination: "",
      previous_school: "",
      proposed_admission_date: "",
      vaccinated_smallpox: false,
      vaccination_date: "",
      medical_notes: "",
      is_zambian_citizen: true,
      guardians: [emptyGuardian(true)],
      opening_charges: [],
    },
  });

  const {
    fields: guardianFields,
    append: appendGuardian,
    remove: removeGuardian,
  } = useFieldArray({
    control,
    name: "guardians",
  });

  const {
    fields: chargeFields,
    append: appendCharge,
    remove: removeCharge,
  } = useFieldArray({
    control,
    name: "opening_charges",
  });

  const watchedGuardians = useWatch({ control, name: "guardians" });
  const watchedCharges = useWatch({ control, name: "opening_charges" });
  const watchedAdmissionDate = useWatch({ control, name: "admission_date" });
  const watchedValues = useWatch({ control });

  const openingTotal = useMemo(
    () => sumOpeningOutstanding((watchedCharges ?? []) as OpeningChargeLineInput[]),
    [watchedCharges],
  );

  const showRecentAdmissionWarn = Boolean(
    watchedAdmissionDate && isRecentAdmissionDate(watchedAdmissionDate),
  );

  const feeNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of feeItems) {
      map.set(item.id, item.name);
    }
    return map;
  }, [feeItems]);

  const yearNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const year of years) {
      map.set(year.id, year.name);
    }
    return map;
  }, [years]);

  const termNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const term of terms) {
      map.set(term.id, term.name);
    }
    return map;
  }, [terms]);

  const classLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of classes) {
      map.set(option.id, option.gradeName || option.name);
    }
    return map;
  }, [classes]);

  async function goNext() {
    setServerError(null);
    const fields = STEP_FIELDS[step];
    if (fields.length > 0) {
      const valid = await trigger(fields);
      if (!valid) return;
    }

    if (step === 2) {
      const placement = getValues("placement_effective_date");
      const admission = getValues("admission_date");
      if (!placement?.trim() && admission) {
        setValue("placement_effective_date", admission, { shouldDirty: true });
      }
    }

    setStep((current) => Math.min(current + 1, STEPS.length - 1));
  }

  function goBack() {
    setServerError(null);
    setStep((current) => Math.max(current - 1, 0));
  }

  async function onSubmit(values: CreateExistingStudentInput) {
    if (isSubmitting) return;
    setServerError(null);

    const result = await createExistingStudentAction(values);
    if (result.error || !result.studentId) {
      setConfirmOpen(false);
      setServerError(
        result.error ?? "Could not create the existing student record.",
      );
      return;
    }

    router.push(`/dashboard/students/${result.studentId}`);
  }

  function openConfirm() {
    setServerError(null);
    setConfirmOpen(true);
  }

  const guardiansError = errors.guardians as
    | { message?: string; root?: { message?: string } }
    | undefined;

  const currentStep = STEPS[step];
  const today = schoolToday();

  return (
    <>
      <form
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="relative space-y-6 pb-24"
        noValidate
      >
        <Card className="shadow-sm">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <SectionHeading
                title={`Step ${step + 1} of ${STEPS.length}: ${currentStep.title}`}
                description={currentStep.description}
              />
              <StatusBadge tone="info">
                {step + 1} / {STEPS.length}
              </StatusBadge>
            </div>
            <ol className="flex flex-wrap gap-2" aria-label="Form steps">
              {STEPS.map((item, index) => (
                <li key={item.title}>
                  <StatusBadge
                    tone={
                      index === step
                        ? "info"
                        : index < step
                          ? "success"
                          : "neutral"
                    }
                  >
                    {item.title}
                  </StatusBadge>
                </li>
              ))}
            </ol>
          </CardHeader>
          <CardContent className="space-y-6">
            {step === 0 ? (
              <section className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Fields marked <RequiredMark /> are required.
                </p>
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
                    <Label htmlFor="admission_date">
                      Admission date <RequiredMark />
                    </Label>
                    <Input
                      id="admission_date"
                      type="date"
                      max={today}
                      aria-invalid={Boolean(errors.admission_date)}
                      {...register("admission_date")}
                    />
                    {errors.admission_date ? (
                      <p className="text-sm text-destructive">
                        {errors.admission_date.message}
                      </p>
                    ) : null}
                    {showRecentAdmissionWarn ? (
                      <p className="text-sm text-amber-800 dark:text-amber-200">
                        This admission date is recent. Confirm this learner
                        belongs in Add Existing Student rather than New
                        application or Enrol student.
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="status">
                      Status <RequiredMark />
                    </Label>
                    <SelectNative id="status" {...register("status")}>
                      {EXISTING_STUDENT_STATUSES.map((value) => (
                        <option key={value} value={value}>
                          {STUDENT_STATUS_LABELS[value]}
                        </option>
                      ))}
                    </SelectNative>
                    {errors.status ? (
                      <p className="text-sm text-destructive">
                        {errors.status.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="legacy_reference">
                      Legacy reference (optional)
                    </Label>
                    <Input
                      id="legacy_reference"
                      placeholder="Old register or paper file number"
                      {...register("legacy_reference")}
                    />
                    {errors.legacy_reference ? (
                      <p className="text-sm text-destructive">
                        {errors.legacy_reference.message}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="migration_notes">
                      Migration notes (optional)
                    </Label>
                    <Input
                      id="migration_notes"
                      placeholder="Context for staff reviewing this migration"
                      {...register("migration_notes")}
                    />
                    {errors.migration_notes ? (
                      <p className="text-sm text-destructive">
                        {errors.migration_notes.message}
                      </p>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}

            {step === 1 ? (
              <section className="space-y-6">
                <p className="text-sm text-muted-foreground">
                  Fields marked <RequiredMark /> are required.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
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
                      max={today}
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

                <StudentExtraFields register={register} errors={errors} />
              </section>
            ) : null}

            {step === 2 ? (
              <section className="space-y-4">
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
                    className="min-h-10"
                    onClick={() => appendGuardian(emptyGuardian(false))}
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
                  {guardianFields.map((field, index) => (
                    <GuardianFields
                      key={field.id}
                      index={index}
                      register={register}
                      errors={errors}
                      isPrimary={Boolean(
                        watchedGuardians?.[index]?.is_primary_contact,
                      )}
                      canRemove={guardianFields.length > 1}
                      onMakePrimary={() =>
                        makePrimaryHelper(getValues, setValue, index)
                      }
                      onRemove={() => removeGuardian(index)}
                      nationalId={
                        watchedGuardians?.[index]?.national_id ?? ""
                      }
                      phone={watchedGuardians?.[index]?.phone ?? ""}
                      existingGuardianId={
                        watchedGuardians?.[index]?.existing_guardian_id ?? ""
                      }
                      onSelectExistingGuardian={(id) =>
                        setValue(
                          `guardians.${index}.existing_guardian_id`,
                          id,
                          { shouldDirty: true },
                        )
                      }
                      onClearExistingGuardian={() =>
                        setValue(
                          `guardians.${index}.existing_guardian_id`,
                          "",
                          { shouldDirty: true },
                        )
                      }
                    />
                  ))}
                </div>
              </section>
            ) : null}

            {step === 3 ? (
              <section className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Place the learner into a class for{" "}
                  <span className="font-medium text-foreground">
                    {academicYearName ?? "the current academic year"}
                  </span>
                  . Placement date defaults to the admission date when left
                  blank on save.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="class_id">
                      Class <RequiredMark />
                    </Label>
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
                    <Label htmlFor="placement_effective_date">
                      Placement effective date
                    </Label>
                    <Input
                      id="placement_effective_date"
                      type="date"
                      aria-invalid={Boolean(errors.placement_effective_date)}
                      {...register("placement_effective_date")}
                    />
                    {errors.placement_effective_date ? (
                      <p className="text-sm text-destructive">
                        {errors.placement_effective_date.message}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        Leave blank to use the admission date (
                        {watchedAdmissionDate || "not set"}).
                      </p>
                    )}
                  </div>
                </div>
              </section>
            ) : null}

            {step === 4 ? (
              <section className="space-y-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1">
                    <h3 className="text-base font-semibold tracking-tight">
                      Opening balances
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      Optional. Record what was owed and what was already paid
                      before this system.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="min-h-10"
                    disabled={!currentYearId || feeItems.length === 0}
                    onClick={() =>
                      appendCharge(
                        emptyOpeningChargeLine(
                          currentYearId,
                          feeItems[0]?.id ?? "",
                        ),
                      )
                    }
                  >
                    Add charge line
                  </Button>
                </div>

                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  Previously paid amounts are migration context only — no
                  receipts or payment ledger entries are created. Do not run
                  Generate charges for the same period without reviewing
                  duplicates.
                </p>

                {feeItems.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No fee types are set up yet. You can continue without
                    opening balances.
                  </p>
                ) : null}

                {errors.opening_charges?.message ? (
                  <p className="text-sm text-destructive">
                    {errors.opening_charges.message}
                  </p>
                ) : null}

                <div className="space-y-4">
                  {chargeFields.map((field, index) => {
                    const line = watchedCharges?.[index];
                    const yearId = line?.academic_year_id ?? currentYearId;
                    const lineTerms = terms.filter(
                      (term) => term.academicYearId === yearId,
                    );
                    const outstanding = openingOutstanding(
                      Number(line?.original_amount ?? 0),
                      Number(line?.previously_paid_amount ?? 0),
                    );
                    const lineErrors = errors.opening_charges?.[index];

                    return (
                      <Card key={field.id} size="sm" className="shadow-none">
                        <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
                          <div>
                            <CardTitle>Charge line {index + 1}</CardTitle>
                            <CardDescription>
                              Outstanding: {formatKwacha(outstanding)}
                            </CardDescription>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="min-h-10"
                            onClick={() => removeCharge(index)}
                          >
                            Remove
                          </Button>
                        </CardHeader>
                        <CardContent className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor={`opening_charges.${index}.fee_item_id`}>
                              Fee type <RequiredMark />
                            </Label>
                            <SelectNative
                              id={`opening_charges.${index}.fee_item_id`}
                              {...register(
                                `opening_charges.${index}.fee_item_id`,
                              )}
                            >
                              <option value="">Select fee type</option>
                              {feeItems.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </SelectNative>
                            {lineErrors?.fee_item_id ? (
                              <p className="text-sm text-destructive">
                                {lineErrors.fee_item_id.message}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <Label
                              htmlFor={`opening_charges.${index}.description`}
                            >
                              Description (optional)
                            </Label>
                            <Input
                              id={`opening_charges.${index}.description`}
                              {...register(
                                `opening_charges.${index}.description`,
                              )}
                            />
                          </div>

                          <div className="space-y-2">
                            <Label
                              htmlFor={`opening_charges.${index}.original_amount`}
                            >
                              Original amount (K) <RequiredMark />
                            </Label>
                            <Input
                              id={`opening_charges.${index}.original_amount`}
                              type="number"
                              min={0}
                              step="0.01"
                              aria-invalid={Boolean(
                                lineErrors?.original_amount,
                              )}
                              {...register(
                                `opening_charges.${index}.original_amount`,
                                { valueAsNumber: true },
                              )}
                            />
                            {lineErrors?.original_amount ? (
                              <p className="text-sm text-destructive">
                                {lineErrors.original_amount.message}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <Label
                              htmlFor={`opening_charges.${index}.previously_paid_amount`}
                            >
                              Previously paid (K) <RequiredMark />
                            </Label>
                            <Input
                              id={`opening_charges.${index}.previously_paid_amount`}
                              type="number"
                              min={0}
                              step="0.01"
                              aria-invalid={Boolean(
                                lineErrors?.previously_paid_amount,
                              )}
                              {...register(
                                `opening_charges.${index}.previously_paid_amount`,
                                { valueAsNumber: true },
                              )}
                            />
                            {lineErrors?.previously_paid_amount ? (
                              <p className="text-sm text-destructive">
                                {lineErrors.previously_paid_amount.message}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <Label
                              htmlFor={`opening_charges.${index}.academic_year_id`}
                            >
                              Academic year <RequiredMark />
                            </Label>
                            <SelectNative
                              id={`opening_charges.${index}.academic_year_id`}
                              {...register(
                                `opening_charges.${index}.academic_year_id`,
                                {
                                  onChange: () => {
                                    setValue(
                                      `opening_charges.${index}.term_id`,
                                      "",
                                      { shouldDirty: true },
                                    );
                                  },
                                },
                              )}
                            >
                              {years.map((year) => (
                                <option key={year.id} value={year.id}>
                                  {year.name}
                                  {year.isCurrent ? " (current)" : ""}
                                </option>
                              ))}
                            </SelectNative>
                            {lineErrors?.academic_year_id ? (
                              <p className="text-sm text-destructive">
                                {lineErrors.academic_year_id.message}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2">
                            <Label htmlFor={`opening_charges.${index}.term_id`}>
                              Term (optional)
                            </Label>
                            <SelectNative
                              id={`opening_charges.${index}.term_id`}
                              {...register(
                                `opening_charges.${index}.term_id`,
                              )}
                            >
                              <option value="">Whole year / no term</option>
                              {lineTerms.map((term) => (
                                <option key={term.id} value={term.id}>
                                  {term.name}
                                  {term.isCurrent ? " (current)" : ""}
                                </option>
                              ))}
                            </SelectNative>
                            {lineErrors?.term_id ? (
                              <p className="text-sm text-destructive">
                                {lineErrors.term_id.message}
                              </p>
                            ) : null}
                          </div>

                          <div className="space-y-2 sm:col-span-2">
                            <Label htmlFor={`opening_charges.${index}.notes`}>
                              Notes (optional)
                            </Label>
                            <Input
                              id={`opening_charges.${index}.notes`}
                              {...register(`opening_charges.${index}.notes`)}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <div className="rounded-lg border bg-muted/40 px-3 py-2 text-sm">
                  Total opening outstanding:{" "}
                  <span className="font-semibold">
                    {formatKwacha(openingTotal)}
                  </span>
                </div>
              </section>
            ) : null}

            {step === 5 ? (
              <section className="space-y-6">
                <p className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                  This action will create an existing student record and opening
                  financial obligations. It will not create a new application or
                  historical payment receipts.
                </p>

                <div className="grid gap-4 sm:grid-cols-2">
                  <ReviewItem
                    label="Admission number"
                    value={watchedValues.admission_number || "—"}
                  />
                  <ReviewItem
                    label="Admission date"
                    value={watchedValues.admission_date || "—"}
                  />
                  <ReviewItem
                    label="Status"
                    value={
                      <StatusBadge
                        tone={statusTone(watchedValues.status ?? "enrolled")}
                      >
                        {STUDENT_STATUS_LABELS[
                          (watchedValues.status ??
                            "enrolled") as keyof typeof STUDENT_STATUS_LABELS
                        ] ?? watchedValues.status}
                      </StatusBadge>
                    }
                  />
                  <ReviewItem
                    label="Legacy reference"
                    value={watchedValues.legacy_reference || "—"}
                  />
                  <ReviewItem
                    label="Migration notes"
                    value={watchedValues.migration_notes || "—"}
                  />
                  <ReviewItem
                    label="Full name"
                    value={[
                      watchedValues.first_name,
                      watchedValues.middle_name,
                      watchedValues.last_name,
                    ]
                      .filter(Boolean)
                      .join(" ") || "—"}
                  />
                  <ReviewItem
                    label="Gender"
                    value={
                      watchedValues.gender
                        ? GENDER_LABELS[watchedValues.gender]
                        : "—"
                    }
                  />
                  <ReviewItem
                    label="Date of birth"
                    value={watchedValues.date_of_birth || "—"}
                  />
                  <ReviewItem
                    label="Class"
                    value={
                      classLabelById.get(watchedValues.class_id ?? "") ?? "—"
                    }
                  />
                  <ReviewItem
                    label="Placement date"
                    value={
                      watchedValues.placement_effective_date?.trim() ||
                      watchedValues.admission_date ||
                      "—"
                    }
                  />
                  <ReviewItem
                    label="Academic year"
                    value={academicYearName ?? "—"}
                  />
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold tracking-tight">
                    Guardians
                  </h3>
                  <ul className="space-y-2 text-sm">
                    {(watchedGuardians ?? []).map((guardian, index) => (
                      <li
                        key={`review-guardian-${index}`}
                        className="rounded-lg border px-3 py-2"
                      >
                        <span className="font-medium">
                          {guardian.first_name} {guardian.last_name}
                        </span>
                        {" · "}
                        {RELATIONSHIP_LABELS[guardian.relationship] ??
                          guardian.relationship}
                        {guardian.is_primary_contact ? " · Primary" : ""}
                        {guardian.phone ? ` · ${guardian.phone}` : ""}
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="space-y-2">
                  <h3 className="text-sm font-semibold tracking-tight">
                    Opening charges
                  </h3>
                  {(watchedCharges ?? []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No opening balances.
                    </p>
                  ) : (
                    <ul className="space-y-2 text-sm">
                      {(watchedCharges ?? []).map((line, index) => (
                        <li
                          key={`review-charge-${index}`}
                          className="rounded-lg border px-3 py-2"
                        >
                          <div className="font-medium">
                            {feeNameById.get(line.fee_item_id) ?? "Fee type"}
                            {line.description ? ` — ${line.description}` : ""}
                          </div>
                          <div className="text-muted-foreground">
                            {yearNameById.get(line.academic_year_id) ?? "Year"}
                            {line.term_id
                              ? ` · ${termNameById.get(line.term_id) ?? "Term"}`
                              : " · Whole year"}
                          </div>
                          <div>
                            Original {formatKwacha(Number(line.original_amount || 0))}
                            {" · "}
                            Paid{" "}
                            {formatKwacha(
                              Number(line.previously_paid_amount || 0),
                            )}
                            {" · "}
                            Outstanding{" "}
                            {formatKwacha(
                              openingOutstanding(
                                Number(line.original_amount || 0),
                                Number(line.previously_paid_amount || 0),
                              ),
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="text-sm font-medium">
                    Total opening outstanding: {formatKwacha(openingTotal)}
                  </p>
                </div>
              </section>
            ) : null}

            {serverError ? (
              <p className="text-sm text-destructive" role="alert">
                {serverError}
              </p>
            ) : null}
          </CardContent>
        </Card>

        <div className={stickyFormFooterClass}>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">
              {currentStep.title}: {currentStep.description}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                disabled={step === 0 || isSubmitting}
                onClick={goBack}
              >
                Back
              </Button>
              {step < STEPS.length - 1 ? (
                <Button
                  type="button"
                  className="min-h-11 sm:min-w-36"
                  disabled={isSubmitting}
                  onClick={() => void goNext()}
                >
                  Continue
                </Button>
              ) : (
                <Button
                  type="button"
                  className="min-h-11 sm:min-w-36"
                  disabled={isSubmitting}
                  onClick={openConfirm}
                >
                  Confirm
                </Button>
              )}
            </div>
          </div>
        </div>
      </form>

      <ConfirmDialog
        open={confirmOpen}
        title="Create existing student?"
        description="This will create the student record and any opening financial obligations. No application and no historical payment receipts will be created."
        confirmLabel="Create student"
        cancelLabel="Cancel"
        pending={isSubmitting}
        onCancel={() => {
          if (!isSubmitting) setConfirmOpen(false);
        }}
        onConfirm={() => {
          void handleSubmit(onSubmit)();
        }}
      />
    </>
  );
}

function ReviewItem({
  label,
  value,
}: {
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="space-y-1 rounded-lg border px-3 py-2">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </p>
      <div className="text-sm text-foreground">{value}</div>
    </div>
  );
}
