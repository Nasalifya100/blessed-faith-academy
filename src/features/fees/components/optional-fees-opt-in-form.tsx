"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { optInOptionalFeesAction } from "@/features/fees/actions";
import type { OptionalFeeOption } from "@/features/fees/queries";
import { formatKwacha } from "@/lib/money";
import { Button } from "@/components/ui/button";

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
        ? `Uniform on statement: ${chargedUniforms[0].name}.`
        : `${chargedUniforms.length} uniform items are on the statement.`,
    );
  }

  if (!canAddAnything) {
    return (
      <div className="space-y-1 text-sm text-muted-foreground">
        {statusLines.length > 0 ? (
          statusLines.map((line) => <p key={line}>{line}</p>)
        ) : (
          <p>No optional meal or uniform items are set up yet.</p>
        )}
        {hasMealAlready && uniforms.length > 0 && availableUniforms.length === 0 ? (
          <p>All listed uniforms are already on this statement.</p>
        ) : null}
        {hasMealAlready ? (
          <p>
            To change meal plan, remove the meal line on the statement below,
            then add a new one.
          </p>
        ) : null}
      </div>
    );
  }

  if (!open) {
    return (
      <div className="space-y-2">
        {statusLines.map((line) => (
          <p key={line} className="text-sm text-muted-foreground">
            {line}
          </p>
        ))}
        {hasMealAlready ? (
          <p className="text-xs text-muted-foreground">
            To switch meal plan, remove the current meal charge on the statement
            first.
          </p>
        ) : null}
        <Button type="button" variant="outline" onClick={() => setOpen(true)}>
          {canAddMeal && canAddUniform
            ? "Add meals / uniforms"
            : canAddMeal
              ? "Add meal plan"
              : "Add uniforms"}
        </Button>
        <p className="text-xs text-muted-foreground">
          Meals are charged per term
          {termName ? ` (${termName})` : ""}; uniforms once per year.
        </p>
      </div>
    );
  }

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 rounded-lg border p-4"
      noValidate
    >
      <div className="flex items-center justify-between">
        <h3 className="font-medium">
          {canAddMeal && canAddUniform
            ? "Add meals / uniforms"
            : canAddMeal
              ? "Add meal plan"
              : "Add uniforms"}
        </h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>

      {statusLines.length > 0 ? (
        <div className="space-y-1 text-sm text-muted-foreground">
          {statusLines.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}

      {canAddMeal ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Meal plan (pick one)</legend>
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
            />
            None
          </label>
          {meals.map((meal) => (
            <label key={meal.id} className="flex items-center gap-2 text-sm">
              <input
                type="radio"
                name="meal"
                value={meal.id}
                checked={mealId === meal.id}
                disabled={meal.amount <= 0}
                onChange={() => setMealId(meal.id)}
              />
              <span>
                {meal.name} — {formatKwacha(meal.amount)}
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      {canAddUniform ? (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Uniforms</legend>
          <p className="text-xs text-muted-foreground">
            Select any items not yet charged this year.
          </p>
          {availableUniforms.map((item) => (
            <label key={item.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={uniformIds.includes(item.id)}
                disabled={item.amount <= 0}
                onChange={() => toggleUniform(item.id)}
              />
              <span>
                {item.name} — {formatKwacha(item.amount)}
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
        disabled={
          isSubmitting || (!mealId && uniformIds.length === 0)
        }
      >
        {isSubmitting ? "Adding..." : "Add to statement"}
      </Button>
    </form>
  );
}
