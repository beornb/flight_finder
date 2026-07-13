import {
  normalizeIgnavBookingLinks,
  normalizeIgnavItineraries,
  normalizeIgnavRoundTrips,
  type IgnavBookingOption,
  type IgnavItinerary,
} from "../search/normalize";
import type { BookingLink } from "../../types/booking";
import type { FlightOption, FlightQuery, RoundTripOption, RoundTripQuery } from "../search/types";
import { ProviderError, type FlightProvider } from "./types";

type IgnavConfig = {
  apiKey: string;
  // 2-letter country code; controls the currency and locale of fares.
  market: string;
};

const BASE_URL = "https://ignav.com/api";
// 424 means an upstream feed failed; documented as non-billable and safe to retry.
const UPSTREAM_RETRY_DELAY_MS = 1000;

const CABIN_CLASS_MAP: Record<FlightQuery["cabinClass"], string> = {
  ECONOMY: "economy",
  PREMIUM_ECONOMY: "premium_economy",
  BUSINESS: "business",
  FIRST: "first",
};

const TICKET_ID_PREFIX = "ignav-";

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    if (body.error?.message) {
      return body.error.code ? `${body.error.code}: ${body.error.message}` : body.error.message;
    }
  } catch {
    // fall through to the generic message
  }
  return `ignav returned status ${response.status}`;
}

export function createIgnavProvider(config: IgnavConfig): FlightProvider {
  async function post(path: string, body: unknown): Promise<Response> {
    return fetch(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": config.apiKey,
      },
      body: JSON.stringify(body),
    });
  }

  async function request<T>(path: string, body: unknown): Promise<T> {
    let response = await post(path, body);
    if (response.status === 424) {
      await sleep(UPSTREAM_RETRY_DELAY_MS);
      response = await post(path, body);
    }
    if (response.status === 401) {
      throw new ProviderError("auth", await extractErrorMessage(response));
    }
    if (response.status === 429) {
      throw new ProviderError("rate_limit", await extractErrorMessage(response));
    }
    if (response.status === 400) {
      throw new ProviderError("bad_request", await extractErrorMessage(response));
    }
    if (!response.ok) {
      throw new ProviderError("unavailable", await extractErrorMessage(response));
    }
    return (await response.json()) as T;
  }

  function fareRequestBody(query: FlightQuery): Record<string, unknown> {
    return {
      origin: query.origin,
      destination: query.destination,
      departure_date: query.date,
      adults: query.adults,
      cabin_class: CABIN_CLASS_MAP[query.cabinClass],
      ...(query.nonStopOnly ? { max_stops: 0 } : {}),
      ...(query.checkedBagIncluded ? { min_checked_bags: 1 } : {}),
      ...(query.excludedAirlines?.length ? { airlines_exclude: query.excludedAirlines } : {}),
      market: config.market,
    };
  }

  // min_checked_bags only filters fares whose baggage data Ignav knows;
  // drop fares explicitly reported as bag-less, keep unknowns.
  function bagFilter<T extends { checkedBags?: number | null }>(query: FlightQuery, options: T[]): T[] {
    return query.checkedBagIncluded ? options.filter((o) => o.checkedBags !== 0) : options;
  }

  return {
    name: "ignav",
    async searchOneWay(query: FlightQuery): Promise<FlightOption[]> {
      const body = await request<{ itineraries?: IgnavItinerary[] }>(
        "/fares/one-way",
        fareRequestBody(query)
      );
      return bagFilter(query, normalizeIgnavItineraries(body.itineraries ?? []));
    },
    async searchRoundTrip(query: RoundTripQuery): Promise<RoundTripOption[]> {
      const body = await request<{ itineraries?: IgnavItinerary[] }>("/fares/round-trip", {
        ...fareRequestBody(query),
        return_date: query.returnDate,
      });
      const options = normalizeIgnavRoundTrips(body.itineraries ?? []);
      return query.checkedBagIncluded
        ? options.filter((option) => option.outbound.checkedBags !== 0)
        : options;
    },
    async getBookingLinks(ticketId: string): Promise<BookingLink[]> {
      if (!ticketId.startsWith(TICKET_ID_PREFIX)) {
        throw new ProviderError("bad_request", `ticket ${ticketId} was not produced by ignav`);
      }
      // ignav_id lookups reject passenger/market fields — the id already
      // encodes them from the original fare search.
      const body = await request<{ booking_options?: IgnavBookingOption[] }>(
        "/fares/booking-links",
        { ignav_id: ticketId.slice(TICKET_ID_PREFIX.length) }
      );
      return normalizeIgnavBookingLinks(body.booking_options ?? []);
    },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
