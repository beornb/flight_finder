import { describe, expect, it } from "vitest";
import { kayakCompareUrl } from "./compare-link";
import type { LegSummary, TripPlan } from "../types/trip-plan";

function leg(from: string, to: string, date: string): LegSummary {
  return {
    from,
    to,
    date,
    departureAt: `${date}T08:00:00`,
    arrivalAt: `${date}T11:00:00`,
    durationMinutes: 180,
    stops: 0,
    airlines: ["Swiss"],
    airportSequence: [from, to],
    isDirect: true,
    usesSeparateTickets: false,
    price: 100,
    currency: "EUR",
    ticketIds: ["t1"],
  };
}

const basePlan: TripPlan = {
  id: "p1",
  tripType: "DIRECT_OPEN_JAW",
  totalPrice: 658,
  currency: "EUR",
  isDirect: true,
  usesSeparateTickets: false,
  requiresSelfTransfer: false,
  score: 1,
  whyRecommended: "",
  totalDurationMinutes: 360,
  totalStops: 0,
  outbound: leg("CPT", "LHR", "2026-12-11"),
  return: leg("VIE", "CPT", "2027-01-19"),
};

describe("kayakCompareUrl", () => {
  it("builds a multi-city link from both legs", () => {
    expect(kayakCompareUrl(basePlan, 1)).toBe(
      "https://www.kayak.com/flights/CPT-LHR/2026-12-11/VIE-CPT/2027-01-19?sort=bestflight_a"
    );
  });

  it("adds the passenger segment for more than one adult", () => {
    expect(kayakCompareUrl(basePlan, 2)).toBe(
      "https://www.kayak.com/flights/CPT-LHR/2026-12-11/VIE-CPT/2027-01-19/2adults?sort=bestflight_a"
    );
  });

  it("builds a one-way link when the plan has no return", () => {
    expect(kayakCompareUrl({ ...basePlan, return: null }, 1)).toBe(
      "https://www.kayak.com/flights/CPT-LHR/2026-12-11?sort=bestflight_a"
    );
  });
});
