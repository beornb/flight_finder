import { describe, expect, it } from "vitest";
import {
  normalizeIgnavBookingLinks,
  normalizeIgnavItineraries,
  normalizeIgnavRoundTrips,
  type IgnavBookingOption,
  type IgnavItinerary,
  type IgnavSegment,
} from "./normalize";

function segment(overrides: Partial<IgnavSegment>): IgnavSegment {
  return {
    marketing_carrier_code: "OS",
    flight_number: "123",
    operating_carrier_name: "Austrian Airlines",
    departure_airport: "VIE",
    departure_time_local: "2026-09-01T08:00:00",
    departure_time_utc: "2026-09-01T06:00:00Z",
    arrival_airport: "LIS",
    arrival_time_local: "2026-09-01T10:30:00",
    arrival_time_utc: "2026-09-01T09:30:00Z",
    duration_minutes: 210,
    ...overrides,
  };
}

function itinerary(overrides: Partial<IgnavItinerary>): IgnavItinerary {
  return {
    price: { amount: 129.5, currency: "EUR", status: "verified" },
    outbound: { carrier: "OS", duration_minutes: 210, segments: [segment({})] },
    requires_self_transfer: false,
    ignav_id: "abc123",
    ...overrides,
  };
}

describe("normalizeIgnavItineraries", () => {
  it("maps bag data when present, null when unknown", () => {
    const withBags = itinerary({ bags: { checked: 1, carry_on: 1 } });
    const options = normalizeIgnavItineraries([withBags, itinerary({})]);
    expect(options[0].checkedBags).toBe(1);
    expect(options[1].checkedBags).toBeNull();
  });

  it("maps a direct itinerary into a FlightOption", () => {
    const [option] = normalizeIgnavItineraries([itinerary({})]);
    expect(option).toMatchObject({
      id: "ignav-abc123",
      from: "VIE",
      to: "LIS",
      date: "2026-09-01",
      stops: 0,
      durationMinutes: 210,
      price: 129.5,
      currency: "EUR",
      requiresSelfTransfer: false,
    });
    expect(option.segments[0]).toMatchObject({
      carrierCode: "OS",
      carrierName: "Austrian Airlines",
      flightNumber: "OS123",
    });
  });

  it("flags self-transfer from Ignav's flag or from an airport mismatch between segments", () => {
    const flagged = itinerary({ requires_self_transfer: true });
    const mismatch = itinerary({
      requires_self_transfer: null,
      outbound: {
        carrier: "FR",
        duration_minutes: 400,
        segments: [
          segment({ arrival_airport: "BGY", arrival_time_local: "2026-09-01T10:00:00" }),
          segment({
            departure_airport: "MXP",
            departure_time_local: "2026-09-01T14:00:00",
            arrival_airport: "LIS",
            arrival_time_local: "2026-09-01T16:30:00",
          }),
        ],
      },
    });
    const options = normalizeIgnavItineraries([flagged, mismatch]);
    expect(options.map((o) => o.requiresSelfTransfer)).toEqual([true, true]);
    expect(options[1].stops).toBe(1);
  });

  it("falls back to UTC times when the leg duration is missing", () => {
    const noDuration = itinerary({
      outbound: { carrier: "OS", duration_minutes: null, segments: [segment({})] },
    });
    const [option] = normalizeIgnavItineraries([noDuration]);
    expect(option.durationMinutes).toBe(210);
  });

  it("splits round trips into halves sharing one ticket id, full price on the outbound", () => {
    const roundTrip = itinerary({
      ignav_id: "rt42",
      inbound: {
        carrier: "TP",
        duration_minutes: 200,
        segments: [
          segment({
            departure_airport: "LIS",
            departure_time_local: "2026-09-10T09:00:00",
            arrival_airport: "VIE",
            arrival_time_local: "2026-09-10T13:20:00",
          }),
        ],
      },
    });
    const oneWayOnly = itinerary({});
    const options = normalizeIgnavRoundTrips([roundTrip, oneWayOnly]);
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ id: "ignav-rt42", price: 129.5 });
    expect(options[0].outbound).toMatchObject({ id: "ignav-rt42", price: 129.5, from: "VIE", to: "LIS" });
    expect(options[0].inbound).toMatchObject({ id: "ignav-rt42", price: 0, from: "LIS", to: "VIE" });
  });

  it("maps and dedupes booking links across booking options", () => {
    const options: IgnavBookingOption[] = [
      {
        legs: ["outbound"],
        links: [
          {
            provider_name: "Ryanair",
            provider_type: "airline",
            fare_name: "Basic",
            price: { amount: 89, currency: "EUR" },
            url: "https://ryanair.example/book/1",
          },
          {
            provider_name: "Kiwi",
            provider_type: "third_party",
            fare_name: null,
            price: null,
            url: "https://kiwi.example/book/1",
          },
        ],
      },
      {
        legs: ["outbound"],
        links: [
          {
            provider_name: "Ryanair",
            provider_type: "airline",
            url: "https://ryanair.example/book/1",
          },
        ],
      },
    ];
    const links = normalizeIgnavBookingLinks(options);
    expect(links).toHaveLength(2);
    expect(links[0]).toMatchObject({
      providerName: "Ryanair",
      providerType: "airline",
      fareName: "Basic",
      price: { amount: 89, currency: "EUR" },
    });
    expect(links[1]).toMatchObject({ providerName: "Kiwi", fareName: undefined, price: undefined });
  });

  it("keeps carrier-prefixed flight numbers as-is and skips empty itineraries", () => {
    const prefixed = itinerary({
      outbound: {
        carrier: "LH",
        duration_minutes: 100,
        segments: [segment({ flight_number: "LH441" })],
      },
    });
    const empty = itinerary({ outbound: { carrier: null, duration_minutes: null, segments: [] } });
    const options = normalizeIgnavItineraries([prefixed, empty]);
    expect(options).toHaveLength(1);
    expect(options[0].segments[0].flightNumber).toBe("LH441");
  });
});
