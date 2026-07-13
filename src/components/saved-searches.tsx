"use client";

import { useState } from "react";
import { countryName, findAirport, findMetroArea } from "@/lib/data/airports";
import { formatDate, formatPrice } from "@/lib/format";
import type { ProviderChoice, SearchParams } from "@/lib/search/types";
import type { SavedSearchDto } from "@/types/saved";
import { ResultCard } from "./result-card";

function slotName(country: string | undefined, airport: string | undefined): string {
  if (airport) {
    const metro = findMetroArea(airport);
    if (metro) return `${metro.name} (all airports)`;
    const known = findAirport(airport);
    return known ? `${airport} (${known.city})` : airport;
  }
  return countryName(country ?? "");
}

function describeSearch(params: SearchParams): string {
  const outbound =
    `${params.originAirport} → ${slotName(params.destinationCountry, params.destinationAirport)} ` +
    `(${formatDate(params.outboundDateFrom)} – ${formatDate(params.outboundDateTo)})`;
  if (params.outboundOnly) {
    return `${outbound}, one way`;
  }
  return (
    `${outbound}, back ${slotName(params.returnFromCountry, params.returnFromAirport)} → ` +
    `${slotName(params.returnToCountry, params.returnToAirport)} ` +
    `(${formatDate(params.returnDateFrom ?? "")} – ${formatDate(params.returnDateTo ?? "")})`
  );
}

type SavedSearchesProps = {
  searches: SavedSearchDto[];
  loading: boolean;
  providerChoice: ProviderChoice;
  onLoad: (search: SavedSearchDto) => void;
  onDelete: (id: number) => void;
  onRemoveFavorite: (id: number) => void;
};

export function SavedSearches({
  searches,
  loading,
  providerChoice,
  onLoad,
  onDelete,
  onRemoveFavorite,
}: SavedSearchesProps) {
  const [expandedFavoriteId, setExpandedFavoriteId] = useState<number | null>(null);

  if (searches.length === 0) return null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-5 dark:border-zinc-800 dark:bg-zinc-950">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Saved searches
      </h2>
      <ul className="space-y-3">
        {searches.map((search) => (
          <li key={search.id} className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-zinc-800 dark:text-zinc-200">
                {describeSearch(search.params)}
                {search.params.directOnly && (
                  <span className="ml-2 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-700 dark:bg-sky-950 dark:text-sky-300">
                    Direct only
                  </span>
                )}
              </span>
              <span className="flex gap-2">
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => onLoad(search)}
                  className="rounded-md bg-sky-600 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                >
                  Search again
                </button>
                <button
                  type="button"
                  onClick={() => onDelete(search.id)}
                  className="rounded-md border border-zinc-300 px-3 py-1 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  Delete
                </button>
              </span>
            </div>
            {search.favorites.length > 0 && (
              <ul className="mt-2 space-y-1 border-t border-zinc-200 pt-2 dark:border-zinc-800">
                {search.favorites.map((favorite) => (
                  <li key={favorite.id} className="text-xs text-zinc-600 dark:text-zinc-400">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span>
                        ★ {favorite.plan.outbound.from} → {favorite.plan.outbound.to} (
                        {formatDate(favorite.plan.outbound.date)})
                        {favorite.plan.return &&
                          ` · back ${favorite.plan.return.from} → ${favorite.plan.return.to} (${formatDate(favorite.plan.return.date)})`}{" "}
                        ·{" "}
                        <span className="font-semibold text-zinc-800 dark:text-zinc-200">
                          {formatPrice(favorite.plan.totalPrice, favorite.plan.currency)}
                        </span>
                      </span>
                      <span className="flex gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedFavoriteId(expandedFavoriteId === favorite.id ? null : favorite.id)
                          }
                          className="font-medium text-sky-600 hover:underline dark:text-sky-400"
                        >
                          {expandedFavoriteId === favorite.id ? "Hide details" : "Details"}
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemoveFavorite(favorite.id)}
                          className="text-zinc-400 hover:text-red-500"
                          aria-label="Remove favorite"
                        >
                          Remove
                        </button>
                      </span>
                    </div>
                    {expandedFavoriteId === favorite.id && (
                      <div className="mt-2">
                        <p className="mb-2 text-xs text-zinc-400 dark:text-zinc-500">
                          Saved on {formatDate(favorite.createdAt.slice(0, 10))} — prices and links may
                          have changed since.
                        </p>
                        <ResultCard
                          plan={favorite.plan}
                          rank={0}
                          searchContext={search.params}
                          providerChoice={providerChoice}
                          isFavorite
                          onToggleFavorite={() => onRemoveFavorite(favorite.id)}
                        />
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
