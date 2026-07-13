import type { BookingLink } from "../../types/booking";
import type {
  FlightOption,
  FlightQuery,
  MultiCityQuery,
  RoundTripOption,
  RoundTripQuery,
} from "../search/types";

export type FlightProvider = {
  name: string;
  // True when origin/destination accept comma-separated airport lists, so the
  // engine can collapse many airport combinations into one query.
  batchesAirportLists?: boolean;
  searchOneWay(query: FlightQuery): Promise<FlightOption[]>;
  searchRoundTrip(query: RoundTripQuery): Promise<RoundTripOption[]>;
  // Single-ticket open-jaw pricing; only providers whose API supports
  // arbitrary slices implement this.
  searchMultiCity?(query: MultiCityQuery): Promise<RoundTripOption[]>;
  // ticketId is the FlightOption id this provider produced earlier.
  getBookingLinks(ticketId: string, options: { adults: number }): Promise<BookingLink[]>;
};

export class ProviderError extends Error {
  readonly kind: "auth" | "rate_limit" | "bad_request" | "unavailable";

  constructor(kind: ProviderError["kind"], message: string) {
    super(message);
    this.name = "ProviderError";
    this.kind = kind;
  }
}
