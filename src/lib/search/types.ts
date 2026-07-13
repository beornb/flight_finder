export type CabinClass = "ECONOMY" | "PREMIUM_ECONOMY" | "BUSINESS" | "FIRST";

// Which flight-data source to search; "all" fans out to every configured
// live provider and merges the results.
export type ProviderChoice = "mock" | "ignav" | "duffel" | "serpapi" | "all";

// Destination and return endpoints each take either a whole country (search
// all major airports) or one exact airport — never both.
export type SearchParams = {
  originAirport: string;
  outboundDateFrom: string;
  outboundDateTo: string;
  destinationCountry?: string;
  destinationAirport?: string;
  directOnly: boolean;
  // One-way trip: the return fields are absent and no return search runs.
  outboundOnly: boolean;
  returnDateFrom?: string;
  returnDateTo?: string;
  returnFromCountry?: string;
  returnFromAirport?: string;
  returnToCountry?: string;
  returnToAirport?: string;
  adults: number;
  cabinClass: CabinClass;
  // Widen airport/date caps for maximum coverage at higher provider cost.
  thorough: boolean;
  // Only show fares that include a checked bag.
  checkedBagIncluded: boolean;
  allowSeparateTicketsSameAirportOnly: boolean;
  // Carrier codes to exclude from every query. Deliberately optional and not
  // part of saved-search identity: the user's current blocklist always
  // applies, even when re-running an old saved search.
  excludedAirlines?: string[];
};

export type FlightSegment = {
  from: string;
  to: string;
  departureAt: string;
  arrivalAt: string;
  carrierCode: string;
  carrierName?: string;
  flightNumber: string;
};

// One priced one-way itinerary sold as a single ticket.
export type FlightOption = {
  id: string;
  from: string;
  to: string;
  date: string;
  departureAt: string;
  arrivalAt: string;
  segments: FlightSegment[];
  stops: number;
  durationMinutes: number;
  price: number;
  currency: string;
  // True when the traveler moves between airports (or books separately
  // stitched tickets) themselves mid-journey. Informational: such options
  // are shown with a warning, not rejected.
  requiresSelfTransfer: boolean;
  // Checked bags included in the fare; null when the provider doesn't know.
  checkedBags: number | null;
};

export type FlightQuery = {
  origin: string;
  destination: string;
  date: string;
  adults: number;
  cabinClass: CabinClass;
  nonStopOnly: boolean;
  checkedBagIncluded: boolean;
  excludedAirlines?: string[];
};

export type RoundTripQuery = FlightQuery & { returnDate: string };

// One priced ticket with two arbitrary slices (a "multi-city" open jaw):
// origin→destination on `date`, then returnOrigin→returnDestination on
// `returnDate`.
export type MultiCityQuery = FlightQuery & {
  returnOrigin: string;
  returnDestination: string;
  returnDate: string;
};

// A two-slice fare (round trip or multi-city open jaw) split into its halves.
// Both halves share the same ticket id and the full fare sits on the outbound
// half (inbound is 0), so summing leg prices always yields the real total.
export type RoundTripOption = {
  id: string;
  price: number;
  currency: string;
  outbound: FlightOption;
  inbound: FlightOption;
};

export type ReturnLeg =
  | { kind: "single"; option: FlightOption }
  | {
      kind: "separateSameAirport";
      first: FlightOption;
      second: FlightOption;
      connectionAirport: string;
      connectionMinutes: number;
    };

export function flightQueryKey(query: FlightQuery): string {
  const parts = [
    query.origin,
    query.destination,
    query.date,
    query.adults,
    query.cabinClass,
    query.nonStopOnly ? "direct" : "any",
    query.checkedBagIncluded ? "bag" : "nobag",
  ];
  if (query.excludedAirlines?.length) {
    parts.push(`x${[...query.excludedAirlines].sort().join(",")}`);
  }
  return parts.join(":");
}
