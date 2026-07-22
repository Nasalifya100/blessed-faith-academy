"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";

import {
  updateStudentProfileAction,
  updateGuardianProfileAction,
} from "@/features/students/actions";
import {
  PROFILE_CHANGE_REASONS,
  PROFILE_CHANGE_REASON_LABELS,
  updateStudentProfileSchema,
  updateGuardianProfileSchema,
  type UpdateStudentProfileInput,
  type UpdateGuardianProfileInput,
} from "@/features/students/profile-change-schemas";
import {
  GENDERS,
  GENDER_LABELS,
  GUARDIAN_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
} from "@/features/students/schemas";
import type { StudentGuardianView, StudentProfile } from "@/features/students/queries";
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

function ReasonFields({
  register,
  reason,
  errors,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  register: any;
  reason: string;
  errors: { change_reason?: { message?: string }; change_note?: { message?: string } };
}) {
  return (
    <div className="space-y-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
      <div className="space-y-1">
        <Label htmlFor="change_reason">Correction reason</Label>
        <SelectNative id="change_reason" {...register("change_reason")}>
          <option value="">Select a reason</option>
          {PROFILE_CHANGE_REASONS.map((value) => (
            <option key={value} value={value}>
              {PROFILE_CHANGE_REASON_LABELS[value]}
            </option>
          ))}
        </SelectNative>
        {errors.change_reason?.message ? (
          <p className="text-sm text-destructive">{errors.change_reason.message}</p>
        ) : null}
      </div>
      <div className="space-y-1">
        <Label htmlFor="change_note">
          Note{reason === "other" ? " (required)" : " (optional)"}
        </Label>
        <Input
          id="change_note"
          {...register("change_note")}
          placeholder="Optional details about this correction"
        />
        {errors.change_note?.message ? (
          <p className="text-sm text-destructive">{errors.change_note.message}</p>
        ) : null}
      </div>
    </div>
  );
}

export function EditStudentProfileForm({
  student,
  canEditMedical,
}: {
  student: StudentProfile;
  canEditMedical: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<UpdateStudentProfileInput>({
    resolver: zodResolver(updateStudentProfileSchema),
    defaultValues: {
      student_id: student.id,
      admission_number: student.admissionNumber,
      first_name: student.firstName,
      middle_name: student.middleName ?? "",
      last_name: student.lastName,
      date_of_birth: student.dateOfBirth,
      gender: student.gender as UpdateStudentProfileInput["gender"],
      enrollment_date: student.enrollmentDate,
      place_of_birth: student.placeOfBirth ?? "",
      religious_denomination: student.religiousDenomination ?? "",
      previous_school: student.previousSchool ?? "",
      proposed_admission_date: student.proposedAdmissionDate ?? "",
      is_zambian_citizen: student.isZambianCitizen,
      medical_notes: student.medicalNotes ?? "",
      vaccinated_smallpox: student.vaccinatedSmallpox,
      vaccination_date: student.vaccinationDate ?? "",
      change_reason: undefined,
      change_note: "",
    },
  });

  const reason = watch("change_reason");

  if (!open) {
    return (
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        Edit pupil details
      </Button>
    );
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle>Edit pupil details</CardTitle>
        <CardDescription>
          Every saved change is recorded in Profile Change History. A
          correction reason is required.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={handleSubmit((values) => {
            setServerError(null);
            startTransition(async () => {
              const result = await updateStudentProfileAction(values);
              if (result.error) {
                setServerError(result.error);
                return;
              }
              setOpen(false);
              router.refresh();
            });
          })}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2">
              <Label htmlFor="admission_number">Admission number</Label>
              <Input id="admission_number" {...register("admission_number")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="first_name">First name</Label>
              <Input id="first_name" {...register("first_name")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="middle_name">Middle name</Label>
              <Input id="middle_name" {...register("middle_name")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="last_name">Last name</Label>
              <Input id="last_name" {...register("last_name")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="date_of_birth">Date of birth</Label>
              <Input id="date_of_birth" type="date" {...register("date_of_birth")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gender">Gender</Label>
              <SelectNative id="gender" {...register("gender")}>
                {GENDERS.map((value) => (
                  <option key={value} value={value}>
                    {GENDER_LABELS[value]}
                  </option>
                ))}
              </SelectNative>
            </div>
            <div className="space-y-1">
              <Label htmlFor="enrollment_date">Enrollment date</Label>
              <Input
                id="enrollment_date"
                type="date"
                {...register("enrollment_date")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="place_of_birth">Place of birth</Label>
              <Input id="place_of_birth" {...register("place_of_birth")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="religious_denomination">Religious denomination</Label>
              <Input
                id="religious_denomination"
                {...register("religious_denomination")}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="previous_school">Present / last school</Label>
              <Input id="previous_school" {...register("previous_school")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="proposed_admission_date">Proposed admission date</Label>
              <Input
                id="proposed_admission_date"
                type="date"
                {...register("proposed_admission_date")}
              />
            </div>
          </div>

          {canEditMedical ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="medical_notes">Medical notes / allergies</Label>
                <Input id="medical_notes" {...register("medical_notes")} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="vaccination_date">Vaccination date</Label>
                <Input
                  id="vaccination_date"
                  type="date"
                  {...register("vaccination_date")}
                />
              </div>
            </div>
          ) : null}

          <ReasonFields register={register} reason={reason ?? ""} errors={errors} />

          {serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save corrections"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

export function EditGuardianProfileForm({
  studentId,
  guardian,
}: {
  studentId: string;
  guardian: StudentGuardianView;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors },
  } = useForm<UpdateGuardianProfileInput>({
    resolver: zodResolver(updateGuardianProfileSchema),
    defaultValues: {
      student_id: studentId,
      guardian_id: guardian.guardianId,
      first_name: guardian.firstName,
      last_name: guardian.lastName,
      phone: guardian.phone ?? "",
      alt_phone: guardian.altPhone ?? "",
      whatsapp: guardian.whatsapp ?? "",
      email: guardian.email ?? "",
      national_id: guardian.nationalId ?? "",
      occupation: guardian.occupation ?? "",
      address: guardian.address ?? "",
      postal_address: guardian.postalAddress ?? "",
      relationship:
        guardian.relationship as UpdateGuardianProfileInput["relationship"],
      is_primary_contact: guardian.isPrimary,
      is_emergency_contact: guardian.isEmergency,
      change_reason: undefined,
      change_note: "",
    },
  });

  const reason = watch("change_reason");

  if (!open) {
    return (
      <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>
        Edit guardian
      </Button>
    );
  }

  return (
    <div className="space-y-4 rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
      <div>
        <p className="font-medium">Edit {guardian.fullName}</p>
        {guardian.linkedStudentCount > 1 ? (
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-200">
            This guardian is linked to {guardian.linkedStudentCount} pupils.
            Saving updates the shared record for all of them. The change is
            recorded once and visible on each linked pupil profile.
          </p>
        ) : null}
      </div>

      <form
        className="space-y-4"
        onSubmit={handleSubmit((values) => {
          setServerError(null);
          startTransition(async () => {
            const result = await updateGuardianProfileAction(values);
            if (result.error) {
              setServerError(result.error);
              return;
            }
            setOpen(false);
            router.refresh();
          });
        })}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label>First name</Label>
            <Input {...register("first_name")} />
          </div>
          <div className="space-y-1">
            <Label>Last name</Label>
            <Input {...register("last_name")} />
          </div>
          <div className="space-y-1">
            <Label>Relationship</Label>
            <SelectNative {...register("relationship")}>
              {GUARDIAN_RELATIONSHIPS.map((value) => (
                <option key={value} value={value}>
                  {RELATIONSHIP_LABELS[value]}
                </option>
              ))}
            </SelectNative>
          </div>
          <div className="space-y-1">
            <Label>Phone</Label>
            <Input {...register("phone")} />
          </div>
          <div className="space-y-1">
            <Label>WhatsApp</Label>
            <Input {...register("whatsapp")} />
          </div>
          <div className="space-y-1">
            <Label>Alternate phone</Label>
            <Input {...register("alt_phone")} />
          </div>
          <div className="space-y-1">
            <Label>Email</Label>
            <Input {...register("email")} />
          </div>
          <div className="space-y-1">
            <Label>NRC / national ID</Label>
            <Input {...register("national_id")} />
          </div>
          <div className="space-y-1">
            <Label>Occupation</Label>
            <Input {...register("occupation")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Residential address</Label>
            <Input {...register("address")} />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label>Postal address</Label>
            <Input {...register("postal_address")} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("is_primary_contact")} />
            Primary contact
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" {...register("is_emergency_contact")} />
            Emergency contact
          </label>
        </div>

        <ReasonFields register={register} reason={reason ?? ""} errors={errors} />

        {serverError ? (
          <p className="text-sm text-destructive" role="alert">
            {serverError}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save guardian corrections"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => setOpen(false)}
          >
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
