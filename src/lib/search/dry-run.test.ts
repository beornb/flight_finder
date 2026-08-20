import { describe, expect, it, vi } from "vitest";
import { createSerpApiProvider } from "../providers/serpapi";
import { buildBookingLinkPlan, createRecordingProvider } from "./dry-run";
import { runSearch, runSimilarOptions } from "./engine";
import type { SearchParams } from "./types";

vi.mock("./cache", () => ({
  getCachedOptions: async () => null,
  setCachedOptions: async () => undefined,
}));

// One exact airport per endpoint, three outbound and three return dates.
const params: SearchParams = {
  originAirport: "VIE",
  outboundDateFrom: "2026-09-01",
  outboundDateTo: "2026-09-03",
  destinationAirport: "LHR",
  returnDateFrom: "2026-09-10",
  returnDateTo: "2026-09-12",
  returnFromAirport: "LHR",
  returnToAirport: "VIE",
  directOnly: false,
  outboundOnly: false,
  adults: 1,
  cabinClass: "ECONOMY",
  thorough: false,
  checkedBagIncluded: false,
  allowSeparateTicketsSameAirportOnly: true,
};

async function planFor(overrides: Partial<SearchParams> = {}) {
  const recording = createRecordingProvider(createSerpApiProvider({ apiKey: "test" }));
  await runSearch({ ...params, ...overrides }, recording.provider);
  return recording.plan();
}

describe("createRecordingProvider", () => {
  it("issues no provider requests", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await planFor();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("plans a fixed-airport round trip without airport or date explosion", async () => {
    const plan = await planFor();
    const byStage = Object.fromEntries(plan.stages.map((s) => [s.stage, s.queries]));
    expect(byStage).toEqual({
      outbound: 3,
      return: 3,
      "separate-ticket-first-leg": 2,
      "separate-ticket-second-leg": 2,
      "round-trip": 9,
    });
    // Two-slice queries dominate the bill: 9 round trips at 4 searches each.
    expect(plan.providerRequests).toBe(3 + 3 + 2 + 2 + 9 * 4);
  });

  it("records the parameters each query would be sent with", async () => {
    const plan = await planFor();
    expect(plan.plannedQueries[0]).toMatchObject({
      stage: "outbound",
      kind: "oneWay",
      origin: "VIE",
      destination: "LHR",
      date: "2026-09-01",
      adults: 1,
      cabinClass: "ECONOMY",
      nonStopOnly: false,
    });
    const roundTrip = plan.plannedQueries.find((q) => q.kind === "roundTrip");
    expect(roundTrip).toMatchObject({ origin: "VIE", destination: "LHR", returnDate: "2026-09-10" });
  });

  it("plans only outbound queries for a one-way search", async () => {
    const plan = await planFor({ outboundOnly: true });
    expect(plan.stages).toEqual([{ stage: "outbound", queries: 3, providerRequests: 3 }]);
  });
});

describe("createRecordingProvider on the similar-options matrix", () => {
  it("plans one query per date per route", async () => {
    const recording = createRecordingProvider(createSerpApiProvider({ apiKey: "test" }));
    await runSimilarOptions(
      {
        outboundRoute: { origin: "VIE", destination: "LHR" },
        returnRoute: { origin: "LHR", destination: "VIE" },
        outboundDateFrom: "2026-09-01",
        outboundDateTo: "2026-09-03",
        returnDateFrom: "2026-09-10",
        returnDateTo: "2026-09-12",
        adults: 1,
        cabinClass: "ECONOMY",
        directOnly: false,
        checkedBagIncluded: false,
      },
      recording.provider
    );
    expect(recording.plan().stages).toEqual([
      { stage: "similar-outbound", queries: 3, providerRequests: 3 },
      { stage: "similar-return", queries: 3, providerRequests: 3 },
    ]);
  });
});

describe("buildBookingLinkPlan", () => {
  it("names the provider each ticket would be looked up with", () => {
    const plan = buildBookingLinkPlan([
      { ticketId: "duffel-abc", provider: "duffel" },
      { ticketId: "unknown-abc", provider: null },
    ]);
    expect(plan.dryRun).toBe(true);
    expect(plan.lookups[0]).toEqual({ ticketId: "duffel-abc", provider: "duffel" });
    expect(plan.notes.some((note) => note.includes("unbookable"))).toBe(true);
  });
});
