import type { FlightProvider } from "../providers/types";
import type {
  CabinClass,
  FlightOption,
  FlightQuery,
  MultiCityQuery,
  RoundTripOption,
  RoundTripQuery,
} from "./types";

// SEARCH_DRY_RUN lists every query a search would issue without contacting a
// provider, so the fan-out can be inspected before it is paid for.
export function isDryRun(): boolean {
  const flag = process.env.SEARCH_DRY_RUN?.trim().toLowerCase();
  return flag === "1" || flag === "true" || flag === "yes";
}

export type PlannedQueryKind = "oneWay" | "roundTrip" | "multiCity";

export type PlannedQuery = {
  stage: string;
  kind: PlannedQueryKind;
  origin: string;
  destination: string;
  date: string;
  returnOrigin?: string;
  returnDestination?: string;
  returnDate?: string;
  adults: number;
  cabinClass: CabinClass;
  nonStopOnly: boolean;
  checkedBagIncluded: boolean;
  excludedAirlines?: string[];
  // Upstream requests this single query costs (SerpApi's two-step flow needs
  // a follow-up request per candidate first leg).
  providerRequests: number;
};

export type PlanStageSummary = {
  stage: string;
  queries: number;
  providerRequests: number;
};

export type ProviderPlan = {
  provider: string;
  queries: number;
  providerRequests: number;
  stages: PlanStageSummary[];
  plannedQueries: PlannedQuery[];
};

export type SearchPlan = {
  dryRun: true;
  totals: { queries: number; providerRequests: number };
  providers: ProviderPlan[];
  notes: string[];
};

// The engine runs its strategies as distinct sequential phases; recording the
// active one labels each query without the engine knowing about dry runs.
let currentStage = "unknown";

export function setSearchStage(stage: string): void {
  currentStage = stage;
}

const DEFAULT_REQUESTS = { oneWay: 1, twoSlice: 1 };

export type RecordingProvider = {
  provider: FlightProvider;
  plan(): ProviderPlan;
};

// Stands in for a real provider: records what would have been asked and
// returns nothing. Empty results make the engine fall back to airport slots
// for its result-driven stages, which is the widest plan it could take.
export function createRecordingProvider(provider: FlightProvider): RecordingProvider {
  const recorded: PlannedQuery[] = [];
  const cost = provider.requestsPerQuery ?? DEFAULT_REQUESTS;

  function base(query: FlightQuery, kind: PlannedQueryKind, providerRequests: number): PlannedQuery {
    return {
      stage: currentStage,
      kind,
      origin: query.origin,
      destination: query.destination,
      date: query.date,
      adults: query.adults,
      cabinClass: query.cabinClass,
      nonStopOnly: query.nonStopOnly,
      checkedBagIncluded: query.checkedBagIncluded,
      excludedAirlines: query.excludedAirlines,
      providerRequests,
    };
  }

  const recorder: FlightProvider = {
    name: provider.name,
    batchesAirportLists: provider.batchesAirportLists,
    requestsPerQuery: provider.requestsPerQuery,
    async searchOneWay(query: FlightQuery): Promise<FlightOption[]> {
      recorded.push(base(query, "oneWay", cost.oneWay));
      return [];
    },
    async searchRoundTrip(query: RoundTripQuery): Promise<RoundTripOption[]> {
      recorded.push({ ...base(query, "roundTrip", cost.twoSlice), returnDate: query.returnDate });
      return [];
    },
    async getBookingLinks() {
      return [];
    },
  };
  if (provider.searchMultiCity) {
    recorder.searchMultiCity = async (query: MultiCityQuery): Promise<RoundTripOption[]> => {
      recorded.push({
        ...base(query, "multiCity", cost.twoSlice),
        returnOrigin: query.returnOrigin,
        returnDestination: query.returnDestination,
        returnDate: query.returnDate,
      });
      return [];
    };
  }

  return {
    provider: recorder,
    plan(): ProviderPlan {
      const stages = new Map<string, PlanStageSummary>();
      for (const query of recorded) {
        const summary = stages.get(query.stage) ?? { stage: query.stage, queries: 0, providerRequests: 0 };
        summary.queries++;
        summary.providerRequests += query.providerRequests;
        stages.set(query.stage, summary);
      }
      return {
        provider: provider.name,
        queries: recorded.length,
        providerRequests: recorded.reduce((total, q) => total + q.providerRequests, 0),
        stages: [...stages.values()],
        plannedQueries: recorded,
      };
    },
  };
}

// Booking-link lookups are keyed by ticket, not by route, so they get their
// own plan shape.
export type PlannedBookingLookup = {
  ticketId: string;
  provider: string | null;
};

export type BookingLinkPlan = {
  dryRun: true;
  lookups: PlannedBookingLookup[];
  notes: string[];
};

export function buildBookingLinkPlan(lookups: PlannedBookingLookup[]): BookingLinkPlan {
  const notes = ["no provider requests were made"];
  if (lookups.some((lookup) => lookup.provider === null)) {
    notes.push("tickets without a provider are unbookable regardless of the dry run");
  }
  return { dryRun: true, lookups, notes };
}

export function buildSearchPlan(plans: ProviderPlan[]): SearchPlan {
  const notes = [
    "no provider requests were made; caps live in src/lib/search/expand.ts and engine.ts",
    "counts assume an empty fare cache — repeats within 15 minutes cost less",
  ];
  if (plans.some((plan) => plan.plannedQueries.some((query) => query.kind !== "oneWay"))) {
    notes.push(
      "round-trip and multi-city destinations normally come from live outbound results; the dry run uses the full airport slot, so these are upper bounds"
    );
  }
  if (plans.length > 1) {
    notes.push(`provider fan-out: every query below is issued once per provider (${plans.length} providers)`);
  }
  for (const plan of plans) {
    const twoSlice = plan.plannedQueries.find((q) => q.kind !== "oneWay" && q.providerRequests > 1);
    if (twoSlice) {
      notes.push(
        `${plan.provider}: each round-trip/multi-city query costs up to ${twoSlice.providerRequests} billed searches (two-step token flow)`
      );
    }
  }
  return {
    dryRun: true,
    totals: {
      queries: plans.reduce((total, p) => total + p.queries, 0),
      providerRequests: plans.reduce((total, p) => total + p.providerRequests, 0),
    },
    providers: plans,
    notes,
  };
}
