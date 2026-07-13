import type { TripPlan } from "../../types/trip-plan";

// A permanently blocked airline; the code feeds provider-level filters.
export type ExcludedAirline = {
  code: string;
  name: string;
};

export type AirlineStat = {
  name: string;
  // Null for plans saved before carrier codes were tracked.
  code: string | null;
  minPrice: number;
  currency: string;
};

function planAirlines(plan: TripPlan): Set<string> {
  return new Set([...plan.outbound.airlines, ...(plan.return?.airlines ?? [])]);
}

function planCarrierCodes(plan: TripPlan): Map<string, string> {
  const byName = new Map<string, string>();
  for (const carrier of [...(plan.outbound.carriers ?? []), ...(plan.return?.carriers ?? [])]) {
    if (!byName.has(carrier.name)) byName.set(carrier.name, carrier.code);
  }
  return byName;
}

// Every airline appearing in the plans, with the cheapest total price of any
// plan that involves it. Sorted cheapest-first.
export function airlineStats(plans: TripPlan[]): AirlineStat[] {
  const stats = new Map<string, AirlineStat>();
  for (const plan of plans) {
    const codes = planCarrierCodes(plan);
    for (const name of planAirlines(plan)) {
      const existing = stats.get(name);
      if (!existing || plan.totalPrice < existing.minPrice) {
        stats.set(name, {
          name,
          code: codes.get(name) ?? existing?.code ?? null,
          minPrice: plan.totalPrice,
          currency: plan.currency,
        });
      }
    }
  }
  return [...stats.values()].sort((a, b) => a.minPrice - b.minPrice || a.name.localeCompare(b.name));
}

// A plan stays visible only if none of its airlines are excluded — excluding
// an airline hides every plan that involves it on any leg.
export function filterPlansByAirlines(plans: TripPlan[], excluded: Set<string>): TripPlan[] {
  if (excluded.size === 0) return plans;
  return plans.filter((plan) => ![...planAirlines(plan)].some((name) => excluded.has(name)));
}
