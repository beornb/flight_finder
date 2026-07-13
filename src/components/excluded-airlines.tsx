"use client";

import type { ExcludedAirline } from "@/lib/search/airline-filter";

type ExcludedAirlinesProps = {
  airlines: ExcludedAirline[];
  onRemove: (code: string) => void;
};

export function ExcludedAirlines({ airlines, onRemove }: ExcludedAirlinesProps) {
  if (airlines.length === 0) return null;

  return (
    <section className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-950">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        Excluded airlines — never shown in any search
      </p>
      <div className="flex flex-wrap gap-2">
        {airlines.map((airline) => (
          <span
            key={airline.code}
            className="flex items-center gap-2 rounded-full bg-red-50 px-3 py-1 text-sm text-red-700 dark:bg-red-950 dark:text-red-300"
          >
            {airline.name} ({airline.code})
            <button
              type="button"
              onClick={() => onRemove(airline.code)}
              aria-label={`Allow ${airline.name} again`}
              title="Remove from exclusion list"
              className="text-red-400 hover:text-red-600 dark:hover:text-red-200"
            >
              ✕
            </button>
          </span>
        ))}
      </div>
    </section>
  );
}
