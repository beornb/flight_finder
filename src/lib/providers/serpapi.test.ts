import { describe, expect, it, vi } from "vitest";
import { ProviderError } from "./types";
import {
  buildSerpApiTwoSlice,
  createSerpApiProvider,
  normalizeSerpApiItineraries,
  type SerpApiItinerary,
  type SerpApiSegment,
} from "./serpapi";


function segment(overrides: Partial<SerpApiSegment>): SerpApiSegment {
  return {
    departure_airport: { id: "VIE", time: "2026-09-02 08:00" },
    arrival_airport: { id: "LIS", time: "2026-09-02 10:55" },
    duration: 175,
    airline: "TAP Air Portugal",
    flight_number: "TP 1273",
    ...overrides,
  };
}

function itinerary(overrides: Partial<SerpApiItinerary>): SerpApiItinerary {
  return {
    flights: [segment({})],
    total_duration: 175,
    price: 142,
    ...overrides,
  };
}

describe("normalizeSerpApiItineraries", () => {
  it("maps segments, local times, and the carrier code from the flight number", () => {
    const [option] = normalizeSerpApiItineraries([itinerary({})]);
    expect(option).toMatchObject({
      from: "VIE",
      to: "LIS",
      date: "2026-09-02",
      departureAt: "2026-09-02T08:00:00",
      arrivalAt: "2026-09-02T10:55:00",
      stops: 0,
      durationMinutes: 175,
      price: 142,
      currency: "EUR",
      requiresSelfTransfer: false,
      checkedBags: null,
    });
    expect(option.id.startsWith("serpapi-")).toBe(true);
    expect(option.segments[0]).toMatchObject({
      carrierCode: "TP",
      carrierName: "TAP Air Portugal",
      flightNumber: "TP1273",
    });
  });

  it("skips unpriced itineraries and keeps ids deterministic", () => {
    const priced = itinerary({});
    const unpriced = itinerary({ price: undefined });
    const options = normalizeSerpApiItineraries([priced, unpriced]);
    expect(options).toHaveLength(1);
    expect(normalizeSerpApiItineraries([priced])[0].id).toBe(options[0].id);
  });
});

describe("buildSerpApiTwoSlice", () => {
  it("pairs the chosen first leg with each priced second leg at the quoted total", () => {
    const firstLeg = itinerary({ price: 500, departure_token: "tok" });
    const secondLeg = itinerary({
      price: 658,
      flights: [
        segment({
          departure_airport: { id: "VIE", time: "2027-01-19 18:00" },
          arrival_airport: { id: "CPT", time: "2027-01-20 06:30" },
          flight_number: "LX 8087",
          airline: "SWISS",
        }),
      ],
    });
    const options = buildSerpApiTwoSlice(firstLeg, [secondLeg, itinerary({ price: undefined })]);
    expect(options).toHaveLength(1);
    expect(options[0].price).toBe(658);
    expect(options[0].outbound.price).toBe(658);
    expect(options[0].inbound).toMatchObject({ price: 0, from: "VIE", to: "CPT" });
    expect(options[0].outbound.id).toBe(options[0].inbound.id);
  });
});

describe("createSerpApiProvider rate limit handling", () => {
  it("throws rate_limit ProviderError when body.error contains quota or search limit message", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "Your monthly plan has run out of searches." }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      })
    );

    const provider = createSerpApiProvider({ apiKey: "test-key" });
    await expect(
      provider.searchOneWay({
        origin: "VIE",
        destination: "LIS",
        date: "2026-09-02",
        adults: 1,
        cabinClass: "ECONOMY",
      })
    ).rejects.toThrow(ProviderError);

    fetchSpy.mockRestore();
  });
});

