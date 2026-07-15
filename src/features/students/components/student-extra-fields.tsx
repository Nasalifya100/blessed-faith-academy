"use client";

import type { FieldErrors, UseFormRegister } from "react-hook-form";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** Fields shared by Add Student and New Application (official form extras). */
export interface StudentExtraFormValues {
  place_of_birth?: string;
  religious_denomination?: string;
  previous_school?: string;
  proposed_admission_date?: string;
  vaccinated_smallpox?: boolean;
  vaccination_date?: string;
  medical_notes?: string;
  is_zambian_citizen?: boolean;
}

interface StudentExtraFieldsProps {
  register: UseFormRegister<StudentExtraFormValues & Record<string, unknown>>;
  errors: FieldErrors<StudentExtraFormValues>;
}

export function StudentExtraFields({
  register,
  errors,
}: StudentExtraFieldsProps) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
        Additional child details
      </h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="place_of_birth">Place of birth</Label>
          <Input id="place_of_birth" {...register("place_of_birth")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="religious_denomination">Religious denomination</Label>
          <Input
            id="religious_denomination"
            {...register("religious_denomination")}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="previous_school">Present / last school</Label>
          <Input id="previous_school" {...register("previous_school")} />
        </div>
        <div className="space-y-2">
          <Label htmlFor="proposed_admission_date">
            Proposed date of admission
          </Label>
          <Input
            id="proposed_admission_date"
            type="date"
            {...register("proposed_admission_date")}
          />
          {errors.proposed_admission_date ? (
            <p className="text-sm text-destructive">
              {errors.proposed_admission_date.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              {...register("is_zambian_citizen")}
            />
            The child is a Zambian citizen
          </label>
        </div>
        <div className="space-y-2">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 rounded border-input"
              {...register("vaccinated_smallpox")}
            />
            Vaccinated against smallpox
          </label>
        </div>
        <div className="space-y-2">
          <Label htmlFor="vaccination_date">Vaccination date (if yes)</Label>
          <Input
            id="vaccination_date"
            type="date"
            {...register("vaccination_date")}
          />
          {errors.vaccination_date ? (
            <p className="text-sm text-destructive">
              {errors.vaccination_date.message}
            </p>
          ) : null}
        </div>
        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor="medical_notes">
            Physical handicap, serious illness, or allergies
          </Label>
          <textarea
            id="medical_notes"
            rows={3}
            className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
            {...register("medical_notes")}
          />
        </div>
      </div>
    </section>
  );
}
