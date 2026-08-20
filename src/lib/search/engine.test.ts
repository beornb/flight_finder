import { describe, expect, it } from "vitest";
import { mergeSearchResponses, mergeSimilarOptionsResponses, withinLegDurationCap } from "./engine";
import type { SearchResponse, TripPlan } from "../../types/trip-plan";

function plan(id: string, totalPrice: number, departureAt: string): TripPlan {
  return {
    id,
    tripType: "DIRECT_OPEN_JAW",
    totalPrice,
    currency: "EUR",
    isDirect: true,
    usesSeparateTickets: false,
    requiresSelfTransfer: false,
    score: 1,
    whyRecommended: "",
    totalDurationMinutes: 300,
    totalStops: 0,
    outbound: {
      from: "VIE",
      to: "LIS",
      date: departureAt.slice(0, 10),
      departureAt,
      arrivalAt: "2026-09-01T11:00:00",
      durationMinutes: 180,
      stops: 0,
      airlines: ["Ryanair"],
      airportSequence: ["VIE", "LIS"],
      isDirect: true,
      usesSeparateTickets: false,
      price: totalPrice,
      currency: "EUR",
      ticketIds: [id],
    },
    return: null,
  };
}

function response(providerName: string, plans: TripPlan[]): SearchResponse {
  return {
    searchSummary: { originAirport: "VIE", directOnly: false, outboundOnly: true },
    results: plans,
    meta: {
      provider: providerName,
      queriesRun: 2,
      usedSeparateTicketFallback: false,
      partialFailures: [],
    },
  };
}

describe("mergeSearchResponses", () => {
  it("dedupes structurally identical plans keeping the cheaper offer", () => {
    const merged = mergeSearchResponses([
      response("ignav", [plan("ignav-1", 120, "2026-09-01T08:00:00")]),
      response("duffel", [
        plan("duffel-1", 100, "2026-09-01T08:00:00"),
        plan("duffel-2", 140, "2026-09-01T17:00:00"),
      ]),
    ]);
    expect(merged.meta.provider).toBe("ignav+duffel");
    expect(merged.meta.queriesRun).toBe(4);
    expect(merged.results).toHaveLength(2);
    const morning = merged.results.find((p) => p.outbound.departureAt === "2026-09-01T08:00:00");
    expect(morning?.totalPrice).toBe(100);
    expect(morning?.outbound.ticketIds).toEqual(["duffel-1"]);
  });
});

describe("mergeSimilarOptionsResponses", () => {
  it("takes the cheapest price per date across providers", () => {
    const merged = mergeSimilarOptionsResponses([
      {
        currency: "EUR",
        outbound: [
          { date: "2026-09-01", price: 120 },
          { date: "2026-09-02", price: null },
        ],
        return: null,
      },
      {
        currency: "EUR",
        outbound: [
          { date: "2026-09-01", price: 90 },
          { date: "2026-09-02", price: 200 },
        ],
        return: null,
      },
    ]);
    expect(merged.outbound).toEqual([
      { date: "2026-09-01", price: 90 },
      { date: "2026-09-02", price: 200 },
    ]);
  });
});

describe("withinLegDurationCap", () => {
  function withDurations(outboundMinutes: number, returnMinutes: number | null): TripPlan {
    const base = plan("p1", 200, "2026-09-01T08:00:00");
    return {
      ...base,
      outbound: { ...base.outbound, durationMinutes: outboundMinutes },
      return: returnMinutes === null ? null : { ...base.outbound, durationMinutes: returnMinutes },
    };
  }

  it("keeps every plan when no cap is set", () => {
    expect(withinLegDurationCap(withDurations(35 * 60, null), undefined)).toBe(true);
  });

  it("rejects a plan whose outbound or return exceeds the cap", () => {
    expect(withinLegDurationCap(withDurations(35 * 60, 180), 12)).toBe(false);
    expect(withinLegDurationCap(withDurations(180, 35 * 60), 12)).toBe(false);
  });

  it("keeps a plan at exactly the cap", () => {
    expect(withinLegDurationCap(withDurations(12 * 60, 12 * 60), 12)).toBe(true);
  });
});
