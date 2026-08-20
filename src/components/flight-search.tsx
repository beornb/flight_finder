"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { stableStringify } from "@/lib/saved/canonical";
import type { ExcludedAirline } from "@/lib/search/airline-filter";
import type { SearchPlan } from "@/lib/search/dry-run";
import type { SearchParams } from "@/lib/search/types";
import type { SavedSearchDto } from "@/types/saved";
import type { SearchResponse, TripPlan } from "@/types/trip-plan";
import { ExcludedAirlines } from "./excluded-airlines";
import type { LocationValue } from "./location-select";
import { ResultsList } from "./results-list";
import { SavedSearches } from "./saved-searches";
import { SearchPlanPanel } from "./search-plan";
import { DEFAULT_SEARCH_VALUES, SearchForm, type SearchFormValues } from "./search-form";

// Maps form values to the API contract. Mirrors the server-side schema
// transform: one-way searches drop their return fields so saved-search
// comparisons match what the server stores.
function toSearchParams(values: SearchFormValues): SearchParams {
  const params: SearchParams = {
    originAirport: values.origin.code,
    outboundDateFrom: values.outboundDateFrom,
    outboundDateTo: values.outboundDateTo,
    destinationCountry: values.destination.kind === "country" ? values.destination.code : undefined,
    destinationAirport: values.destination.kind === "airport" ? values.destination.code : undefined,
    directOnly: values.directOnly,
    outboundOnly: values.outboundOnly,
    returnDateFrom: values.returnDateFrom,
    returnDateTo: values.returnDateTo,
    returnFromCountry: values.returnFrom.kind === "country" ? values.returnFrom.code : undefined,
    returnFromAirport: values.returnFrom.kind === "airport" ? values.returnFrom.code : undefined,
    returnToCountry: values.returnTo.kind === "country" ? values.returnTo.code : undefined,
    returnToAirport: values.returnTo.kind === "airport" ? values.returnTo.code : undefined,
    adults: values.adults,
    cabinClass: values.cabinClass,
    thorough: values.thorough,
    checkedBagIncluded: values.checkedBagIncluded,
    allowSeparateTicketsSameAirportOnly: values.allowSeparateTicketsSameAirportOnly,
    maxLegHours: values.maxLegHours ?? undefined,
  };
  if (!values.outboundOnly) return params;
  return {
    ...params,
    returnDateFrom: undefined,
    returnDateTo: undefined,
    returnFromCountry: undefined,
    returnFromAirport: undefined,
    returnToCountry: undefined,
    returnToAirport: undefined,
    allowSeparateTicketsSameAirportOnly: false,
  };
}

function toLocation(
  country: string | undefined,
  airport: string | undefined,
  fallback: LocationValue
): LocationValue {
  if (airport) return { kind: "airport", code: airport };
  if (country) return { kind: "country", code: country };
  return fallback;
}

const STORED_VALUES_KEY = "flight-finder:search-values";
const EXCLUDED_AIRLINES_KEY = "flight-finder:excluded-airlines";

function loadExcludedAirlines(): ExcludedAirline[] | null {
  try {
    const raw = localStorage.getItem(EXCLUDED_AIRLINES_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter(
      (entry): entry is ExcludedAirline =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as ExcludedAirline).code === "string" &&
        typeof (entry as ExcludedAirline).name === "string"
    );
  } catch {
    return null;
  }
}

function isLocationValue(value: unknown): value is LocationValue {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown; code?: unknown };
  return (v.kind === "country" || v.kind === "airport") && typeof v.code === "string";
}

// Restores the last-used form values; falls back to defaults when the stored
// shape is stale or the dates are already in the past.
function loadStoredValues(): SearchFormValues | null {
  try {
    const raw = localStorage.getItem(STORED_VALUES_KEY);
    if (!raw) return null;
    const merged: SearchFormValues = { ...DEFAULT_SEARCH_VALUES, ...(JSON.parse(raw) as Partial<SearchFormValues>) };
    if (![merged.origin, merged.destination, merged.returnFrom, merged.returnTo].every(isLocationValue)) {
      return null;
    }
    if (!["mock", "ignav", "duffel", "serpapi", "all"].includes(merged.provider)) {
      merged.provider = DEFAULT_SEARCH_VALUES.provider;
    }
    const today = new Date().toISOString().slice(0, 10);
    if (merged.outboundDateFrom < today) {
      merged.outboundDateFrom = DEFAULT_SEARCH_VALUES.outboundDateFrom;
      merged.outboundDateTo = DEFAULT_SEARCH_VALUES.outboundDateTo;
      merged.returnDateFrom = DEFAULT_SEARCH_VALUES.returnDateFrom;
      merged.returnDateTo = DEFAULT_SEARCH_VALUES.returnDateTo;
    }
    return merged;
  } catch {
    return null;
  }
}

async function readError(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { error?: unknown };
    if (data.error) return String(data.error);
  } catch {
    // fall through
  }
  return fallback;
}

export function FlightSearch() {
  const [values, setValues] = useState<SearchFormValues>(DEFAULT_SEARCH_VALUES);
  const [lastSearched, setLastSearched] = useState<SearchParams | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [plan, setPlan] = useState<SearchPlan | null>(null);
  const [saved, setSaved] = useState<SavedSearchDto[]>([]);
  const [excludedAirlines, setExcludedAirlines] = useState<ExcludedAirline[]>([]);

  const refreshSaved = useCallback(async () => {
    try {
      const res = await fetch("/api/saved-searches");
      if (!res.ok) return;
      const data = (await res.json()) as { searches: SavedSearchDto[] };
      setSaved(data.searches);
    } catch {
      // saved list is non-critical; searching still works without it
    }
  }, []);

  // Restore after mount (not during render) so server and client HTML match.
  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(() => {
      if (cancelled) return;
      const stored = loadStoredValues();
      if (stored) setValues(stored);
      const excluded = loadExcludedAirlines();
      if (excluded) setExcludedAirlines(excluded);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/saved-searches")
      .then((res) => (res.ok ? (res.json() as Promise<{ searches: SavedSearchDto[] }>) : null))
      .then((data) => {
        if (!cancelled && data) setSaved(data.searches);
      })
      .catch(() => {
        // saved list is non-critical; searching still works without it
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The saved search matching the results on screen, if any.
  const currentSaved = useMemo(() => {
    if (!lastSearched) return undefined;
    const canonical = stableStringify(lastSearched);
    return saved.find((search) => stableStringify(search.params) === canonical);
  }, [saved, lastSearched]);

  const favoriteIdsByPlan = useMemo(() => {
    const map = new Map<string, number>();
    for (const favorite of currentSaved?.favorites ?? []) {
      map.set(favorite.plan.id, favorite.id);
    }
    return map;
  }, [currentSaved]);

  async function handleSearch(searchValues: SearchFormValues) {
    setLoading(true);
    setError(null);
    try {
      localStorage.setItem(STORED_VALUES_KEY, JSON.stringify(searchValues));
    } catch {
      // storage may be unavailable (private mode, quota); searching still works
    }
    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...toSearchParams(searchValues),
          provider: searchValues.provider,
          excludedAirlines: excludedAirlines.length > 0 ? excludedAirlines.map((a) => a.code) : undefined,
        }),
      });
      if (!res.ok) {
        setError(await readError(res, "Search failed. Please try again."));
        setResponse(null);
        setPlan(null);
        return;
      }
      const body = (await res.json()) as SearchResponse | SearchPlan;
      // SEARCH_DRY_RUN returns the query plan instead of fares.
      if ("dryRun" in body) {
        setPlan(body);
        setResponse(null);
        return;
      }
      setPlan(null);
      setResponse(body);
      setLastSearched(toSearchParams(searchValues));
    } catch {
      setError("Could not reach the search service. Please try again.");
      setResponse(null);
      setPlan(null);
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveSearch() {
    if (!lastSearched) return;
    const res = await fetch("/api/saved-searches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(lastSearched),
    });
    if (!res.ok) {
      setError(await readError(res, "Could not save the search."));
      return;
    }
    await refreshSaved();
  }

  async function handleToggleFavorite(plan: TripPlan) {
    if (!lastSearched) return;
    const favoriteId = favoriteIdsByPlan.get(plan.id);
    const res = favoriteId
      ? await fetch(`/api/favorites/${favoriteId}`, { method: "DELETE" })
      : await fetch("/api/favorites", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ search: lastSearched, plan }),
        });
    if (!res.ok) {
      setError(await readError(res, "Could not update the favorite."));
      return;
    }
    await refreshSaved();
  }

  async function handleDeleteSaved(id: number) {
    const res = await fetch(`/api/saved-searches/${id}`, { method: "DELETE" });
    if (res.ok) await refreshSaved();
  }

  async function handleRemoveFavorite(id: number) {
    const res = await fetch(`/api/favorites/${id}`, { method: "DELETE" });
    if (res.ok) await refreshSaved();
  }

  function persistExcludedAirlines(next: ExcludedAirline[]) {
    setExcludedAirlines(next);
    try {
      localStorage.setItem(EXCLUDED_AIRLINES_KEY, JSON.stringify(next));
    } catch {
      // ignore: exclusion still applies for this session
    }
  }

  function handleExcludeAirline(airline: ExcludedAirline) {
    if (excludedAirlines.some((entry) => entry.code === airline.code)) return;
    persistExcludedAirlines([...excludedAirlines, airline]);
  }

  function handleRemoveExcludedAirline(code: string) {
    persistExcludedAirlines(excludedAirlines.filter((entry) => entry.code !== code));
  }

  function handleClear() {
    setValues(DEFAULT_SEARCH_VALUES);
    try {
      localStorage.removeItem(STORED_VALUES_KEY);
    } catch {
      // ignore
    }
  }

  function handleLoadSaved(search: SavedSearchDto) {
    const p = search.params;
    // One-way saved searches have no return fields; refill those from defaults.
    const merged: SearchFormValues = {
      origin: { kind: "airport", code: p.originAirport },
      destination: toLocation(p.destinationCountry, p.destinationAirport, DEFAULT_SEARCH_VALUES.destination),
      returnFrom: toLocation(p.returnFromCountry, p.returnFromAirport, DEFAULT_SEARCH_VALUES.returnFrom),
      returnTo: toLocation(p.returnToCountry, p.returnToAirport, DEFAULT_SEARCH_VALUES.returnTo),
      outboundDateFrom: p.outboundDateFrom,
      outboundDateTo: p.outboundDateTo,
      returnDateFrom: p.returnDateFrom ?? DEFAULT_SEARCH_VALUES.returnDateFrom,
      returnDateTo: p.returnDateTo ?? DEFAULT_SEARCH_VALUES.returnDateTo,
      directOnly: p.directOnly,
      outboundOnly: p.outboundOnly,
      adults: p.adults,
      cabinClass: p.cabinClass,
      thorough: p.thorough ?? false,
      maxLegHours: p.maxLegHours ?? null,
      checkedBagIncluded: p.checkedBagIncluded,
      allowSeparateTicketsSameAirportOnly: p.outboundOnly
        ? DEFAULT_SEARCH_VALUES.allowSeparateTicketsSameAirportOnly
        : p.allowSeparateTicketsSameAirportOnly,
      // Provider preference isn't part of a saved search; keep the current one.
      provider: values.provider,
    };
    setValues(merged);
    void handleSearch(merged);
  }

  return (
    <div className="space-y-8">
      <SearchForm
        values={values}
        onChange={setValues}
        loading={loading}
        onSearch={handleSearch}
        onClear={handleClear}
      />
      <SavedSearches
        searches={saved}
        loading={loading}
        providerChoice={values.provider}
        onLoad={handleLoadSaved}
        onDelete={handleDeleteSaved}
        onRemoveFavorite={handleRemoveFavorite}
      />
      <ExcludedAirlines airlines={excludedAirlines} onRemove={handleRemoveExcludedAirline} />
      {plan && <SearchPlanPanel plan={plan} />}
      <ResultsList
        response={response}
        loading={loading}
        error={error}
        searchContext={lastSearched}
        providerChoice={values.provider}
        searchSaved={currentSaved !== undefined}
        onSaveSearch={handleSaveSearch}
        favoritePlanIds={new Set(favoriteIdsByPlan.keys())}
        onToggleFavorite={handleToggleFavorite}
        excludedAirlines={excludedAirlines}
        onExcludeAirline={handleExcludeAirline}
      />
    </div>
  );
}
