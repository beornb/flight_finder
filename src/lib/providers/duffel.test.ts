import { describe, expect, it } from "vitest";
import {
  normalizeDuffelOneWays,
  normalizeDuffelRoundTrips,
  parseDuffelDuration,
  type DuffelOffer,
  type DuffelSegment,
} from "./duffel";

function segment(overrides: Partial<DuffelSegment>): DuffelSegment {
  return {
    origin: { iata_code: "VIE" },
    destination: { iata_code: "LIS" },
    departing_at: "2026-09-02T08:00:00",
    arriving_at: "2026-09-02T10:55:00",
    marketing_carrier: { iata_code: "TP", name: "TAP Air Portugal" },
    marketing_carrier_flight_number: "1273",
    operating_carrier: { name: "TAP Air Portugal" },
    passengers: [{ baggages: [{ type: "checked", quantity: 1 }] }],
    ...overrides,
  };
}

function offer(overrides: Partial<DuffelOffer>): DuffelOffer {
  return {
    id: "off_123",
    total_amount: "142.50",
    total_currency: "EUR",
    slices: [{ duration: "PT2H55M", segments: [segment({})] }],
    ...overrides,
  };
}

describe("parseDuffelDuration", () => {
  it("parses hours/minutes and day-spanning durations", () => {
    expect(parseDuffelDuration("PT2H55M")).toBe(175);
    expect(parseDuffelDuration("P1DT2H30M")).toBe(1590);
    expect(parseDuffelDuration("PT45M")).toBe(45);
    expect(parseDuffelDuration(null)).toBeNull();
    expect(parseDuffelDuration("garbage")).toBeNull();
  });
});

describe("normalizeDuffelOneWays", () => {
  it("maps an offer's first slice into a FlightOption", () => {
    const [option] = normalizeDuffelOneWays([offer({})]);
    expect(option).toMatchObject({
      id: "duffel-off_123",
      from: "VIE",
      to: "LIS",
      date: "2026-09-02",
      stops: 0,
      durationMinutes: 175,
      price: 142.5,
      currency: "EUR",
      requiresSelfTransfer: false,
      checkedBags: 1,
    });
    expect(option.segments[0]).toMatchObject({
      carrierCode: "TP",
      carrierName: "TAP Air Portugal",
      flightNumber: "TP1273",
    });
  });

  it("reports null bags without baggage data and 0 when explicitly none", () => {
    const unknown = offer({
      id: "off_u",
      slices: [{ duration: "PT2H", segments: [segment({ passengers: null })] }],
    });
    const none = offer({
      id: "off_0",
      slices: [{ duration: "PT2H", segments: [segment({ passengers: [{ baggages: [] }] })] }],
    });
    const options = normalizeDuffelOneWays([unknown, none]);
    expect(options[0].checkedBags).toBeNull();
    expect(options[1].checkedBags).toBe(0);
  });
});

describe("normalizeDuffelRoundTrips", () => {
  it("splits two-slice offers into halves sharing the ticket id and price", () => {
    const roundTrip = offer({
      id: "off_rt",
      total_amount: "300.00",
      slices: [
        { duration: "PT3H", segments: [segment({})] },
        {
          duration: "PT3H5M",
          segments: [
            segment({
              origin: { iata_code: "LIS" },
              destination: { iata_code: "VIE" },
              departing_at: "2026-09-14T12:00:00",
              arriving_at: "2026-09-14T16:05:00",
            }),
          ],
        },
      ],
    });
    const options = normalizeDuffelRoundTrips([roundTrip, offer({})]);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ id: "duffel-off_rt", price: 300 });
    expect(options[0].outbound).toMatchObject({ from: "VIE", to: "LIS", price: 300 });
    expect(options[0].inbound).toMatchObject({ from: "LIS", to: "VIE", price: 0 });
  });
});
