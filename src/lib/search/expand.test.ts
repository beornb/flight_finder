import { describe, expect, it } from "vitest";
import {
  batchAirportQueries,
  buildFallbackQueries,
  buildOutboundQueries,
  buildReturnQueries,
  expandDates,
  MAX_DATES_PER_RANGE,
} from "./expand";
import type { SearchParams } from "./types";

const params: SearchParams = {
  originAirport: "VIE",
  outboundDateFrom: "2026-09-01",
  outboundDateTo: "2026-09-03",
  destinationCountry: "PT",
  directOnly: true,
  outboundOnly: false,
  returnDateFrom: "2026-09-10",
  returnDateTo: "2026-09-11",
  returnFromCountry: "IT",
  returnToCountry: "AT",
  adults: 1,
  cabinClass: "ECONOMY",
  thorough: false,
  checkedBagIncluded: false,
  allowSeparateTicketsSameAirportOnly: true,
};

describe("expandDates", () => {
  it("returns every day in a small range, inclusive", () => {
    expect(expandDates("2026-09-01", "2026-09-03")).toEqual([
      "2026-09-01",
      "2026-09-02",
      "2026-09-03",
    ]);
  });

  it("samples large ranges down to the cap, keeping both endpoints", () => {
    const dates = expandDates("2026-09-01", "2026-09-30");
    expect(dates).toHaveLength(MAX_DATES_PER_RANGE);
    expect(dates[0]).toBe("2026-09-01");
    expect(dates[dates.length - 1]).toBe("2026-09-30");
  });

  it("returns an empty list for an inverted or invalid range", () => {
    expect(expandDates("2026-09-10", "2026-09-01")).toEqual([]);
    expect(expandDates("not-a-date", "2026-09-01")).toEqual([]);
  });
});

describe("buildOutboundQueries", () => {
  it("expands the destination country into airport and date combinations", () => {
    const queries = buildOutboundQueries(params);
    const destinations = new Set(queries.map((q) => q.destination));
    expect(destinations).toEqual(new Set(["LIS", "OPO", "FAO", "FNC"]));
    expect(queries).toHaveLength(4 * 3);
    expect(queries.every((q) => q.origin === "VIE")).toBe(true);
  });

  it("propagates directOnly as nonStopOnly", () => {
    expect(buildOutboundQueries(params).every((q) => q.nonStopOnly)).toBe(true);
    const anyStops = buildOutboundQueries({ ...params, directOnly: false });
    expect(anyStops.every((q) => !q.nonStopOnly)).toBe(true);
  });

  it("propagates the checked-bag requirement to providers", () => {
    expect(buildOutboundQueries(params).every((q) => !q.checkedBagIncluded)).toBe(true);
    const withBag = { ...params, checkedBagIncluded: true };
    expect(buildOutboundQueries(withBag).every((q) => q.checkedBagIncluded)).toBe(true);
    const { firstLegs, secondLegs } = buildFallbackQueries(withBag);
    expect([...firstLegs, ...secondLegs].every((q) => q.checkedBagIncluded)).toBe(true);
  });

  it("never searches from the origin airport to itself", () => {
    const queries = buildOutboundQueries({ ...params, destinationCountry: "AT" });
    expect(queries.some((q) => q.destination === "VIE")).toBe(false);
  });

  it("uses a single exact airport when the destination slot is an airport", () => {
    const queries = buildOutboundQueries({
      ...params,
      destinationCountry: undefined,
      destinationAirport: "LIS",
    });
    expect(new Set(queries.map((q) => q.destination))).toEqual(new Set(["LIS"]));
    expect(queries).toHaveLength(3);
  });

  it("expands metro codes into all of the city's airports", () => {
    const london = buildOutboundQueries({
      ...params,
      destinationCountry: undefined,
      destinationAirport: "LON",
    });
    expect(new Set(london.map((q) => q.destination))).toEqual(new Set(["LHR", "LGW", "STN", "LTN"]));

    const tokyo = buildOutboundQueries({
      ...params,
      destinationCountry: undefined,
      destinationAirport: "TYO",
    });
    expect(new Set(tokyo.map((q) => q.destination))).toEqual(new Set(["HND", "NRT"]));
  });
});

describe("buildReturnQueries", () => {
  it("returns nothing for outbound-only searches", () => {
    expect(buildReturnQueries({ ...params, outboundOnly: true })).toEqual([]);
    const { firstLegs, secondLegs } = buildFallbackQueries({ ...params, outboundOnly: true });
    expect(firstLegs).toEqual([]);
    expect(secondLegs).toEqual([]);
  });

  it("combines return-from and return-to country airports", () => {
    const queries = buildReturnQueries(params);
    const origins = new Set(queries.map((q) => q.origin));
    const destinations = new Set(queries.map((q) => q.destination));
    expect(origins).toEqual(new Set(["FCO", "MXP", "VCE", "NAP"]));
    expect(destinations).toEqual(new Set(["VIE", "SZG", "INN", "GRZ"]));
  });

  it("mixes airport and country slots", () => {
    const queries = buildReturnQueries({
      ...params,
      returnFromCountry: undefined,
      returnFromAirport: "FCO",
    });
    expect(new Set(queries.map((q) => q.origin))).toEqual(new Set(["FCO"]));
    expect(new Set(queries.map((q) => q.destination))).toEqual(
      new Set(["VIE", "SZG", "INN", "GRZ"])
    );
  });
});

describe("thorough mode", () => {
  it("widens date sampling and airport caps", () => {
    const wide = {
      ...params,
      thorough: true,
      outboundDateFrom: "2026-09-01",
      outboundDateTo: "2026-09-10",
    };
    // 10 dates (no sampling below 14) × 4 Portuguese airports.
    expect(buildOutboundQueries(wide)).toHaveLength(40);
    expect(buildOutboundQueries({ ...wide, thorough: false })).toHaveLength(16);
  });
});

describe("batchAirportQueries", () => {
  it("collapses queries differing only in airports into one per date", () => {
    const queries = buildReturnQueries(params); // 4 origins × 4 destinations × 2 dates
    const batched = batchAirportQueries(queries);
    expect(batched).toHaveLength(2);
    for (const query of batched) {
      expect(query.origin).toBe("FCO,MXP,NAP,VCE");
      expect(query.destination).toBe("GRZ,INN,SZG,VIE");
    }
  });

  it("keeps queries with different filters separate", () => {
    const queries = buildOutboundQueries(params);
    const mixed = [...queries, { ...queries[0], nonStopOnly: !queries[0].nonStopOnly }];
    const batched = batchAirportQueries(mixed);
    expect(batched.length).toBe(new Set(batched.map((q) => `${q.date}|${q.nonStopOnly}`)).size);
  });
});

describe("buildFallbackQueries", () => {
  it("builds nonstop hub legs that meet at the same airport", () => {
    const { firstLegs, secondLegs } = buildFallbackQueries(params);
    expect(firstLegs.length).toBeGreaterThan(0);
    expect([...firstLegs, ...secondLegs].every((q) => q.nonStopOnly)).toBe(true);

    const firstHubs = new Set(firstLegs.map((q) => q.destination));
    const secondHubs = new Set(secondLegs.map((q) => q.origin));
    expect(firstHubs).toEqual(secondHubs);
  });

  it("never routes the fallback through the endpoints themselves", () => {
    const { firstLegs } = buildFallbackQueries(params);
    // FCO and VIE are hubs but belong to the return-from/return-to countries.
    expect(firstLegs.some((q) => q.destination === "FCO")).toBe(false);
    expect(firstLegs.some((q) => q.destination === "VIE")).toBe(false);
  });
});
