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

type DuffelConfig = {
  apiKey: string;
};

const BASE_URL = "https://api.duffel.com";
const MAX_OFFERS_PER_QUERY = 15;
// Duffel waits up to 20s per airline by default; cap it so a full search
// (dozens of queries) stays responsive.
const SUPPLIER_TIMEOUT_MS = 10000;

const CABIN_CLASS_MAP: Record<FlightQuery["cabinClass"], string> = {
  ECONOMY: "economy",
  PREMIUM_ECONOMY: "premium_economy",
  BUSINESS: "business",
  FIRST: "first",
};

// Minimal shapes for the parts of the Duffel offer response the app consumes.
export type DuffelSegment = {
  origin: { iata_code: string };
  destination: { iata_code: string };
  departing_at: string;
  arriving_at: string;
  marketing_carrier?: { iata_code?: string | null; name?: string | null } | null;
  marketing_carrier_flight_number?: string | null;
  operating_carrier?: { name?: string | null } | null;
  passengers?: { baggages?: { type: string; quantity: number }[] | null }[] | null;
};

export type DuffelSlice = {
  duration?: string | null;
  segments: DuffelSegment[];
};

export type DuffelOffer = {
  id: string;
  total_amount: string;
  total_currency: string;
  slices: DuffelSlice[];
};

// "P1DT2H30M" → minutes; null when absent or unparsable.
export function parseDuffelDuration(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:[\d.]+S)?)?$/.exec(value);
  if (!match) return null;
  return Number(match[1] ?? 0) * 1440 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
}

// Checked bags across a slice: 0 only when explicitly reported as none on
// some segment; null when Duffel gives no baggage data at all.
function sliceCheckedBags(slice: DuffelSlice): number | null {
  let min: number | null = null;
  for (const segment of slice.segments) {
    const baggages = segment.passengers?.[0]?.baggages;
    if (!baggages) continue;
    const checked = baggages
      .filter((bag) => bag.type === "checked")
      .reduce((total, bag) => total + bag.quantity, 0);
    min = min === null ? checked : Math.min(min, checked);
  }
  return min;
}

function sliceToOption(slice: DuffelSlice, offer: DuffelOffer, id: string, price: number): FlightOption | null {
  if (slice.segments.length === 0) return null;

  const segments: FlightSegment[] = slice.segments.map((segment) => ({
    from: segment.origin.iata_code,
    to: segment.destination.iata_code,
    departureAt: segment.departing_at,
    arrivalAt: segment.arriving_at,
    carrierCode: segment.marketing_carrier?.iata_code ?? "",
    // Duffel requires displaying the operating carrier's full name.
    carrierName: segment.operating_carrier?.name ?? segment.marketing_carrier?.name ?? undefined,
    flightNumber: `${segment.marketing_carrier?.iata_code ?? ""}${segment.marketing_carrier_flight_number ?? ""}`,
  }));

  const first = segments[0];
  const last = segments[segments.length - 1];
  const requiresSelfTransfer = segments.some(
    (segment, i) => i > 0 && segments[i - 1].to !== segment.from
  );
  const durationMinutes =
    parseDuffelDuration(slice.duration) ??
    Math.round((new Date(last.arrivalAt).getTime() - new Date(first.departureAt).getTime()) / 60000);

  return {
    id,
    from: first.from,
    to: last.to,
    date: first.departureAt.slice(0, 10),
    departureAt: first.departureAt,
    arrivalAt: last.arrivalAt,
    segments,
    stops: segments.length - 1,
    durationMinutes,
    price,
    currency: offer.total_currency,
    requiresSelfTransfer,
    checkedBags: sliceCheckedBags(slice),
  };
}

export function normalizeDuffelOneWays(offers: DuffelOffer[]): FlightOption[] {
  const options: FlightOption[] = [];
  for (const offer of offers) {
    const slice = offer.slices[0];
    if (!slice) continue;
    const option = sliceToOption(slice, offer, `duffel-${offer.id}`, Number(offer.total_amount));
    if (option) options.push(option);
  }
  return options;
}

export function normalizeDuffelRoundTrips(offers: DuffelOffer[]): RoundTripOption[] {
  const options: RoundTripOption[] = [];
  for (const offer of offers) {
    if (offer.slices.length < 2) continue;
    const id = `duffel-${offer.id}`;
    const price = Number(offer.total_amount);
    const outbound = sliceToOption(offer.slices[0], offer, id, price);
    const inbound = sliceToOption(offer.slices[1], offer, id, 0);
    if (!outbound || !inbound) continue;
    options.push({ id, price, currency: offer.total_currency, outbound, inbound });
  }
  return options;
}

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { errors?: { title?: string; message?: string }[] };
    const first = body.errors?.[0];
    if (first?.message) return first.title ? `${first.title}: ${first.message}` : first.message;
  } catch {
    // fall through to the generic message
  }
  return `duffel returned status ${response.status}`;
}

// Duffel has no upstream airline-exclusion or bag filter on offer requests;
// apply the same semantics as the other providers locally.
function applyQueryFilters(options: FlightOption[], query: FlightQuery): FlightOption[] {
  const excluded = new Set(query.excludedAirlines ?? []);
  return options
    .filter(
      (option) =>
        (!query.checkedBagIncluded || option.checkedBags !== 0) &&
        !option.segments.some((segment) => excluded.has(segment.carrierCode))
    )
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_OFFERS_PER_QUERY);
}

function applyTwoSliceFilters(options: RoundTripOption[], query: FlightQuery): RoundTripOption[] {
  const excluded = new Set(query.excludedAirlines ?? []);
  return options
    .filter(
      (option) =>
        (!query.checkedBagIncluded || option.outbound.checkedBags !== 0) &&
        ![...option.outbound.segments, ...option.inbound.segments].some((s) =>
          excluded.has(s.carrierCode)
        )
    )
    .sort((a, b) => a.price - b.price)
    .slice(0, MAX_OFFERS_PER_QUERY);
}

const RATE_LIMIT_RETRIES = 3;
const RATE_LIMIT_BASE_DELAY_MS = 2000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDuffelProvider(config: DuffelConfig): FlightProvider {
  function post(slices: { origin: string; destination: string; departure_date: string }[], query: FlightQuery): Promise<Response> {
    return fetch(
      `${BASE_URL}/air/offer_requests?return_offers=true&supplier_timeout=${SUPPLIER_TIMEOUT_MS}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          "Duffel-Version": "v2",
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          data: {
            slices,
            passengers: Array.from({ length: query.adults }, () => ({ type: "adult" })),
            cabin_class: CABIN_CLASS_MAP[query.cabinClass],
            ...(query.nonStopOnly ? { max_connections: 0 } : {}),
          },
        }),
      }
    );
  }

  async function createOfferRequest(
    slices: { origin: string; destination: string; departure_date: string }[],
    query: FlightQuery
  ): Promise<DuffelOffer[]> {
    let response = await post(slices, query);
    // A burst of concurrent searches trips Duffel's per-minute limit; back
    // off and retry rather than dropping the query.
    for (let attempt = 1; attempt <= RATE_LIMIT_RETRIES && response.status === 429; attempt++) {
      await sleep(RATE_LIMIT_BASE_DELAY_MS * attempt);
      response = await post(slices, query);
    }

    if (response.status === 401 || response.status === 403) {
      throw new ProviderError("auth", await extractErrorMessage(response));
    }
    if (response.status === 429) {
      throw new ProviderError("rate_limit", await extractErrorMessage(response));
    }
    if (response.status === 400 || response.status === 422) {
      throw new ProviderError("bad_request", await extractErrorMessage(response));
    }
    if (!response.ok) {
      throw new ProviderError("unavailable", await extractErrorMessage(response));
    }
    const body = (await response.json()) as { data?: { offers?: DuffelOffer[] } };
    return body.data?.offers ?? [];
  }

  return {
    name: "duffel",
    async searchOneWay(query: FlightQuery): Promise<FlightOption[]> {
      const offers = await createOfferRequest(
        [{ origin: query.origin, destination: query.destination, departure_date: query.date }],
        query
      );
      return applyQueryFilters(normalizeDuffelOneWays(offers), query);
    },
    async searchRoundTrip(query: RoundTripQuery): Promise<RoundTripOption[]> {
      const offers = await createOfferRequest(
        [
          { origin: query.origin, destination: query.destination, departure_date: query.date },
          { origin: query.destination, destination: query.origin, departure_date: query.returnDate },
        ],
        query
      );
      return applyTwoSliceFilters(normalizeDuffelRoundTrips(offers), query);
    },
    async searchMultiCity(query: MultiCityQuery): Promise<RoundTripOption[]> {
      const offers = await createOfferRequest(
        [
          { origin: query.origin, destination: query.destination, departure_date: query.date },
          {
            origin: query.returnOrigin,
            destination: query.returnDestination,
            departure_date: query.returnDate,
          },
        ],
        query
      );
      return applyTwoSliceFilters(normalizeDuffelRoundTrips(offers), query);
    },
    async getBookingLinks(): Promise<BookingLink[]> {
      // Duffel is a booking API (orders are created server-side), not a
      // deep-link aggregator; there are no external booking URLs to offer.
      return [];
    },
  };
}
