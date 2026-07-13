import type { BookingLink } from "../../types/booking";
import type { FlightOption, FlightSegment, RoundTripOption } from "./types";

// Minimal shapes for the parts of the Ignav fare-search response the app
// consumes (see https://ignav.com/api/openapi.json). Kept here so nothing
// outside the provider/normalize layer depends on Ignav specifics.
export type IgnavSegment = {
  marketing_carrier_code: string | null;
  flight_number: string | null;
  operating_carrier_name: string | null;
  departure_airport: string;
  departure_time_local: string;
  departure_time_utc: string | null;
  arrival_airport: string;
  arrival_time_local: string;
  arrival_time_utc: string | null;
  duration_minutes: number;
};

export type IgnavLeg = {
  carrier: string | null;
  duration_minutes: number | null;
  segments: IgnavSegment[];
};

export type IgnavItinerary = {
  price: { amount: number; currency: string; status: "verified" | "unverified" };
  outbound: IgnavLeg;
  inbound?: IgnavLeg | null;
  bags?: { checked?: number | null; carry_on?: number | null } | null;
  requires_self_transfer?: boolean | null;
  ignav_id: string;
};

export type IgnavBookingOption = {
  legs: ("outbound" | "inbound")[];
  links: {
    provider_name: string;
    provider_type: "airline" | "third_party";
    fare_name?: string | null;
    price?: { amount: number; currency: string } | null;
    url: string;
  }[];
};

function flightNumber(segment: IgnavSegment): string {
  const number = segment.flight_number ?? "";
  // Some feeds return bare numbers, others carrier-prefixed ones.
  if (/^\d+$/.test(number)) return `${segment.marketing_carrier_code ?? ""}${number}`;
  return number;
}

function legDurationMinutes(leg: IgnavLeg): number {
  if (leg.duration_minutes != null) return leg.duration_minutes;
  const firstUtc = leg.segments[0].departure_time_utc;
  const lastUtc = leg.segments[leg.segments.length - 1].arrival_time_utc;
  if (firstUtc && lastUtc) {
    return Math.round((new Date(lastUtc).getTime() - new Date(firstUtc).getTime()) / 60000);
  }
  return leg.segments.reduce((total, segment) => total + segment.duration_minutes, 0);
}

function normalizeLeg(
  leg: IgnavLeg,
  itinerary: IgnavItinerary,
  id: string,
  price: number
): FlightOption | null {
  if (leg.segments.length === 0) return null;

  const segments: FlightSegment[] = leg.segments.map((segment) => ({
    from: segment.departure_airport,
    to: segment.arrival_airport,
    departureAt: segment.departure_time_local,
    arrivalAt: segment.arrival_time_local,
    carrierCode: segment.marketing_carrier_code ?? "",
    carrierName: segment.operating_carrier_name ?? undefined,
    flightNumber: flightNumber(segment),
  }));

  const first = segments[0];
  const last = segments[segments.length - 1];
  // Trust our own segment check in addition to Ignav's flag.
  const requiresSelfTransfer =
    itinerary.requires_self_transfer === true ||
    segments.some((segment, i) => i > 0 && segments[i - 1].to !== segment.from);

  return {
    id,
    from: first.from,
    to: last.to,
    date: first.departureAt.slice(0, 10),
    departureAt: first.departureAt,
    arrivalAt: last.arrivalAt,
    segments,
    stops: segments.length - 1,
    durationMinutes: legDurationMinutes(leg),
    price,
    currency: itinerary.price.currency,
    requiresSelfTransfer,
    checkedBags: itinerary.bags?.checked ?? null,
  };
}

export function normalizeIgnavItineraries(itineraries: IgnavItinerary[]): FlightOption[] {
  const options: FlightOption[] = [];
  for (const itinerary of itineraries) {
    const option = normalizeLeg(
      itinerary.outbound,
      itinerary,
      `ignav-${itinerary.ignav_id}`,
      itinerary.price.amount
    );
    if (option) options.push(option);
  }
  return options;
}

export function normalizeIgnavRoundTrips(itineraries: IgnavItinerary[]): RoundTripOption[] {
  const options: RoundTripOption[] = [];
  for (const itinerary of itineraries) {
    if (!itinerary.inbound) continue;
    const id = `ignav-${itinerary.ignav_id}`;
    const outbound = normalizeLeg(itinerary.outbound, itinerary, id, itinerary.price.amount);
    const inbound = normalizeLeg(itinerary.inbound, itinerary, id, 0);
    if (!outbound || !inbound) continue;
    options.push({
      id,
      price: itinerary.price.amount,
      currency: itinerary.price.currency,
      outbound,
      inbound,
    });
  }
  return options;
}

export function normalizeIgnavBookingLinks(options: IgnavBookingOption[]): BookingLink[] {
  const links: BookingLink[] = [];
  const seen = new Set<string>();
  for (const option of options) {
    for (const link of option.links) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      links.push({
        providerName: link.provider_name,
        providerType: link.provider_type,
        fareName: link.fare_name ?? undefined,
        price: link.price ?? undefined,
        url: link.url,
      });
    }
  }
  return links;
}
