import { describe, expect, it } from "vitest";
import {
  buildMultiCityPlans,
  buildRoundTripPositioningPlans,
  buildSeparateTicketReturns,
  buildTripPlans,
  MIN_SEPARATE_TICKET_CONNECTION_MINUTES,
  rankTripPlans,
} from "./rank";
import type { FlightOption, ReturnLeg, RoundTripOption, SearchParams } from "./types";

const params: SearchParams = {
  originAirport: "VIE",
  outboundDateFrom: "2026-09-01",
  outboundDateTo: "2026-09-03",
  destinationCountry: "PT",
  directOnly: false,
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

type OptionOverrides = Partial<FlightOption> & { from: string; to: string };

let optionCounter = 0;

function option(overrides: OptionOverrides): FlightOption {
  const departureAt = overrides.departureAt ?? "2026-09-10T08:00:00";
  const arrivalAt = overrides.arrivalAt ?? "2026-09-10T10:00:00";
  return {
    id: `opt-${optionCounter++}`,
    date: departureAt.slice(0, 10),
    departureAt,
    arrivalAt,
    segments: [
      {
        from: overrides.from,
        to: overrides.to,
        departureAt,
        arrivalAt,
        carrierCode: "OS",
        carrierName: "Austrian Airlines",
        flightNumber: "OS123",
      },
    ],
    stops: 0,
    durationMinutes: 120,
    price: 100,
    currency: "EUR",
    requiresSelfTransfer: false,
    checkedBags: null,
    ...overrides,
  };
}

function singleReturn(overrides: OptionOverrides): ReturnLeg {
  return { kind: "single", option: option(overrides) };
}

describe("buildSeparateTicketReturns", () => {
  const first = option({
    from: "FCO",
    to: "FRA",
    departureAt: "2026-09-10T08:00:00",
    arrivalAt: "2026-09-10T10:00:00",
  });

  it("pairs tickets that connect through the exact same airport with enough buffer", () => {
    const second = option({
      from: "FRA",
      to: "VIE",
      departureAt: "2026-09-10T14:00:00",
      arrivalAt: "2026-09-10T15:20:00",
    });
    const legs = buildSeparateTicketReturns([first], [second]);
    expect(legs).toHaveLength(1);
    expect(legs[0]).toMatchObject({ connectionAirport: "FRA", connectionMinutes: 240 });
  });

  it("rejects pairs departing from a different airport", () => {
    const second = option({
      from: "MUC",
      to: "VIE",
      departureAt: "2026-09-10T14:00:00",
      arrivalAt: "2026-09-10T15:20:00",
    });
    expect(buildSeparateTicketReturns([first], [second])).toHaveLength(0);
  });

  it("rejects pairs with too little connection time", () => {
    const second = option({
      from: "FRA",
      to: "VIE",
      departureAt: "2026-09-10T11:00:00",
      arrivalAt: "2026-09-10T12:20:00",
    });
    const gap = 60;
    expect(gap).toBeLessThan(MIN_SEPARATE_TICKET_CONNECTION_MINUTES);
    expect(buildSeparateTicketReturns([first], [second])).toHaveLength(0);
  });
});

describe("buildTripPlans", () => {
  const outbound = option({
    from: "VIE",
    to: "LIS",
    departureAt: "2026-09-01T08:00:00",
    arrivalAt: "2026-09-01T11:00:00",
  });

  it("keeps self-transfer options and carries the flag through for display", () => {
    const selfTransferOutbound = option({
      from: "VIE",
      to: "LIS",
      departureAt: "2026-09-01T08:00:00",
      arrivalAt: "2026-09-01T11:00:00",
      requiresSelfTransfer: true,
      price: 10,
    });
    const plans = buildTripPlans(
      [outbound, selfTransferOutbound],
      [singleReturn({ from: "FCO", to: "VIE" })],
      params
    );
    expect(plans).toHaveLength(2);
    const flagged = plans.filter((p) => p.requiresSelfTransfer);
    expect(flagged).toHaveLength(1);
    expect(flagged[0].tripType).toBe("DIRECT_OPEN_JAW");
  });

  it("drops combinations where the return departs before the outbound arrives", () => {
    const plans = buildTripPlans(
      [outbound],
      [
        singleReturn({
          from: "FCO",
          to: "VIE",
          departureAt: "2026-09-01T09:00:00",
          arrivalAt: "2026-09-01T10:20:00",
        }),
      ],
      params
    );
    expect(plans).toHaveLength(0);
  });

  it("builds one-way plans without a return leg for outbound-only searches", () => {
    const plans = buildTripPlans([outbound], [], { ...params, outboundOnly: true });
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      tripType: "OUTBOUND_ONLY",
      return: null,
      totalPrice: outbound.price,
      totalStops: 0,
      isDirect: true,
    });
    expect(plans[0].totalDurationMinutes).toBe(outbound.durationMinutes);
  });

  it("classifies roundtrips and open jaws", () => {
    const roundtripParams = { ...params, destinationCountry: "IT", returnFromCountry: "IT" };
    const outboundToRome = option({
      from: "VIE",
      to: "FCO",
      departureAt: "2026-09-01T08:00:00",
      arrivalAt: "2026-09-01T10:00:00",
    });
    const plans = buildTripPlans(
      [outboundToRome],
      [singleReturn({ from: "FCO", to: "VIE" }), singleReturn({ from: "NAP", to: "VIE" })],
      roundtripParams
    );
    const types = plans.map((p) => p.tripType).sort();
    expect(types).toEqual(["DIRECT_OPEN_JAW", "DIRECT_ROUNDTRIP"]);
  });
});

describe("buildRoundTripPositioningPlans", () => {
  // JNB⇄LHR round trip; traveler must reach LHR from VIE for the way home.
  const roundTrip: RoundTripOption = {
    id: "rt-1",
    price: 500,
    currency: "EUR",
    outbound: option({
      id: "rt-1",
      from: "JNB",
      to: "LHR",
      departureAt: "2026-09-01T20:00:00",
      arrivalAt: "2026-09-02T06:00:00",
      price: 500,
    }),
    inbound: option({
      id: "rt-1",
      from: "LHR",
      to: "JNB",
      departureAt: "2026-09-14T20:00:00",
      arrivalAt: "2026-09-15T06:00:00",
      price: 0,
    }),
  };

  it("pairs a positioning flight that lands at the round trip's inbound airport in time", () => {
    const positioning = option({
      from: "VIE",
      to: "LHR",
      departureAt: "2026-09-14T10:00:00",
      arrivalAt: "2026-09-14T12:00:00",
      price: 60,
    });
    const plans = buildRoundTripPositioningPlans([roundTrip], [positioning]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      tripType: "ROUND_TRIP_PLUS_POSITIONING",
      totalPrice: 560,
      usesSeparateTickets: true,
      requiresSelfTransfer: false,
    });
    expect(plans[0].return?.airportSequence).toEqual(["VIE", "LHR", "JNB"]);
    expect(plans[0].return?.connectionMinutes).toBe(480);
  });

  it("rejects positioning flights to a different airport or with too little buffer", () => {
    const wrongAirport = option({
      from: "VIE",
      to: "LGW",
      departureAt: "2026-09-14T10:00:00",
      arrivalAt: "2026-09-14T12:00:00",
    });
    const tooTight = option({
      from: "VIE",
      to: "LHR",
      departureAt: "2026-09-14T16:30:00",
      arrivalAt: "2026-09-14T18:30:00",
    });
    expect(buildRoundTripPositioningPlans([roundTrip], [wrongAirport, tooTight])).toHaveLength(0);
  });
});

describe("buildMultiCityPlans", () => {
  // Single ticket: CPT→LHR out, VIE→CPT home — the Gabelflug case.
  const openJaw: RoundTripOption = {
    id: "mc-1",
    price: 658,
    currency: "EUR",
    outbound: option({
      id: "mc-1",
      from: "CPT",
      to: "LHR",
      departureAt: "2026-12-11T09:20:00",
      arrivalAt: "2026-12-11T21:40:00",
      price: 658,
    }),
    inbound: option({
      id: "mc-1",
      from: "VIE",
      to: "CPT",
      departureAt: "2027-01-19T18:00:00",
      arrivalAt: "2027-01-20T06:30:00",
      price: 0,
    }),
  };

  it("builds a single-ticket open-jaw plan with the fare priced once", () => {
    const plans = buildMultiCityPlans([openJaw]);
    expect(plans).toHaveLength(1);
    expect(plans[0]).toMatchObject({
      tripType: "OPEN_JAW_SINGLE_TICKET",
      totalPrice: 658,
      usesSeparateTickets: false,
      requiresSelfTransfer: false,
    });
    expect(plans[0].return?.ticketIds).toEqual(["mc-1"]);
    expect(plans[0].whyRecommended).toBe("");
  });

  it("keeps the round-trip type for mirrored slices and drops impossible timelines", () => {
    const mirrored: RoundTripOption = {
      ...openJaw,
      id: "mc-2",
      outbound: { ...openJaw.outbound, id: "mc-2" },
      inbound: option({
        id: "mc-2",
        from: "LHR",
        to: "CPT",
        departureAt: "2027-01-19T18:00:00",
        arrivalAt: "2027-01-20T06:30:00",
        price: 0,
      }),
    };
    const backwards: RoundTripOption = {
      ...openJaw,
      id: "mc-3",
      inbound: option({
        id: "mc-3",
        from: "VIE",
        to: "CPT",
        departureAt: "2026-12-01T08:00:00",
        arrivalAt: "2026-12-01T20:00:00",
        price: 0,
      }),
    };
    const plans = buildMultiCityPlans([mirrored, backwards]);
    expect(plans).toHaveLength(1);
    expect(plans[0].tripType).toBe("DIRECT_ROUNDTRIP");
  });
});

describe("rankTripPlans", () => {
  it("prefers direct single tickets, then price, and marks the winner", () => {
    const outboundDirect = option({
      from: "VIE",
      to: "LIS",
      departureAt: "2026-09-01T08:00:00",
      arrivalAt: "2026-09-01T11:00:00",
      price: 80,
    });
    const separateReturn: ReturnLeg = {
      kind: "separateSameAirport",
      first: option({
        from: "FCO",
        to: "FRA",
        departureAt: "2026-09-10T08:00:00",
        arrivalAt: "2026-09-10T10:00:00",
        price: 20,
      }),
      second: option({
        from: "FRA",
        to: "VIE",
        departureAt: "2026-09-10T14:00:00",
        arrivalAt: "2026-09-10T15:20:00",
        price: 20,
      }),
      connectionAirport: "FRA",
      connectionMinutes: 240,
    };
    const plans = buildTripPlans(
      [outboundDirect],
      [singleReturn({ from: "FCO", to: "VIE", price: 300 }), separateReturn],
      params
    );
    const ranked = rankTripPlans(plans);

    // Ticket ids surface per leg so booking links can be fetched per ticket.
    const separate = ranked.find((p) => p.usesSeparateTickets);
    expect(separate?.return?.ticketIds).toHaveLength(2);
    expect(ranked[0].outbound.ticketIds).toHaveLength(1);

    // Cheaper separate-ticket plan still ranks below the direct single-ticket plan.
    expect(ranked[0].usesSeparateTickets).toBe(false);
    expect(ranked[0].totalPrice).toBeGreaterThan(ranked[1].totalPrice);
    expect(ranked[0].whyRecommended).toContain("no airport transfer");
    expect(ranked[1].whyRecommended).toContain("FRA");
    expect(ranked.every((p) => p.score > 0 && p.score <= 1)).toBe(true);
  });

  it("ranks cheaper plans first within the same group", () => {
    const cheap = option({ from: "VIE", to: "LIS", price: 50, departureAt: "2026-09-01T08:00:00", arrivalAt: "2026-09-01T11:00:00" });
    const pricey = option({ from: "VIE", to: "OPO", price: 150, departureAt: "2026-09-01T08:00:00", arrivalAt: "2026-09-01T11:00:00" });
    const plans = buildTripPlans(
      [pricey, cheap],
      [singleReturn({ from: "FCO", to: "VIE" })],
      params
    );
    const ranked = rankTripPlans(plans);
    expect(ranked[0].totalPrice).toBeLessThan(ranked[1].totalPrice);
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });
});
