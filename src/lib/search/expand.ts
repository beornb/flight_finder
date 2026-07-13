import { airportsForCountry, HUB_AIRPORTS, resolveLocationAirports } from "../data/airports";
import type { FlightQuery, SearchParams } from "./types";

// Caps keep one user query from exploding into hundreds of provider calls;
// "thorough" mode trades cost for coverage.
export const MAX_DATES_PER_RANGE = 4;
export const THOROUGH_MAX_DATES = 14;
export const MAX_AIRPORTS_PER_COUNTRY = 4;
export const THOROUGH_MAX_AIRPORTS = 8;
export const MAX_FALLBACK_HUBS = 3;
export const MAX_FALLBACK_DATES = 2;

export function dateCap(params: SearchParams): number {
  return params.thorough ? THOROUGH_MAX_DATES : MAX_DATES_PER_RANGE;
}

export function airportCap(params: SearchParams): number {
  return params.thorough ? THOROUGH_MAX_AIRPORTS : MAX_AIRPORTS_PER_COUNTRY;
}

// An endpoint slot is either one exact airport, a metro code covering several
// airports (LON, TYO), or a country's major airports.
export function slotAirports(
  country: string | undefined,
  airport: string | undefined,
  limit = MAX_AIRPORTS_PER_COUNTRY
): string[] {
  if (airport) return resolveLocationAirports(airport).slice(0, limit);
  if (!country) return [];
  return airportsForCountry(country, limit).map((a) => a.iata);
}

function hasReturnParams(params: SearchParams): boolean {
  return Boolean(
    params.returnDateFrom &&
      params.returnDateTo &&
      (params.returnFromCountry || params.returnFromAirport) &&
      (params.returnToCountry || params.returnToAirport)
  );
}

// All days in the range (inclusive). If the range exceeds `max`, sample
// evenly across it so both endpoints stay included.
export function expandDates(from: string, to: string, max = MAX_DATES_PER_RANGE): string[] {
  const start = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) return [];

  const days: string[] = [];
  for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
    days.push(d.toISOString().slice(0, 10));
  }
  if (days.length <= max) return days;

  const sampled: string[] = [];
  for (let i = 0; i < max; i++) {
    const index = Math.round((i * (days.length - 1)) / (max - 1));
    sampled.push(days[index]);
  }
  return [...new Set(sampled)];
}

export function buildOutboundQueries(params: SearchParams): FlightQuery[] {
  const airports = slotAirports(params.destinationCountry, params.destinationAirport, airportCap(params));
  const dates = expandDates(params.outboundDateFrom, params.outboundDateTo, dateCap(params));
  const queries: FlightQuery[] = [];
  for (const airport of airports) {
    if (airport === params.originAirport) continue;
    for (const date of dates) {
      queries.push({
        origin: params.originAirport,
        destination: airport,
        date,
        adults: params.adults,
        cabinClass: params.cabinClass,
        nonStopOnly: params.directOnly,
        checkedBagIncluded: params.checkedBagIncluded,
        excludedAirlines: params.excludedAirlines,
      });
    }
  }
  return queries;
}

export function buildReturnQueries(params: SearchParams): FlightQuery[] {
  if (params.outboundOnly || !hasReturnParams(params)) return [];
  const fromAirports = slotAirports(params.returnFromCountry, params.returnFromAirport, airportCap(params));
  const toAirports = slotAirports(params.returnToCountry, params.returnToAirport, airportCap(params));
  const dates = expandDates(params.returnDateFrom ?? "", params.returnDateTo ?? "", dateCap(params));
  const queries: FlightQuery[] = [];
  for (const from of fromAirports) {
    for (const to of toAirports) {
      if (from === to) continue;
      for (const date of dates) {
        queries.push({
          origin: from,
          destination: to,
          date,
          adults: params.adults,
          cabinClass: params.cabinClass,
          nonStopOnly: params.directOnly,
          checkedBagIncluded: params.checkedBagIncluded,
          excludedAirlines: params.excludedAirlines,
        });
      }
    }
  }
  return queries;
}

export type FallbackQueries = {
  firstLegs: FlightQuery[];
  secondLegs: FlightQuery[];
};

// For providers whose origin/destination accept comma-separated airport
// lists (SerpApi), collapse queries that differ only in airports into one
// query per date — the same coverage for a fraction of the billed searches.
export function batchAirportQueries(queries: FlightQuery[]): FlightQuery[] {
  const groups = new Map<string, FlightQuery[]>();
  for (const query of queries) {
    const key = [
      query.date,
      query.adults,
      query.cabinClass,
      query.nonStopOnly,
      query.checkedBagIncluded,
      [...(query.excludedAirlines ?? [])].sort().join(","),
    ].join("|");
    const group = groups.get(key);
    if (group) group.push(query);
    else groups.set(key, [query]);
  }

  return [...groups.values()].map((group) => {
    const origins = [...new Set(group.map((q) => q.origin))].sort();
    const destinations = [...new Set(group.map((q) => q.destination))].sort();
    return { ...group[0], origin: origins.join(","), destination: destinations.join(",") };
  });
}

// Separate-ticket fallback: return-from → hub, then hub → return-to on the
// same date. Legs are always nonstop to keep connection risk low; pairing by
// same arrival/departure airport happens in rank.ts.
export function buildFallbackQueries(params: SearchParams): FallbackQueries {
  if (params.outboundOnly || !hasReturnParams(params)) return { firstLegs: [], secondLegs: [] };
  const endpointCap = params.thorough ? 4 : 2;
  const fromAirports = slotAirports(params.returnFromCountry, params.returnFromAirport, endpointCap);
  const toAirports = slotAirports(params.returnToCountry, params.returnToAirport, endpointCap);
  const dates = expandDates(
    params.returnDateFrom ?? "",
    params.returnDateTo ?? "",
    params.thorough ? 4 : MAX_FALLBACK_DATES
  );
  const excluded = new Set([...fromAirports, ...toAirports]);
  const hubs = HUB_AIRPORTS.filter((hub) => !excluded.has(hub)).slice(
    0,
    params.thorough ? 6 : MAX_FALLBACK_HUBS
  );

  const firstLegs: FlightQuery[] = [];
  const secondLegs: FlightQuery[] = [];
  for (const hub of hubs) {
    for (const date of dates) {
      for (const from of fromAirports) {
        firstLegs.push({
          origin: from,
          destination: hub,
          date,
          adults: params.adults,
          cabinClass: params.cabinClass,
          nonStopOnly: true,
          checkedBagIncluded: params.checkedBagIncluded,
          excludedAirlines: params.excludedAirlines,
        });
      }
      for (const to of toAirports) {
        secondLegs.push({
          origin: hub,
          destination: to,
          date,
          adults: params.adults,
          cabinClass: params.cabinClass,
          nonStopOnly: true,
          checkedBagIncluded: params.checkedBagIncluded,
          excludedAirlines: params.excludedAirlines,
        });
      }
    }
  }
  return { firstLegs, secondLegs };
}
