"use client";

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
}

export function GuardianFields<T extends WithGuardians>({
  index,
  register,
  errors,
  isPrimary,
  canRemove,
  onMakePrimary,
  onRemove,
}: GuardianFieldsProps<T>) {
  const fieldErrors = (
    errors.guardians as FieldErrors<GuardianInput>[] | undefined
  )?.[index];

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
