export type TripType =
  | "DIRECT_ROUNDTRIP"
  | "DIRECT_OPEN_JAW"
  | "OUTBOUND_ONLY"
  | "SAME_AIRPORT_SEPARATE_TICKETS"
  // Round-trip fare origin⇄destination whose inbound half is reached via a
  // separate positioning flight connecting at the same airport.
  | "ROUND_TRIP_PLUS_POSITIONING"
  // Both legs priced together as one multi-city ticket (single booking).
  | "OPEN_JAW_SINGLE_TICKET"
  // No longer produced; kept so favorites saved by older versions still render.
  | "REJECTED_SELF_TRANSFER";

export type LegSummary = {
  from: string;
  to: string;
  date: string;
  departureAt: string;
  arrivalAt: string;
  durationMinutes: number;
  stops: number;
  airlines: string[];
  // Same carriers with their 2-character codes, for provider-level filters.
  carriers?: { code: string; name: string }[];
  airportSequence: string[];
  isDirect: boolean;
  usesSeparateTickets: boolean;
  connectionAirport?: string;
  connectionMinutes?: number;
  price: number;
  currency: string;
  // Checked bags included in the fare; null/undefined when unknown.
  checkedBags?: number | null;
  // Provider ticket ids backing this leg (two for separate-ticket returns);
  // used to fetch booking links on demand.
  ticketIds: string[];
};

export type TripPlan = {
  id: string;
  tripType: TripType;
  totalPrice: number;
  currency: string;
  isDirect: boolean;
  usesSeparateTickets: boolean;
  requiresSelfTransfer: boolean;
  score: number;
  whyRecommended: string;
  totalDurationMinutes: number;
  totalStops: number;
  outbound: LegSummary;
  // Null for outbound-only (one-way) trips.
  return: LegSummary | null;
};

export type SearchSummary = {
  originAirport: string;
  destinationCountry?: string;
  destinationAirport?: string;
  returnFromCountry?: string;
  returnFromAirport?: string;
  returnToCountry?: string;
  returnToAirport?: string;
  directOnly: boolean;
  outboundOnly: boolean;
};

export type SearchMeta = {
  provider: string;
  queriesRun: number;
  usedSeparateTicketFallback: boolean;
  partialFailures: string[];
};

export type SearchResponse = {
  searchSummary: SearchSummary;
  results: TripPlan[];
  meta: SearchMeta;
};
