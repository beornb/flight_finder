import { describe, expect, it } from "vitest";
import { cheapestPerDate } from "./similar";
import type { FlightOption } from "./types";

function option(
  date: string,
  price: number,
  stops = 0,
  requiresSelfTransfer = false,
  durationMinutes = 180
): FlightOption {
  return {
    id: `opt-${date}-${price}`,
    from: "VIE",
    to: "LIS",
    date,
    departureAt: `${date}T08:00:00`,
    arrivalAt: `${date}T11:00:00`,
    segments: [],
    stops,
    durationMinutes,
    price,
    currency: "EUR",
    requiresSelfTransfer,
    checkedBags: null,
  };
}

describe("cheapestPerDate", () => {
  const options = [
    option("2026-09-01", 120),
    option("2026-09-01", 80, 1),
    option("2026-09-02", 60, 0, true),
    option("2026-09-02", 95),
  ];
  const dates = ["2026-09-01", "2026-09-02", "2026-09-03"];

  it("picks the cheapest option per date and null for empty dates", () => {
    expect(cheapestPerDate(options, dates, false)).toEqual([
      { date: "2026-09-01", price: 80 },
      { date: "2026-09-02", price: 60 },
      { date: "2026-09-03", price: null },
    ]);
  });

  it("skips options longer than the leg cap", () => {
    const withLongHop = [...options, option("2026-09-03", 20, 1, false, 35 * 60)];
    expect(cheapestPerDate(withLongHop, dates, false, 10)).toEqual([
      { date: "2026-09-01", price: 80 },
      { date: "2026-09-02", price: 60 },
      { date: "2026-09-03", price: null },
    ]);
    expect(cheapestPerDate(withLongHop, dates, false)[2]).toEqual({ date: "2026-09-03", price: 20 });
  });

  it("respects direct-only", () => {
    expect(cheapestPerDate(options, dates, true)).toEqual([
      { date: "2026-09-01", price: 120 },
      { date: "2026-09-02", price: 60 },
      { date: "2026-09-03", price: null },
    ]);
  });
});
