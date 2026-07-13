"use client";

import { useMemo, useState } from "react";
import { formatPrice } from "@/lib/format";
import {
  airlineStats,
  filterPlansByAirlines,
  type AirlineStat,
  type ExcludedAirline,
} from "@/lib/search/airline-filter";
import type { ProviderChoice, SearchParams } from "@/lib/search/types";
import type { SearchResponse, TripPlan } from "@/types/trip-plan";
import { ResultCard } from "./result-card";

type ResultsListProps = {
  response: SearchResponse | null;
  loading: boolean;
  error: string | null;
  searchContext: SearchParams | null;
  providerChoice: ProviderChoice;
  searchSaved: boolean;
  onSaveSearch: () => void;
  favoritePlanIds: Set<string>;
  onToggleFavorite: (plan: TripPlan) => void;
  excludedAirlines: ExcludedAirline[];
  onExcludeAirline: (airline: ExcludedAirline) => void;
};

function LoadingState() {
  return (
    <div className="space-y-3" aria-busy="true">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Searching many airport and date combinations for you…
      </p>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="h-36 animate-pulse rounded-2xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
        />
      ))}
    </div>
  );
}

export function ResultsList({
  response,
  loading,
  error,
  searchContext,
  providerChoice,
  searchSaved,
  onSaveSearch,
  favoritePlanIds,
  onToggleFavorite,
  excludedAirlines,
  onExcludeAirline,
}: ResultsListProps) {
  // Session exclusions are stored with the response they belong to, so a new
  // search automatically starts unfiltered without needing an effect.
  const [filter, setFilter] = useState<{ for: SearchResponse | null; excluded: string[] }>({
    for: null,
    excluded: [],
  });
  const excluded = useMemo(
    () => new Set(filter.for === response ? filter.excluded : []),
    [filter, response]
  );
  const permanentlyExcludedNames = useMemo(
    () => new Set(excludedAirlines.map((airline) => airline.name)),
    [excludedAirlines]
  );
  // Fresh searches exclude blocked airlines upstream; this list only matters
  // for results fetched before an airline was blocked.
  const airlines = useMemo(
    () =>
      airlineStats(response?.results ?? []).filter((stat) => !permanentlyExcludedNames.has(stat.name)),
    [response, permanentlyExcludedNames]
  );
  const visiblePlans = useMemo(
    () =>
      filterPlansByAirlines(
        response?.results ?? [],
        new Set([...excluded, ...permanentlyExcludedNames])
      ),
    [response, excluded, permanentlyExcludedNames]
  );

  function banAirline(stat: AirlineStat) {
    if (stat.code) onExcludeAirline({ code: stat.code, name: stat.name });
  }

  function toggleAirline(name: string) {
    const next = new Set(excluded);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    setFilter({ for: response, excluded: [...next] });
  }
  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="rounded-2xl border border-red-200 bg-red-50 p-5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        <p className="font-semibold">Search failed</p>
        <p className="mt-1">{error}</p>
      </div>
    );
  }

  if (!response) {
    return (
      <div className="rounded-2xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
        Fill in your trip idea above and we&apos;ll compare every sensible airport and date combination —
        any option that needs a self-managed airport change is clearly flagged.
      </div>
    );
  }

  if (response.results.length === 0) {
    return (
      <div className="rounded-2xl border border-zinc-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-950">
        <p className="text-sm font-semibold text-zinc-800 dark:text-zinc-200">
          No trips found for this search.
        </p>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          Try widening the date ranges, turning off “Direct only”, or enabling the separate-tickets fallback.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {excluded.size > 0
            ? `${visiblePlans.length} of ${response.results.length} trip plans shown`
            : `${response.results.length} trip plan${response.results.length === 1 ? "" : "s"} found`}
        </h2>
        <div className="flex items-center gap-3">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {response.meta.queriesRun} flight searches run
          </p>
          <button
            type="button"
            onClick={onSaveSearch}
            disabled={searchSaved}
            className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-100 disabled:cursor-default disabled:border-emerald-300 disabled:text-emerald-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800 dark:disabled:border-emerald-800 dark:disabled:text-emerald-400"
          >
            {searchSaved ? "Search saved ✓" : "Save this search"}
          </button>
        </div>
      </div>

      {response.meta.partialFailures.length > 0 && (
        <details className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <summary className="cursor-pointer">
            Some searches could not be completed, so a few combinations may be missing.
          </summary>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {response.meta.partialFailures.map((failure) => (
              <li key={failure}>{failure}</li>
            ))}
          </ul>
        </details>
      )}

      {airlines.length > 1 && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Filter by airline
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {airlines.map((airline) => (
              <span key={airline.name} className="flex items-center gap-2">
                <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-sky-600"
                    checked={!excluded.has(airline.name)}
                    onChange={() => toggleAirline(airline.name)}
                  />
                  {airline.name}
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    from {formatPrice(airline.minPrice, airline.currency)}
                  </span>
                </label>
                {airline.code && (
                  <button
                    type="button"
                    onClick={() => banAirline(airline)}
                    title={`Exclude ${airline.name} from all future searches`}
                    aria-label={`Exclude ${airline.name} from all future searches`}
                    className="text-xs text-zinc-400 hover:text-red-500"
                  >
                    🚫
                  </button>
                )}
              </span>
            ))}
          </div>
        </div>
      )}

      {visiblePlans.length === 0 ? (
        <p className="rounded-2xl border border-zinc-200 bg-white p-6 text-center text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
          No trips match the selected airlines — re-enable some airlines above.
        </p>
      ) : (
        visiblePlans.map((plan, index) => (
          <ResultCard
            key={plan.id}
            plan={plan}
            rank={index + 1}
            searchContext={searchContext}
            providerChoice={providerChoice}
            excludedAirlineCodes={excludedAirlines.map((airline) => airline.code)}
            isFavorite={favoritePlanIds.has(plan.id)}
            onToggleFavorite={onToggleFavorite}
          />
        ))
      )}
    </div>
  );
}
