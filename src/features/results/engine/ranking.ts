/**
 * Phase 2D.1 — ranking with configurable tie handling.
 */

import type {
  RankableScore,
  RankingTieMode,
  RankResult,
} from "@/features/results/types";

/**
 * Rank items by score descending (null scores unranked).
 *
 * COMPETITION (Olympic): 1,2,2,4
 * DENSE: 1,2,2,3
 * AVERAGE: tied share the mean of competition places (1, 2.5, 2.5, 4) as numeric
 * DISABLED: all positions null
 *
 * Equal academic scores remain tied. Secondary id sort is only for stable
 * iteration order inside a tied group; it does not break academic ties.
 */
export function rankScores(
  items: RankableScore[],
  tieMode: RankingTieMode = "COMPETITION",
): RankResult[] {
  if (tieMode === "DISABLED") {
    return items.map((item) => ({
      id: item.id,
      position: null,
      tied_count: 0,
    }));
  }

  const countable = items
    .filter((i) => i.score != null && Number.isFinite(i.score))
    .map((i) => ({ id: i.id, score: i.score as number }));

  countable.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.id.localeCompare(b.id);
  });

  const byId = new Map<string, RankResult>();
  for (const item of items) {
    byId.set(item.id, { id: item.id, position: null, tied_count: 0 });
  }

  let i = 0;
  let competitionPlace = 1;
  while (i < countable.length) {
    let j = i;
    while (
      j < countable.length &&
      countable[j].score === countable[i].score
    ) {
      j += 1;
    }
    const tiedCount = j - i;
    const startPlace = competitionPlace;
    const endPlace = competitionPlace + tiedCount - 1;

    let position: number;
    if (tieMode === "AVERAGE") {
      const sum = ((startPlace + endPlace) * tiedCount) / 2;
      position = sum / tiedCount;
    } else if (tieMode === "DENSE") {
      position = startPlace;
    } else {
      // COMPETITION
      position = startPlace;
    }

    for (let k = i; k < j; k++) {
      byId.set(countable[k].id, {
        id: countable[k].id,
        position,
        tied_count: tiedCount,
      });
    }

    if (tieMode === "DENSE") {
      competitionPlace = startPlace + 1;
    } else {
      competitionPlace = endPlace + 1;
    }
    i = j;
  }

  return items.map(
    (item) => byId.get(item.id) ?? { id: item.id, position: null, tied_count: 0 },
  );
}
