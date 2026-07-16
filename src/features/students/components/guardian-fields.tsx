"use client";

import { useState, useTransition } from "react";
import type {
  FieldErrors,
  FieldValues,
  Path,
  UseFormGetValues,
  UseFormRegister,
  UseFormSetValue,
} from "react-hook-form";

import {
  GUARDIAN_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  type GuardianInput,
} from "@/features/students/schemas";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SelectNative } from "@/components/ui/select-native";

type WithGuardians = FieldValues & { guardians: GuardianInput[] };

interface GuardianFieldsProps<T extends WithGuardians> {
  index: number;
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  isPrimary: boolean;
  canRemove: boolean;
  onMakePrimary: () => void;
  onRemove: () => void;
  nationalId?: string;
  phone?: string;
  existingGuardianId?: string;
  onSelectExistingGuardian?: (id: string) => void;
  onClearExistingGuardian?: () => void;
}

export function GuardianFields<T extends WithGuardians>({
  index,
  register,
  errors,
  isPrimary,
  canRemove,
  onMakePrimary,
  onRemove,
  nationalId = "",
  phone = "",
  existingGuardianId = "",
  onSelectExistingGuardian,
  onClearExistingGuardian,
}: GuardianFieldsProps<T>) {
  const fieldErrors = (
    errors.guardians as FieldErrors<GuardianInput>[] | undefined
  )?.[index];
  const [candidates, setCandidates] = useState<
    {
      id: string;
      firstName: string;
      lastName: string;
      phone: string | null;
      nationalId: string | null;
      matchReason: string;
    }[]
  >([]);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [isLookingUp, startLookup] = useTransition();

  function findMatches() {
    setLookupError(null);
    startLookup(async () => {
      const { listGuardianCandidatesAction } = await import(
        "@/features/students/actions"
      );
      const result = await listGuardianCandidatesAction({
        nationalId,
        phone,
      });
      if (result.error) {
        setLookupError(result.error);
        setCandidates([]);
        return;
      }
      setCandidates(result.candidates);
      if (result.candidates.length === 0) {
        setLookupError("No matching guardians found for NRC or phone.");
      }
    });
  }

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">Guardian {index + 1}</p>
        {canRemove ? (
          <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
            Remove
          </Button>
        ) : null}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`g-${index}-first`}>First name</Label>
          <Input
            id={`g-${index}-first`}
            aria-invalid={Boolean(fieldErrors?.first_name)}
            {...register(`guardians.${index}.first_name` as Path<T>)}
          />
          {fieldErrors?.first_name ? (
            <p className="text-sm text-destructive">
              {fieldErrors.first_name.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`g-${index}-last`}>Last name</Label>
          <Input
            id={`g-${index}-last`}
            aria-invalid={Boolean(fieldErrors?.last_name)}
            {...register(`guardians.${index}.last_name` as Path<T>)}
          />
          {fieldErrors?.last_name ? (
            <p className="text-sm text-destructive">
              {fieldErrors.last_name.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`g-${index}-rel`}>Relationship</Label>
          <SelectNative
            id={`g-${index}-rel`}
            {...register(`guardians.${index}.relationship` as Path<T>)}
          >
            {GUARDIAN_RELATIONSHIPS.map((value) => (
              <option key={value} value={value}>
                {RELATIONSHIP_LABELS[value]}
              </option>
            ))}
          </SelectNative>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`g-${index}-phone`}>Phone number</Label>
          <Input
            id={`g-${index}-phone`}
            {...register(`guardians.${index}.phone` as Path<T>)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`g-${index}-whatsapp`}>WhatsApp</Label>
          <Input
            id={`g-${index}-whatsapp`}
            {...register(`guardians.${index}.whatsapp` as Path<T>)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`g-${index}-alt`}>Alternate phone</Label>
          <Input
            id={`g-${index}-alt`}
            {...register(`guardians.${index}.alt_phone` as Path<T>)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`g-${index}-email`}>Email</Label>
          <Input
            id={`g-${index}-email`}
            type="email"
            aria-invalid={Boolean(fieldErrors?.email)}
            {...register(`guardians.${index}.email` as Path<T>)}
          />
          {fieldErrors?.email ? (
            <p className="text-sm text-destructive">
              {fieldErrors.email.message}
            </p>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label htmlFor={`g-${index}-nrc`}>NRC / national ID</Label>
          <Input
            id={`g-${index}-nrc`}
            {...register(`guardians.${index}.national_id` as Path<T>)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`g-${index}-occ`}>Occupation</Label>
          <Input
            id={`g-${index}-occ`}
            {...register(`guardians.${index}.occupation` as Path<T>)}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`g-${index}-addr`}>Residential address</Label>
          <Input
            id={`g-${index}-addr`}
            {...register(`guardians.${index}.address` as Path<T>)}
          />
        </div>

        <div className="space-y-2 sm:col-span-2">
          <Label htmlFor={`g-${index}-postal`}>Postal address</Label>
          <Input
            id={`g-${index}-postal`}
            {...register(`guardians.${index}.postal_address` as Path<T>)}
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            checked={isPrimary}
            onChange={onMakePrimary}
          />
          Primary contact
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 rounded border-input"
            {...register(`guardians.${index}.is_emergency_contact` as Path<T>)}
          />
          Emergency contact
        </label>
      </div>

      {onSelectExistingGuardian ? (
        <div className="space-y-2 rounded-lg border border-dashed p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={isLookingUp || (!nationalId.trim() && !phone.trim())}
              onClick={findMatches}
            >
              {isLookingUp ? "Searching…" : "Find existing guardian"}
            </Button>
            {existingGuardianId ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onClearExistingGuardian}
              >
                Clear link
              </Button>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            NRC matches can auto-link on save. Phone matches need an explicit
            selection here (shared numbers are not merged automatically).
          </p>
          {existingGuardianId ? (
            <p className="text-sm text-emerald-700">
              Linked to existing guardian record.
            </p>
          ) : null}
          {lookupError ? (
            <p className="text-sm text-muted-foreground">{lookupError}</p>
          ) : null}
          {candidates.length > 0 ? (
            <ul className="space-y-2">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <button
                    type="button"
                    className="w-full rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50"
                    onClick={() => onSelectExistingGuardian(candidate.id)}
                  >
                    <span className="font-medium">
                      {candidate.firstName} {candidate.lastName}
                    </span>
                    <span className="text-muted-foreground">
                      {" "}
                      · {candidate.matchReason}
                      {candidate.phone ? ` · ${candidate.phone}` : ""}
                      {candidate.nationalId
                        ? ` · NRC ${candidate.nationalId}`
                        : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function makePrimaryHelper<T extends WithGuardians>(
  getValues: UseFormGetValues<T>,
  setValue: UseFormSetValue<T>,
  index: number,
) {
  const guardians = getValues("guardians" as Path<T>) as GuardianInput[];
  guardians.forEach((_, i) => {
    setValue(
      `guardians.${i}.is_primary_contact` as Path<T>,
      (i === index) as T[Path<T>],
      { shouldValidate: true },
    );
  });
}
