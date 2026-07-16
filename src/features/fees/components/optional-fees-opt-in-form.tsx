"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";

import { optInOptionalFeesAction } from "@/features/fees/actions";
import type { OptionalFeeOption } from "@/features/fees/queries";
import { formatKwacha } from "@/lib/money";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

interface OptionalFeesOptInFormProps {
  studentId: string;
  termId: string | null;
  termName: string | null;
  meals: OptionalFeeOption[];
  uniforms: OptionalFeeOption[];
  activeMealFeeItemId: string | null;
}

export function OptionalFeesOptInForm({
  studentId,
  termId,
  termName,
  meals,
  uniforms,
  activeMealFeeItemId,
}: OptionalFeesOptInFormProps) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [mealId, setMealId] = useState<string>("");
  const [uniformIds, setUniformIds] = useState<string[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const activeMeal = useMemo(
    () => meals.find((meal) => meal.id === activeMealFeeItemId) ?? null,
    [meals, activeMealFeeItemId],
  );

  const availableUniforms = useMemo(
    () => uniforms.filter((item) => !item.alreadyCharged),
    [uniforms],
  );

  const chargedUniforms = useMemo(
    () => uniforms.filter((item) => item.alreadyCharged),
    [uniforms],
  );

  const hasMealAlready = Boolean(activeMealFeeItemId);
  const canAddMeal = !hasMealAlready && meals.length > 0;
  const canAddUniform = availableUniforms.length > 0;
  const canAddAnything = canAddMeal || canAddUniform;

  function toggleUniform(id: string) {
    setUniformIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setServerError(null);
    setIsSubmitting(true);

    const result = await optInOptionalFeesAction({
      studentId,
      termId: termId ?? undefined,
      mealFeeItemId: mealId || null,
      uniformFeeItemIds: uniformIds,
    });

    setIsSubmitting(false);

    if (result.error) {
      setServerError(result.error);
      return;
    }

    setMealId("");
    setUniformIds([]);
    setOpen(false);
    router.refresh();
  }

  const statusLines: string[] = [];
  if (activeMeal) {
    statusLines.push(
      `Meal plan on statement${termName ? ` for ${termName}` : ""}: ${activeMeal.name} (${formatKwacha(activeMeal.amount)}).`,
    );
  }
  if (chargedUniforms.length > 0) {
    statusLines.push(
      chargedUniforms.length === 1
        ? `Uniform on statement: ${chargedUniforms[0]!.name}.`
        : `${chargedUniforms.length} uniform items are on the statement.`,
    );
  }

  const addLabel =
    canAddMeal && canAddUniform
      ? "Add meals / uniforms"
      : canAddMeal
        ? "Add meal plan"
        : "Add uniforms";

  if (!canAddAnything) {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Optional charges</CardTitle>
          <CardDescription>
            Meal and uniform add-ons for this student.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          {statusLines.length > 0 ? (
            statusLines.map((line) => <p key={line}>{line}</p>)
          ) : (
            <p>No optional meal or uniform items are set up yet.</p>
          )}
          {hasMealAlready &&
          uniforms.length > 0 &&
          availableUniforms.length === 0 ? (
            <p>All listed uniforms are already on this statement.</p>
          ) : null}
          {hasMealAlready ? (
            <p>
              To change meal plan, cancel the meal line on the Charges tab,
              then add a new one.
            </p>
          ) : null}
          <p className="text-xs">
            Add is unavailable — there is nothing left to opt in under the
            current rules.
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    return (
      <Card className="shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Optional charges</CardTitle>
          <CardDescription>
            Meals are charged per term
            {termName ? ` (${termName})` : ""}; uniforms once per year.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {statusLines.map((line) => (
            <p key={line} className="text-sm text-muted-foreground">
              {line}
            </p>
          ))}
          {hasMealAlready ? (
            <p className="text-xs text-muted-foreground">
              To switch meal plan, cancel the current meal charge on the Charges
              tab first.
            </p>
          ) : null}
          <Button
            type="button"
            variant="outline"
            className="gap-1.5"
            onClick={() => setOpen(true)}
          >
            <Plus className="size-4" aria-hidden />
            {addLabel}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-0" noValidate>
      <Card className="shadow-sm">
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="space-y-1">
            <CardTitle className="text-base">{addLabel}</CardTitle>
            <CardDescription>
              Select optional items to add to this student&apos;s statement.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          {statusLines.length > 0 ? (
            <div className="space-y-1 rounded-xl border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
              {statusLines.map((line) => (
                <p key={line}>{line}</p>
              ))}
            </div>
          ) : null}

          {canAddMeal ? (
            <fieldset className="space-y-2 rounded-xl border p-3">
              <legend className="px-1 text-sm font-medium">
                Meal plan (pick one)
              </legend>
              <p className="text-xs text-muted-foreground">
                Charged for {termName ?? "the current term"}.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="meal"
                  value=""
                  checked={mealId === ""}
                  onChange={() => setMealId("")}
                  className="size-4"
                />
                None
              </label>
              {meals.map((meal) => (
                <label
                  key={meal.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="radio"
                    name="meal"
                    value={meal.id}
                    checked={mealId === meal.id}
                    disabled={meal.amount <= 0}
                    onChange={() => setMealId(meal.id)}
                    className="size-4"
                  />
                  <span>
                    {meal.name} — {formatKwacha(meal.amount)}
                    {meal.amount <= 0 ? " (unavailable)" : ""}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}

          {canAddUniform ? (
            <fieldset className="space-y-2 rounded-xl border p-3">
              <legend className="px-1 text-sm font-medium">Uniforms</legend>
              <p className="text-xs text-muted-foreground">
                Select any items not yet charged this year.
              </p>
              {availableUniforms.map((item) => (
                <label
                  key={item.id}
                  className="flex items-center gap-2 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={uniformIds.includes(item.id)}
                    disabled={item.amount <= 0}
                    onChange={() => toggleUniform(item.id)}
                    className="size-4 rounded border-input"
                  />
                  <span>
                    {item.name} — {formatKwacha(item.amount)}
                    {item.amount <= 0 ? " (unavailable)" : ""}
                  </span>
                </label>
              ))}
            </fieldset>
          ) : uniforms.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              All listed uniforms are already on this statement.
            </p>
          ) : null}

          {serverError ? (
            <p className="text-sm text-destructive" role="alert">
              {serverError}
            </p>
          ) : null}

          <Button
            type="submit"
            disabled={isSubmitting || (!mealId && uniformIds.length === 0)}
            className="gap-1.5"
          >
            <Plus className="size-4" aria-hidden />
            {isSubmitting ? "Adding…" : "Add to statement"}
          </Button>
        </CardContent>
      </Card>
    </form>
  );
}
