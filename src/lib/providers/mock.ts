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

// Deterministic mock: the same query always yields the same offers, so the UI,
// ranking, and caching behave exactly as they would against a live provider.

const CARRIERS = [
  { code: "OS", name: "Austrian Airlines" },
  { code: "LH", name: "Lufthansa" },
  { code: "FR", name: "Ryanair" },
  { code: "U2", name: "easyJet" },
  { code: "TP", name: "TAP Air Portugal" },
  { code: "AZ", name: "ITA Airways" },
  { code: "IB", name: "Iberia" },
  { code: "KL", name: "KLM" },
  { code: "AF", name: "Air France" },
  { code: "LX", name: "Swiss" },
  { code: "W6", name: "Wizz Air" },
];

const CONNECTION_HUBS = ["FRA", "MUC", "ZRH", "AMS", "CDG", "MAD"];

// Same-city airport pairs used to simulate offers that would force a
// self-managed transfer between airports; these must get rejected downstream.
const SELF_TRANSFER_PAIRS: Record<string, string> = {
  MXP: "BGY",
  CDG: "ORY",
  LHR: "LGW",
  IST: "SAW",
};

function fnv1a(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash;
}

function routeDurationMinutes(origin: string, destination: string): number {
  const pair = [origin, destination].sort().join("-");
  return 75 + (fnv1a(pair) % 150);
}

function at(date: string, minutesFromMidnight: number): string {
  const dayOffset = Math.floor(minutesFromMidnight / (24 * 60));
  const withinDay = minutesFromMidnight % (24 * 60);
  const hours = String(Math.floor(withinDay / 60)).padStart(2, "0");
  const minutes = String(withinDay % 60).padStart(2, "0");
  if (dayOffset === 0) return `${date}T${hours}:${minutes}:00`;
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + dayOffset);
  return `${next.toISOString().slice(0, 10)}T${hours}:${minutes}:00`;
}

function buildOption(
  query: FlightQuery,
  index: number,
  segments: FlightSegment[],
  price: number
): FlightOption {
  const first = segments[0];
  const last = segments[segments.length - 1];
  const requiresSelfTransfer = segments.some(
    (segment, i) => i > 0 && segments[i - 1].to !== segment.from
  );
  const id = `mock-${query.origin}-${query.destination}-${query.date}-${index}`;
  // Deterministic mix of unknown / none / one / two checked bags.
  const bagSeed = fnv1a(id) % 4;
  return {
    id,
    from: first.from,
    to: last.to,
    date: query.date,
    departureAt: first.departureAt,
    arrivalAt: last.arrivalAt,
    segments,
    stops: segments.length - 1,
    durationMinutes: Math.round(
      (new Date(last.arrivalAt).getTime() - new Date(first.departureAt).getTime()) / 60000
    ),
    price: Math.round(price * query.adults * 100) / 100,
    currency: "EUR",
    requiresSelfTransfer,
    checkedBags: bagSeed === 0 ? null : bagSeed - 1,
  };
}

function segment(
  from: string,
  to: string,
  date: string,
  departureMinutes: number,
  durationMinutes: number,
  carrierIndex: number,
  flightSeed: number
): FlightSegment {
  const carrier = CARRIERS[carrierIndex % CARRIERS.length];
  return {
    from,
    to,
    departureAt: at(date, departureMinutes),
    arrivalAt: at(date, departureMinutes + durationMinutes),
    carrierCode: carrier.code,
    carrierName: carrier.name,
    flightNumber: `${carrier.code}${100 + (flightSeed % 800)}`,
  };
}

function generateOptions(query: FlightQuery): FlightOption[] {
  const seed = fnv1a(`${query.origin}:${query.destination}:${query.date}`);
  const basePrice = 39 + (seed % 170) + (fnv1a(query.date) % 40);
  const duration = routeDurationMinutes(query.origin, query.destination);
  const options: FlightOption[] = [];
  let index = 0;

  // Most routes get 1-2 direct offers at different times of day.
  const hasDirect = seed % 4 !== 0;
  if (hasDirect) {
    const morning = 6 * 60 + (seed % 240);
    options.push(
      buildOption(query, index++, [
        segment(query.origin, query.destination, query.date, morning, duration, seed, seed),
      ], basePrice)
    );
    if (seed % 3 !== 0) {
      const evening = 16 * 60 + (seed % 180);
      options.push(
        buildOption(query, index++, [
          segment(query.origin, query.destination, query.date, evening, duration, seed + 1, seed + 7),
        ], basePrice * 1.25)
      );
    }
  }

  // A one-stop single-ticket offer through a hub, usually cheaper than direct.
  const hub = CONNECTION_HUBS[seed % CONNECTION_HUBS.length];
  if (hub !== query.origin && hub !== query.destination) {
    const firstDeparture = 8 * 60 + (seed % 180);
    const firstDuration = routeDurationMinutes(query.origin, hub);
    const layover = 70 + (seed % 90);
    const secondStart = firstDeparture + firstDuration + layover;
    options.push(
      buildOption(query, index++, [
        segment(query.origin, hub, query.date, firstDeparture, firstDuration, seed + 2, seed + 13),
        segment(hub, query.destination, query.date, secondStart, routeDurationMinutes(hub, query.destination), seed + 3, seed + 19),
      ], basePrice * 0.82)
    );

    // Occasionally a tempting cheap offer that switches airports mid-journey.
    const transferTo = SELF_TRANSFER_PAIRS[hub];
    if (transferTo && seed % 5 === 0) {
      options.push(
        buildOption(query, index++, [
          segment(query.origin, hub, query.date, firstDeparture + 60, firstDuration, seed + 4, seed + 23),
          segment(transferTo, query.destination, query.date, secondStart + 180, routeDurationMinutes(transferTo, query.destination), seed + 5, seed + 29),
        ], basePrice * 0.55)
      );
    }
  }

  const excluded = new Set(query.excludedAirlines ?? []);
  return options.filter(
    (option) =>
      (!query.nonStopOnly || option.stops === 0) &&
      // Same semantics as the live provider: drop fares explicitly known to
      // exclude a checked bag, keep unknowns.
      (!query.checkedBagIncluded || option.checkedBags !== 0) &&
      !option.segments.some((segment) => excluded.has(segment.carrierCode))
  );
}

function generateBookingLinks(ticketId: string, adults: number): BookingLink[] {
  // Mock ids look like mock-VIE-LIS-2026-09-03-0.
  const match = /^mock-([A-Z]{3})-([A-Z]{3})-(\d{4}-\d{2}-\d{2})-\d+$/.exec(ticketId);
  if (!match) {
    throw new ProviderError("bad_request", `ticket ${ticketId} was not produced by the mock provider`);
  }
  const [, origin, destination, date] = match;
  const seed = fnv1a(`${origin}:${destination}:${date}`);
  const carrier = CARRIERS[seed % CARRIERS.length];
  const price = (39 + (seed % 170)) * adults;
  return [
    {
      providerName: carrier.name,
      providerType: "airline",
      fareName: "Basic",
      price: { amount: price, currency: "EUR" },
      url: `https://booking.example.com/${carrier.code}/${origin}-${destination}/${date}?adults=${adults}`,
    },
    {
      providerName: "Google Flights",
      providerType: "third_party",
      url: `https://www.google.com/travel/flights?q=${encodeURIComponent(
        `flights from ${origin} to ${destination} on ${date}`
      )}`,
    },
  ];
}

// Two-slice fares are typically well below two one-ways; the mock mirrors
// that so the nested-return and single-ticket strategies surface.
const ROUND_TRIP_DISCOUNT = 0.65;
const MULTI_CITY_DISCOUNT = 0.75;

function generateTwoSlice(
  query: FlightQuery,
  secondSlice: { origin: string; destination: string; date: string },
  discount: number,
  idBase: number
): RoundTripOption[] {
  const outbounds = generateOptions(query).filter((o) => !o.requiresSelfTransfer);
  const inbounds = generateOptions({
    ...query,
    origin: secondSlice.origin,
    destination: secondSlice.destination,
    date: secondSlice.date,
  }).filter((o) => !o.requiresSelfTransfer);

  const options: RoundTripOption[] = [];
  for (let i = 0; i < Math.min(2, outbounds.length, inbounds.length); i++) {
    const id = `mock-${query.origin}-${query.destination}-${query.date}-${idBase + i}`;
    const price = Math.round((outbounds[i].price + inbounds[i].price) * discount * 100) / 100;
    options.push({
      id,
      price,
      currency: "EUR",
      outbound: { ...outbounds[i], id, price },
      inbound: { ...inbounds[i], id, price: 0 },
    });
  }
  return options;
}

function generateRoundTrips(query: RoundTripQuery): RoundTripOption[] {
  return generateTwoSlice(
    query,
    { origin: query.destination, destination: query.origin, date: query.returnDate },
    ROUND_TRIP_DISCOUNT,
    900
  );
}

export function createMockProvider(): FlightProvider {
  return {
    name: "mock",
    async searchOneWay(query: FlightQuery): Promise<FlightOption[]> {
      // Small delay so loading states are visible during development.
      await new Promise((resolve) => setTimeout(resolve, 60));
      return generateOptions(query);
    },
    async searchRoundTrip(query: RoundTripQuery): Promise<RoundTripOption[]> {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return generateRoundTrips(query);
    },
    async searchMultiCity(query: MultiCityQuery): Promise<RoundTripOption[]> {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return generateTwoSlice(
        query,
        { origin: query.returnOrigin, destination: query.returnDestination, date: query.returnDate },
        MULTI_CITY_DISCOUNT,
        950
      );
    },
    async getBookingLinks(ticketId: string, options: { adults: number }): Promise<BookingLink[]> {
      await new Promise((resolve) => setTimeout(resolve, 60));
      return generateBookingLinks(ticketId, options.adults);
    },
  };
}
