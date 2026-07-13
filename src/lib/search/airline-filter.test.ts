import { describe, expect, it } from "vitest";
import { airlineStats, filterPlansByAirlines } from "./airline-filter";
import type { LegSummary, TripPlan } from "../../types/trip-plan";

function leg(airlines: string[]): LegSummary {
  return {
    from: "VIE",
    to: "LIS",
    date: "2026-09-01",
    departureAt: "2026-09-01T08:00:00",
    arrivalAt: "2026-09-01T11:00:00",
    durationMinutes: 180,
    stops: 0,
    airlines,
    carriers: airlines.map((name) => ({ code: name.slice(0, 2).toUpperCase(), name })),
    airportSequence: ["VIE", "LIS"],
    isDirect: true,
    usesSeparateTickets: false,
    price: 100,
    currency: "EUR",
    ticketIds: ["t1"],
  };
}

function plan(id: string, totalPrice: number, outboundAirlines: string[], returnAirlines?: string[]): TripPlan {
  return {
    id,
    tripType: returnAirlines ? "DIRECT_OPEN_JAW" : "OUTBOUND_ONLY",
    totalPrice,
    currency: "EUR",
    isDirect: true,
    usesSeparateTickets: false,
    requiresSelfTransfer: false,
    score: 1,
    whyRecommended: "",
    totalDurationMinutes: 180,
    totalStops: 0,
    outbound: leg(outboundAirlines),
    return: returnAirlines ? leg(returnAirlines) : null,
  };
}

const plans = [
  plan("a", 100, ["Ryanair"], ["Ryanair"]),
  plan("b", 80, ["Wizz Air"], ["Ryanair"]),
  plan("c", 150, ["Lufthansa"]),
];

describe("airlineStats", () => {
  it("collects each airline with the cheapest plan involving it, sorted by price", () => {
    expect(airlineStats(plans)).toEqual([
      { name: "Ryanair", code: "RY", minPrice: 80, currency: "EUR" },
      { name: "Wizz Air", code: "WI", minPrice: 80, currency: "EUR" },
      { name: "Lufthansa", code: "LU", minPrice: 150, currency: "EUR" },
    ]);
  });
});

describe("filterPlansByAirlines", () => {
  it("returns everything when nothing is excluded", () => {
    expect(filterPlansByAirlines(plans, new Set())).toHaveLength(3);
  });

  it("hides plans that involve an excluded airline on any leg", () => {
    const visible = filterPlansByAirlines(plans, new Set(["Ryanair"]));
    expect(visible.map((p) => p.id)).toEqual(["c"]);
  });
});
