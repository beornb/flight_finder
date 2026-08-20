import type { SimilarOptionsResponse } from "../../types/similar-options";
import type { SearchResponse, TripPlan } from "../../types/trip-plan";
import { airportsForCountry, findAirport, resolveLocationAirports } from "../data/airports";
import { ProviderError, type FlightProvider } from "../providers/types";
import type { SimilarOptionsRequest } from "../validation/similar-schema";
import { getCachedOptions, setCachedOptions } from "./cache";
import { setSearchStage } from "./dry-run";
import {
  airportCap,
  batchAirportQueries,
  buildFallbackQueries,
  buildOutboundQueries,
  buildReturnQueries,
  dateCap,
  expandDates,
  slotAirports,
} from "./expand";
import {
  buildMultiCityPlans,
  buildRoundTripPositioningPlans,
  buildSeparateTicketReturns,
  buildTripPlans,
  rankTripPlans,
} from "./rank";
import { cheapestPerDate, optionsCurrency } from "./similar";
import {
  flightQueryKey,
  type FlightOption,
  type FlightQuery,
  type MultiCityQuery,
  type ReturnLeg,
  type RoundTripOption,
  type RoundTripQuery,
  type SearchParams,
} from "./types";

const CONCURRENCY = 4;
const MAX_REPORTED_FAILURES = 10;

// Caps for the nested-return (round-trip + positioning) search.
const RT_DESTINATION_AIRPORTS = 2;
// Matches the standard date cap so short windows are covered completely —
// a fare on a skipped middle date is invisible no matter how good it is.
const RT_RETURN_DATES = 4;
const RT_POSITIONING_AIRPORTS = 2;

// Caps for single-ticket open-jaw (multi-city) pricing.
const MC_ENDPOINT_AIRPORTS = 2;
const MC_DATES = 4;
const MAX_MULTI_CITY_QUERIES = 16;

export class SearchError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "SearchError";
    this.status = status;
  }
}

type RunResult<T> = {
  options: T[];
  queriesRun: number;
  failures: string[];
};

type QueryRunResult = RunResult<FlightOption>;

// Cache-aware concurrent runner shared by all query kinds.
async function runCached<Q, T>(
  queries: Q[],
  provider: FlightProvider,
  keyOf: (query: Q) => string,
  call: (query: Q) => Promise<T[]>
): Promise<RunResult<T>> {
  const unique = new Map(queries.map((query) => [keyOf(query), query]));
  const entries = [...unique.entries()];
  const options: T[] = [];
  const failures: string[] = [];
  let queriesRun = 0;
  let index = 0;

  async function worker(): Promise<void> {
    while (index < entries.length) {
      const [key, query] = entries[index++];
      const cacheKey = `${provider.name}:${key}`;
      const cached = await getCachedOptions<T[]>(cacheKey);
      if (cached) {
        options.push(...cached);
        continue;
      }
      try {
        queriesRun++;
        const result = await call(query);
        options.push(...result);
        await setCachedOptions(cacheKey, result);
      } catch (error) {
        if (error instanceof ProviderError && error.kind === "auth") throw error;
        failures.push(error instanceof Error ? error.message : "unknown provider error");
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));
  return { options, queriesRun, failures };
}

function runQueries(queries: FlightQuery[], provider: FlightProvider): Promise<QueryRunResult> {
  return runCached(queries, provider, flightQueryKey, (query) => provider.searchOneWay(query));
}

function applyDirectOnly(options: FlightOption[], directOnly: boolean): FlightOption[] {
  return directOnly ? options.filter((option) => option.stops === 0) : options;
}

// Trim a query list to a budget without dropping only the tail — even
// sampling keeps endpoint and date diversity.
function sampleEvenly<T>(items: T[], max: number): T[] {
  if (items.length <= max) return items;
  const sampled: T[] = [];
  for (let i = 0; i < max; i++) {
    sampled.push(items[Math.round((i * (items.length - 1)) / (max - 1))]);
  }
  return [...new Set(sampled)];
}

// Providers already receive the exclusion list; this backstops cached results
// and providers that ignore the parameter.
function applyAirlineExclusions(options: FlightOption[], excluded: string[] | undefined): FlightOption[] {
  if (!excluded?.length) return options;
  const set = new Set(excluded);
  return options.filter((option) => !option.segments.some((s) => set.has(s.carrierCode)));
}

// Elapsed time per direction, which for separate-ticket returns spans the
// layover between the two tickets. Applied to finished plans so every
// strategy is covered by the one check.
export function withinLegDurationCap(plan: TripPlan, maxLegHours: number | undefined): boolean {
  if (maxLegHours === undefined) return true;
  const maxMinutes = maxLegHours * 60;
  return (
    plan.outbound.durationMinutes <= maxMinutes &&
    (plan.return === null || plan.return.durationMinutes <= maxMinutes)
  );
}

type RoundTripRunResult = RunResult<RoundTripOption>;

function runRoundTripQueries(
  queries: RoundTripQuery[],
  provider: FlightProvider
): Promise<RoundTripRunResult> {
  return runCached(
    queries,
    provider,
    (q) => `${flightQueryKey(q)}:rt:${q.returnDate}`,
    (q) => provider.searchRoundTrip(q)
  );
}

function runMultiCityQueries(
  queries: MultiCityQuery[],
  provider: FlightProvider
): Promise<RoundTripRunResult> {
  return runCached(
    queries,
    provider,
    (q) => `${flightQueryKey(q)}:mc:${q.returnOrigin}:${q.returnDestination}:${q.returnDate}`,
    (q) => provider.searchMultiCity!(q)
  );
}

// Destination airports worth pricing two-slice fares against: the ones that
// already showed outbound service, cheapest first; slot airports otherwise.
function topDestinationAirports(
  outbounds: FlightOption[],
  params: SearchParams,
  limit: number
): string[] {
  const cheapestByAirport = new Map<string, number>();
  for (const option of outbounds) {
    const existing = cheapestByAirport.get(option.to);
    if (existing === undefined || option.price < existing) cheapestByAirport.set(option.to, option.price);
  }
  const proven = [...cheapestByAirport.entries()].sort((a, b) => a[1] - b[1]).map(([iata]) => iata);
  return (
    proven.length > 0 ? proven : slotAirports(params.destinationCountry, params.destinationAirport)
  ).slice(0, limit);
}

// The nested-return strategy only makes sense when the trip actually ends
// where it started: the round-trip fare's inbound half must land at the
// origin airport, so the return-to slot has to contain it.
function returnToContainsOrigin(params: SearchParams): boolean {
  if (params.returnToAirport) {
    return resolveLocationAirports(params.returnToAirport).includes(params.originAirport);
  }
  const origin = findAirport(params.originAirport);
  return origin !== undefined && origin.country === params.returnToCountry;
}

// A plan's structural identity across providers: same route sequence and
// departure times mean the same flights, regardless of which provider
// returned them.
function planIdentity(plan: TripPlan): string {
  const leg = (l: TripPlan["outbound"] | null) =>
    l ? `${l.airportSequence.join(">")}@${l.departureAt}` : "oneway";
  return `${plan.tripType}|${leg(plan.outbound)}|${leg(plan.return)}`;
}

// Combine per-provider searches from an "all providers" fan-out: dedupe
// structurally identical plans (keeping the cheaper offer) and re-rank.
export function mergeSearchResponses(responses: SearchResponse[]): SearchResponse {
  if (responses.length === 1) return responses[0];

  const byIdentity = new Map<string, TripPlan>();
  for (const response of responses) {
    for (const plan of response.results) {
      const key = planIdentity(plan);
      const existing = byIdentity.get(key);
      if (!existing || plan.totalPrice < existing.totalPrice) byIdentity.set(key, plan);
    }
  }

  return {
    searchSummary: responses[0].searchSummary,
    results: rankTripPlans([...byIdentity.values()]),
    meta: {
      provider: responses.map((r) => r.meta.provider).join("+"),
      queriesRun: responses.reduce((total, r) => total + r.meta.queriesRun, 0),
      usedSeparateTicketFallback: responses.some((r) => r.meta.usedSeparateTicketFallback),
      partialFailures: [...new Set(responses.flatMap((r) => r.meta.partialFailures))].slice(
        0,
        MAX_REPORTED_FAILURES
      ),
    },
  };
}

export function mergeSimilarOptionsResponses(
  responses: SimilarOptionsResponse[]
): SimilarOptionsResponse {
  if (responses.length === 1) return responses[0];

  function mergeDates(lists: (SimilarOptionsResponse["outbound"] | null)[]): SimilarOptionsResponse["outbound"] | null {
    const present = lists.filter((list) => list !== null);
    if (present.length === 0) return null;
    const byDate = new Map<string, number | null>();
    for (const list of present) {
      for (const cell of list) {
        const existing = byDate.get(cell.date);
        if (cell.price !== null && (existing === null || existing === undefined || cell.price < existing)) {
          byDate.set(cell.date, cell.price);
        } else if (!byDate.has(cell.date)) {
          byDate.set(cell.date, cell.price);
        }
      }
    }
    return [...byDate.entries()]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, price]) => ({ date, price }));
  }

  return {
    currency: responses.map((r) => r.currency).find((c) => c !== null) ?? null,
    outbound: mergeDates(responses.map((r) => r.outbound)) ?? [],
    return: mergeDates(responses.map((r) => r.return)),
  };
}

// Price-per-date breakdown for one specific trip's routes. Reuses the same
// query shape as runSearch, so a matrix opened shortly after a search is
// served entirely from the response cache.
export async function runSimilarOptions(
  request: SimilarOptionsRequest,
  provider: FlightProvider
): Promise<SimilarOptionsResponse> {
  function routeQueries(route: { origin: string; destination: string }, dates: string[]): FlightQuery[] {
    return dates.map((date) => ({
      origin: route.origin,
      destination: route.destination,
      date,
      adults: request.adults,
      cabinClass: request.cabinClass,
      nonStopOnly: request.directOnly,
      checkedBagIncluded: request.checkedBagIncluded,
      excludedAirlines: request.excludedAirlines,
    }));
  }

  const outboundDates = expandDates(request.outboundDateFrom, request.outboundDateTo);
  setSearchStage("similar-outbound");
  const outboundRun = await runQueries(routeQueries(request.outboundRoute, outboundDates), provider);
  const outboundOptions = applyAirlineExclusions(outboundRun.options, request.excludedAirlines);

  let returnPrices = null;
  let returnOptions: FlightOption[] = [];
  if (request.returnRoute && request.returnDateFrom && request.returnDateTo) {
    const returnDates = expandDates(request.returnDateFrom, request.returnDateTo);
    setSearchStage("similar-return");
    const returnRun = await runQueries(routeQueries(request.returnRoute, returnDates), provider);
    returnOptions = applyAirlineExclusions(returnRun.options, request.excludedAirlines);
    returnPrices = cheapestPerDate(returnOptions, returnDates, request.directOnly, request.maxLegHours);
  }

  return {
    currency: optionsCurrency(outboundOptions) ?? optionsCurrency(returnOptions),
    outbound: cheapestPerDate(outboundOptions, outboundDates, request.directOnly, request.maxLegHours),
    return: returnPrices,
  };
}

export async function runSearch(params: SearchParams, provider: FlightProvider): Promise<SearchResponse> {
  // Airport slots pass through as-is (the provider knows more airports than
  // our dataset); country slots must resolve to at least one known airport.
  const slotChecks: [string, string | undefined, string | undefined][] = [
    ["destination", params.destinationCountry, params.destinationAirport],
  ];
  if (!params.outboundOnly) {
    slotChecks.push(
      ["return-from", params.returnFromCountry, params.returnFromAirport],
      ["return-to", params.returnToCountry, params.returnToAirport]
    );
  }
  for (const [label, country, airport] of slotChecks) {
    if (airport) continue;
    if (!country || airportsForCountry(country).length === 0) {
      throw new SearchError(`No known airports for ${label} country "${country ?? ""}".`);
    }
  }

  // Providers that accept airport lists get collapsed queries: same coverage,
  // far fewer billed searches.
  function maybeBatch(queries: FlightQuery[]): FlightQuery[] {
    return provider.batchesAirportLists ? batchAirportQueries(queries) : queries;
  }

  setSearchStage("outbound");
  const outboundRun = await runQueries(maybeBatch(buildOutboundQueries(params)), provider);
  setSearchStage("return");
  const returnRun = await runQueries(maybeBatch(buildReturnQueries(params)), provider);

  const outbounds = applyAirlineExclusions(
    applyDirectOnly(outboundRun.options, params.directOnly),
    params.excludedAirlines
  );
  const singleReturns = applyAirlineExclusions(
    applyDirectOnly(returnRun.options, params.directOnly),
    params.excludedAirlines
  );

  let returnLegs: ReturnLeg[] = singleReturns.map((option) => ({ kind: "single", option }));
  let fallbackRun: QueryRunResult | null = null;

  // Same-airport separate-ticket hub combos always run when allowed: they can
  // undercut single tickets even when those exist, and ranking keeps them in
  // their own lower group anyway.
  if (!params.outboundOnly && params.allowSeparateTicketsSameAirportOnly) {
    const { firstLegs, secondLegs } = buildFallbackQueries(params);
    setSearchStage("separate-ticket-first-leg");
    const firstRun = await runQueries(maybeBatch(firstLegs), provider);
    setSearchStage("separate-ticket-second-leg");
    const secondRun = await runQueries(maybeBatch(secondLegs), provider);
    fallbackRun = {
      options: [],
      queriesRun: firstRun.queriesRun + secondRun.queriesRun,
      failures: [...firstRun.failures, ...secondRun.failures],
    };
    returnLegs = [
      ...returnLegs,
      ...buildSeparateTicketReturns(
        applyAirlineExclusions(firstRun.options, params.excludedAirlines),
        applyAirlineExclusions(secondRun.options, params.excludedAirlines)
      ),
    ];
  }

  // Round-trip fares are often much cheaper than two one-ways. When the trip
  // ends back at the origin they serve two strategies: as complete plans when
  // the return-from slot contains the round trip's destination, and as
  // nested returns whose inbound half is reached via a positioning flight.
  let roundTripPlans: TripPlan[] = [];
  let rtRun: RoundTripRunResult | null = null;
  let positioningRun: QueryRunResult | null = null;
  if (
    !params.outboundOnly &&
    returnToContainsOrigin(params) &&
    params.returnDateFrom &&
    params.returnDateTo
  ) {
    const rtDestinations = topDestinationAirports(
      outbounds,
      params,
      params.thorough ? 4 : RT_DESTINATION_AIRPORTS
    );

    const outboundDates = expandDates(params.outboundDateFrom, params.outboundDateTo, dateCap(params));
    const rtReturnDates = expandDates(params.returnDateFrom, params.returnDateTo, RT_RETURN_DATES);

    const rtQueries: RoundTripQuery[] = [];
    for (const destination of rtDestinations) {
      for (const date of outboundDates) {
        for (const returnDate of rtReturnDates) {
          if (returnDate <= date) continue;
          rtQueries.push({
            origin: params.originAirport,
            destination,
            date,
            returnDate,
            adults: params.adults,
            cabinClass: params.cabinClass,
            nonStopOnly: params.directOnly,
            checkedBagIncluded: params.checkedBagIncluded,
            excludedAirlines: params.excludedAirlines,
          });
        }
      }
    }

    setSearchStage("round-trip");
    rtRun = await runRoundTripQueries(rtQueries, provider);
    const excludedSet = new Set(params.excludedAirlines ?? []);
    const cleanRoundTrips = rtRun.options.filter(
      (rt) =>
        !rt.outbound.segments.some((s) => excludedSet.has(s.carrierCode)) &&
        !rt.inbound.segments.some((s) => excludedSet.has(s.carrierCode))
    );

    // A round-trip fare whose destination is also a valid return-from airport
    // covers the whole trip by itself — a single-ticket round trip.
    const returnFromSet = new Set(
      slotAirports(params.returnFromCountry, params.returnFromAirport, airportCap(params))
    );
    roundTripPlans = buildMultiCityPlans(
      cleanRoundTrips.filter((rt) => returnFromSet.has(rt.inbound.from))
    );

    if (params.allowSeparateTicketsSameAirportOnly) {
      const positioningQueries: FlightQuery[] = [];
      for (const from of slotAirports(
        params.returnFromCountry,
        params.returnFromAirport,
        params.thorough ? 4 : RT_POSITIONING_AIRPORTS
      )) {
        for (const destination of rtDestinations) {
          if (from === destination) continue;
          for (const date of rtReturnDates) {
            positioningQueries.push({
              origin: from,
              destination,
              date,
              adults: params.adults,
              cabinClass: params.cabinClass,
              // Positioning legs stay nonstop and single-booking to keep the
              // connection onto the round-trip's inbound half low-risk.
              nonStopOnly: true,
              checkedBagIncluded: params.checkedBagIncluded,
              excludedAirlines: params.excludedAirlines,
            });
          }
        }
      }
      setSearchStage("round-trip-positioning");
      positioningRun = await runQueries(maybeBatch(positioningQueries), provider);
      roundTripPlans = [
        ...roundTripPlans,
        ...buildRoundTripPositioningPlans(
          cleanRoundTrips,
          applyAirlineExclusions(positioningRun.options, params.excludedAirlines)
        ),
      ];
    }
  }

  // Single-ticket open jaws: providers with multi-city support price both
  // legs together as one booking, which often beats two one-way fares.
  let multiCityPlans: TripPlan[] = [];
  let mcRun: RoundTripRunResult | null = null;
  if (
    !params.outboundOnly &&
    provider.searchMultiCity !== undefined &&
    params.returnDateFrom &&
    params.returnDateTo
  ) {
    const endpointCap = params.thorough ? 4 : MC_ENDPOINT_AIRPORTS;
    const mcDateCap = MC_DATES;
    const destinations = topDestinationAirports(outbounds, params, endpointCap);
    const returnFromAirports = slotAirports(params.returnFromCountry, params.returnFromAirport, endpointCap);
    const returnToAirports = slotAirports(params.returnToCountry, params.returnToAirport, endpointCap);
    const outboundDates = expandDates(params.outboundDateFrom, params.outboundDateTo, mcDateCap);
    const returnDates = expandDates(params.returnDateFrom, params.returnDateTo, mcDateCap);

    const mcQueries: MultiCityQuery[] = [];
    for (const destination of destinations) {
      for (const returnOrigin of returnFromAirports) {
        for (const returnDestination of returnToAirports) {
          for (const date of outboundDates) {
            for (const returnDate of returnDates) {
              if (returnDate <= date) continue;
              // Mirrored slices are already priced by the round-trip strategy.
              const isMirror = returnOrigin === destination && returnDestination === params.originAirport;
              if (isMirror && rtRun !== null) continue;
              mcQueries.push({
                origin: params.originAirport,
                destination,
                date,
                returnOrigin,
                returnDestination,
                returnDate,
                adults: params.adults,
                cabinClass: params.cabinClass,
                nonStopOnly: params.directOnly,
                checkedBagIncluded: params.checkedBagIncluded,
                excludedAirlines: params.excludedAirlines,
              });
            }
          }
        }
      }
    }

    setSearchStage("multi-city");
    mcRun = await runMultiCityQueries(
      sampleEvenly(mcQueries, params.thorough ? 64 : MAX_MULTI_CITY_QUERIES),
      provider
    );
    const excludedSet = new Set(params.excludedAirlines ?? []);
    multiCityPlans = buildMultiCityPlans(
      mcRun.options.filter(
        (option) =>
          !option.outbound.segments.some((s) => excludedSet.has(s.carrierCode)) &&
          !option.inbound.segments.some((s) => excludedSet.has(s.carrierCode))
      )
    );
  }

  const plans = buildTripPlans(outbounds, returnLegs, params);
  const results = rankTripPlans(
    [...plans, ...roundTripPlans, ...multiCityPlans].filter((plan) =>
      withinLegDurationCap(plan, params.maxLegHours)
    )
  );

  const failures = [
    ...outboundRun.failures,
    ...returnRun.failures,
    ...(fallbackRun?.failures ?? []),
    ...(rtRun?.failures ?? []),
    ...(positioningRun?.failures ?? []),
    ...(mcRun?.failures ?? []),
  ];

  return {
    searchSummary: {
      originAirport: params.originAirport,
      destinationCountry: params.destinationCountry,
      destinationAirport: params.destinationAirport,
      returnFromCountry: params.returnFromCountry,
      returnFromAirport: params.returnFromAirport,
      returnToCountry: params.returnToCountry,
      returnToAirport: params.returnToAirport,
      directOnly: params.directOnly,
      outboundOnly: params.outboundOnly,
    },
    results,
    meta: {
      provider: provider.name,
      queriesRun:
        outboundRun.queriesRun +
        returnRun.queriesRun +
        (fallbackRun?.queriesRun ?? 0) +
        (rtRun?.queriesRun ?? 0) +
        (positioningRun?.queriesRun ?? 0) +
        (mcRun?.queriesRun ?? 0),
      usedSeparateTicketFallback: fallbackRun !== null,
      partialFailures: [...new Set(failures)].slice(0, MAX_REPORTED_FAILURES),
    },
  };
}
