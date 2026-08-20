"use client";

import type { PlannedQuery, SearchPlan } from "@/lib/search/dry-run";

function routeOf(query: PlannedQuery): string {
  const first = `${query.origin} → ${query.destination} ${query.date}`;
  if (query.kind === "roundTrip") return `${first} / back ${query.returnDate}`;
  if (query.kind === "multiCity") {
    return `${first} / ${query.returnOrigin} → ${query.returnDestination} ${query.returnDate}`;
  }
  return first;
}

export function SearchPlanPanel({ plan }: { plan: SearchPlan }) {
  return (
    <section className="space-y-4 rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/30">
      <header className="space-y-1">
        <h2 className="text-sm font-semibold text-amber-900 dark:text-amber-200">
          Dry run — {plan.totals.queries} queries, {plan.totals.providerRequests} provider requests
        </h2>
        <ul className="list-inside list-disc text-xs text-amber-800 dark:text-amber-300">
          {plan.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </header>

      {plan.providers.map((providerPlan) => (
        <div key={providerPlan.provider} className="space-y-2">
          <h3 className="text-sm font-medium">
            {providerPlan.provider}: {providerPlan.queries} queries →{" "}
            {providerPlan.providerRequests} requests
          </h3>
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {providerPlan.stages
              .map((stage) => `${stage.stage} ${stage.queries}×${" "}(${stage.providerRequests} req)`)
              .join(" · ")}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="text-zinc-500 dark:text-zinc-400">
                <tr>
                  <th className="py-1 pr-3 font-medium">#</th>
                  <th className="py-1 pr-3 font-medium">Stage</th>
                  <th className="py-1 pr-3 font-medium">Kind</th>
                  <th className="py-1 pr-3 font-medium">Route</th>
                  <th className="py-1 pr-3 font-medium">Pax / cabin</th>
                  <th className="py-1 pr-3 font-medium">Flags</th>
                  <th className="py-1 font-medium">Req</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {providerPlan.plannedQueries.map((query, index) => (
                  <tr key={`${query.stage}-${index}`} className="border-t border-amber-200/60 dark:border-amber-800/40">
                    <td className="py-1 pr-3">{index + 1}</td>
                    <td className="py-1 pr-3">{query.stage}</td>
                    <td className="py-1 pr-3">{query.kind}</td>
                    <td className="py-1 pr-3">{routeOf(query)}</td>
                    <td className="py-1 pr-3">
                      {query.adults} · {query.cabinClass}
                    </td>
                    <td className="py-1 pr-3">
                      {[
                        query.nonStopOnly ? "nonstop" : null,
                        query.checkedBagIncluded ? "bag" : null,
                        query.excludedAirlines?.length ? `no ${query.excludedAirlines.join("/")}` : null,
                      ]
                        .filter(Boolean)
                        .join(" ") || "—"}
                    </td>
                    <td className="py-1">{query.providerRequests}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </section>
  );
}
