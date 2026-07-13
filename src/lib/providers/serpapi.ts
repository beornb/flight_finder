import type { BookingLink } from "../../types/booking";
import type {
  FlightOption,
  FlightQuery,
  FlightSegment,
  MultiCityQuery,
  RoundTripOption,
  RoundTripQuery,
} from "../search/types";
import { ProviderError, type FlightProvider } from "./types";

// Google Flights data via SerpApi (https://serpapi.com/google-flights-api).
// Round trips and multi-city itineraries use Google's two-step flow: the
// first search returns first-leg options with a departure_token, a second
// search with that token returns the remaining leg priced as a total.

type SerpApiConfig = {
  apiKey: string;
};

const BASE_URL = "https://serpapi.com/search";
const MAX_OFFERS_PER_QUERY = 15;
const CURRENCY = "EUR";
// Round-trip/multi-city pairing: fetch counterpart legs for this many of the
// cheapest first legs (each costs one extra search) so good fares hidden
// behind a non-cheapest first leg aren't lost.
const TWO_STEP_FIRST_LEGS = 3;

const TRAVEL_CLASS_MAP: Record<FlightQuery["cabinClass"], string> = {
  ECONOMY: "1",
  PREMIUM_ECONOMY: "2",
  BUSINESS: "3",
  FIRST: "4",
};

export type SerpApiSegment = {
  departure_airport: { id: string; name?: string; time: string };
  arrival_airport: { id: string; name?: string; time: string };
  duration?: number;
  airline?: string;
  flight_number?: string;
};

export type SerpApiItinerary = {
  flights: SerpApiSegment[];
  total_duration?: number;
  price?: number;
  departure_token?: string;
  booking_token?: string;
};

type SerpApiBody = {
  error?: string;
  best_flights?: SerpApiItinerary[];
  other_flights?: SerpApiItinerary[];
};

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16);
}

// "2026-09-02 08:00" → "2026-09-02T08:00:00"
function toIsoLocal(time: string): string {
  const iso = time.trim().replace(" ", "T");
  return iso.length === 16 ? `${iso}:00` : iso;
}

// Google reports "LH 123"; the leading token is the marketing carrier code.
function carrierCodeOf(flightNumber: string | undefined): string {
  const match = /^([A-Z0-9]{2})\s/.exec(flightNumber ?? "");
  return match ? match[1] : "";
}

function toSegments(itinerary: SerpApiItinerary): FlightSegment[] {
  return itinerary.flights.map((flight) => ({
    from: flight.departure_airport.id,
    to: flight.arrival_airport.id,
    departureAt: toIsoLocal(flight.departure_airport.time),
    arrivalAt: toIsoLocal(flight.arrival_airport.time),
    carrierCode: carrierCodeOf(flight.flight_number),
    carrierName: flight.airline,
    flightNumber: (flight.flight_number ?? "").replace(/\s+/g, ""),
  }));
}

function itineraryToOption(
  itinerary: SerpApiItinerary,
  id: string,
  price: number
): FlightOption | null {
  if (itinerary.flights.length === 0) return null;
  const segments = toSegments(itinerary);
  const first = segments[0];
  const last = segments[segments.length - 1];
  return {
    id,
    from: first.from,
    to: last.to,
    date: first.departureAt.slice(0, 10),
    departureAt: first.departureAt,
    arrivalAt: last.arrivalAt,
    segments,
    stops: segments.length - 1,
    durationMinutes:
      itinerary.total_duration ??
      itinerary.flights.reduce((total, flight) => total + (flight.duration ?? 0), 0),
    price,
    currency: CURRENCY,
    requiresSelfTransfer: segments.some((segment, i) => i > 0 && segments[i - 1].to !== segment.from),
    // Google Flights doesn't expose structured baggage data.
    checkedBags: null,
  };
}

function itineraryIdentity(itinerary: SerpApiItinerary): string {
  return itinerary.flights
    .map((f) => `${f.departure_airport.id}${f.departure_airport.time}${f.flight_number ?? ""}`)
    .join("|");
}

export function normalizeSerpApiItineraries(itineraries: SerpApiItinerary[]): FlightOption[] {
  const options: FlightOption[] = [];
  for (const itinerary of itineraries) {
    if (typeof itinerary.price !== "number") continue;
    const id = `serpapi-${fnv1aHex(`${itineraryIdentity(itinerary)}@${itinerary.price}`)}`;
    const option = itineraryToOption(itinerary, id, itinerary.price);
    if (option) options.push(option);
  }
  return options;
}

// Pair the chosen first leg with each priced second-leg option; Google quotes
// the second leg's price as the itinerary total.
export function buildSerpApiTwoSlice(
  firstLeg: SerpApiItinerary,
  secondLegs: SerpApiItinerary[]
): RoundTripOption[] {
  const options: RoundTripOption[] = [];
  for (const secondLeg of secondLegs) {
    if (typeof secondLeg.price !== "number") continue;
    const id = `serpapi-${fnv1aHex(
      `${itineraryIdentity(firstLeg)}+${itineraryIdentity(secondLeg)}@${secondLeg.price}`
    )}`;
    const outbound = itineraryToOption(firstLeg, id, secondLeg.price);
    const inbound = itineraryToOption(secondLeg, id, 0);
    if (!outbound || !inbound) continue;
    options.push({ id, price: secondLeg.price, currency: CURRENCY, outbound, inbound });
  }
  return options;
}

function pickItineraries(body: SerpApiBody): SerpApiItinerary[] {
  return [...(body.best_flights ?? []), ...(body.other_flights ?? [])];
}

function cheapestWithToken(itineraries: SerpApiItinerary[], count: number): SerpApiItinerary[] {
  return itineraries
    .filter((itinerary) => itinerary.departure_token && typeof itinerary.price === "number")
    .sort((a, b) => a.price! - b.price!)
    .slice(0, count);
}

function capCheapest<T extends { price: number }>(options: T[]): T[] {
  return [...options].sort((a, b) => a.price - b.price).slice(0, MAX_OFFERS_PER_QUERY);
}

export function createSerpApiProvider(config: SerpApiConfig): FlightProvider {
  async function search(params: Record<string, string>): Promise<SerpApiBody> {
    const query = new URLSearchParams({
      engine: "google_flights",
      api_key: config.apiKey,
      currency: CURRENCY,
      hl: "en",
      // Browser-accurate prices; slower but no extra cost.
      deep_search: "true",
      ...params,
    });
    const response = await fetch(`${BASE_URL}?${query}`);
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("auth", `serpapi returned status ${response.status}`);
    }
    if (response.status === 429) {
      throw new ProviderError("rate_limit", "serpapi rate limit exceeded");
    }
    const body = (await response.json()) as SerpApiBody;
    if (body.error) {
      // "No results" comes back as an error string, not an empty list.
      if (/hasn't returned any results/i.test(body.error)) return {};
      throw new ProviderError(response.ok ? "bad_request" : "unavailable", `serpapi: ${body.error}`);
    }
    if (!response.ok) {
      throw new ProviderError("unavailable", `serpapi returned status ${response.status}`);
    }
    return body;
  }

  function commonParams(query: FlightQuery): Record<string, string> {
    return {
      adults: String(query.adults),
      travel_class: TRAVEL_CLASS_MAP[query.cabinClass],
      ...(query.nonStopOnly ? { stops: "1" } : {}),
      ...(query.excludedAirlines?.length ? { exclude_airlines: query.excludedAirlines.join(",") } : {}),
    };
  }

  async function twoStepSearch(firstParams: Record<string, string>): Promise<RoundTripOption[]> {
    const first = await search(firstParams);
    const firstLegs = cheapestWithToken(pickItineraries(first), TWO_STEP_FIRST_LEGS);
    if (firstLegs.length === 0) return [];
    const paired = await Promise.all(
      firstLegs.map((firstLeg) =>
        search({ ...firstParams, departure_token: firstLeg.departure_token! })
          .then((second) => buildSerpApiTwoSlice(firstLeg, pickItineraries(second)))
          .catch(() => [] as RoundTripOption[])
      )
    );
    return capCheapest(paired.flat());
  }

  return {
    name: "serpapi",
    // departure_id/arrival_id accept comma-separated airport lists, letting
    // the engine cover all candidate airports in one billed search.
    batchesAirportLists: true,
    async searchOneWay(query: FlightQuery): Promise<FlightOption[]> {
      const body = await search({
        type: "2",
        departure_id: query.origin,
        arrival_id: query.destination,
        outbound_date: query.date,
        ...commonParams(query),
      });
      return capCheapest(normalizeSerpApiItineraries(pickItineraries(body)));
    },
    async searchRoundTrip(query: RoundTripQuery): Promise<RoundTripOption[]> {
      return twoStepSearch({
        type: "1",
        departure_id: query.origin,
        arrival_id: query.destination,
        outbound_date: query.date,
        return_date: query.returnDate,
        ...commonParams(query),
      });
    },
    async searchMultiCity(query: MultiCityQuery): Promise<RoundTripOption[]> {
      return twoStepSearch({
        type: "3",
        multi_city_json: JSON.stringify([
          { departure_id: query.origin, arrival_id: query.destination, date: query.date },
          {
            departure_id: query.returnOrigin,
            arrival_id: query.returnDestination,
            date: query.returnDate,
          },
        ]),
        ...commonParams(query),
      });
    },
    async getBookingLinks(): Promise<BookingLink[]> {
      // Booking options require Google's short-lived booking_token from the
      // original search session; ticket ids alone can't recover them.
      return [];
    },
  };
}
