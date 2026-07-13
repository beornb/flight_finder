import { describe, expect, it } from "vitest";
import { createMockProvider } from "./mock";
import type { FlightQuery } from "../search/types";

const query: FlightQuery = {
  origin: "VIE",
  destination: "LIS",
  date: "2026-09-02",
  adults: 1,
  cabinClass: "ECONOMY",
  nonStopOnly: false,
  checkedBagIncluded: false,
};

describe("mock provider airline exclusion", () => {
  it("drops every option involving an excluded carrier", async () => {
    const provider = createMockProvider();
    const all = await provider.searchOneWay(query);
    const carriers = new Set(all.flatMap((o) => o.segments.map((s) => s.carrierCode)));
    const target = [...carriers][0];
    const filtered = await provider.searchOneWay({ ...query, excludedAirlines: [target] });
    expect(all.some((o) => o.segments.some((s) => s.carrierCode === target))).toBe(true);
    expect(filtered.some((o) => o.segments.some((s) => s.carrierCode === target))).toBe(false);
  });
});

describe("mock provider checked-bag filter", () => {
  it("drops fares explicitly known to have no checked bag, keeps unknowns", async () => {
    const provider = createMockProvider();
    // Sample several dates so the deterministic bag mix includes 0-bag fares.
    const dates = ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"];
    const all = (
      await Promise.all(dates.map((date) => provider.searchOneWay({ ...query, date })))
    ).flat();
    const withBagFlag = (
      await Promise.all(
        dates.map((date) => provider.searchOneWay({ ...query, date, checkedBagIncluded: true }))
      )
    ).flat();

    expect(all.some((option) => option.checkedBags === 0)).toBe(true);
    expect(withBagFlag.every((option) => option.checkedBags !== 0)).toBe(true);
    expect(withBagFlag.some((option) => option.checkedBags === null)).toBe(true);
    expect(withBagFlag.length).toBeLessThan(all.length);
  });
});
