import type { LegSummary, TripPlan, TripType } from "../../types/trip-plan";
import type { FlightOption, ReturnLeg, RoundTripOption, SearchParams } from "./types";

// Separate tickets need a generous buffer since a missed connection is the
// traveler's problem.
export const MIN_SEPARATE_TICKET_CONNECTION_MINUTES = 180;
export const MAX_SEPARATE_TICKET_CONNECTION_MINUTES = 12 * 60;

const MAX_OPTIONS_PER_SIDE = 12;
const MAX_RESULTS = 20;
// Rarer strategies (separate tickets, nested returns) rank below single
// tickets and would vanish behind the result cap; always surface a few.
const MIN_PLANS_PER_TRIP_TYPE = 3;

// Pair nonstop legs into a same-airport separate-ticket return: the second
// ticket must depart from the exact airport the first one arrives at.
export function buildSeparateTicketReturns(
  firstLegs: FlightOption[],
  secondLegs: FlightOption[]
): ReturnLeg[] {
  const legs: ReturnLeg[] = [];
  for (const first of firstLegs) {
    if (first.requiresSelfTransfer) continue;
    for (const second of secondLegs) {
      if (second.requiresSelfTransfer) continue;
      if (second.from !== first.to) continue;
      const gap = minutesBetween(first.arrivalAt, second.departureAt);
      if (gap < MIN_SEPARATE_TICKET_CONNECTION_MINUTES) continue;
      if (gap > MAX_SEPARATE_TICKET_CONNECTION_MINUTES) continue;
      legs.push({
        kind: "separateSameAirport",
        first,
        second,
        connectionAirport: first.to,
        connectionMinutes: gap,
      });
    }
  }
  return legs;
}

export function buildTripPlans(
  outbounds: FlightOption[],
  returns: ReturnLeg[],
  params: SearchParams
): TripPlan[] {
  const topOutbounds = cheapest(outbounds, (o) => o.price).slice(0, MAX_OPTIONS_PER_SIDE);
  const topReturns = cheapest(returns, returnLegPrice).slice(0, MAX_OPTIONS_PER_SIDE);

  const plans: TripPlan[] = [];
  if (params.outboundOnly) {
    for (const outbound of topOutbounds) {
      plans.push(assemblePlan(outbound, null));
    }
  } else {
    for (const outbound of topOutbounds) {
      for (const returnLeg of topReturns) {
        const returnDeparture = returnLegDeparture(returnLeg);
        if (new Date(returnDeparture) <= new Date(outbound.arrivalAt)) continue;
        plans.push(assemblePlan(outbound, returnLeg));
      }
    }
  }
  return plans;
}

// The "nested return" strategy: a round-trip fare origin⇄destination is often
// far cheaper than two one-ways, so fly its inbound half home and reach it
// with a separate positioning flight that connects at the same airport.
export function buildRoundTripPositioningPlans(
  roundTrips: RoundTripOption[],
  positioning: FlightOption[]
): TripPlan[] {
  const topRoundTrips = cheapest(roundTrips, (rt) => rt.price).slice(0, MAX_OPTIONS_PER_SIDE);
  const topPositioning = cheapest(positioning, (p) => p.price).slice(0, MAX_OPTIONS_PER_SIDE);

  const plans: TripPlan[] = [];
  for (const rt of topRoundTrips) {
    for (const pos of topPositioning) {
      if (pos.to !== rt.inbound.from) continue;
      if (new Date(pos.departureAt) <= new Date(rt.outbound.arrivalAt)) continue;
      const gap = minutesBetween(pos.arrivalAt, rt.inbound.departureAt);
      if (gap < MIN_SEPARATE_TICKET_CONNECTION_MINUTES) continue;
      if (gap > MAX_SEPARATE_TICKET_CONNECTION_MINUTES) continue;
      const returnLeg: ReturnLeg = {
        kind: "separateSameAirport",
        first: pos,
        second: rt.inbound,
        connectionAirport: pos.to,
        connectionMinutes: gap,
      };
      plans.push({ ...assemblePlan(rt.outbound, returnLeg), tripType: "ROUND_TRIP_PLUS_POSITIONING" });
    }
  }
  return plans;
}

// Single-ticket open jaws from a multi-city capable provider: both legs are
// one booking priced together, so they compete in the single-ticket group.
export function buildMultiCityPlans(options: RoundTripOption[]): TripPlan[] {
  const top = cheapest(options, (option) => option.price).slice(0, MAX_OPTIONS_PER_SIDE);

  const plans: TripPlan[] = [];
  for (const option of top) {
    if (new Date(option.inbound.departureAt) <= new Date(option.outbound.arrivalAt)) continue;
    const plan = assemblePlan(option.outbound, { kind: "single", option: option.inbound });
    // Mirrored slices are genuinely a single-ticket round trip; keep that type.
    plans.push(
      plan.tripType === "DIRECT_OPEN_JAW" ? { ...plan, tripType: "OPEN_JAW_SINGLE_TICKET" } : plan
    );
  }
  return plans;
}

export function rankTripPlans(plans: TripPlan[]): TripPlan[] {
  const sorted = [...plans].sort((a, b) => {
    const groupDiff = rankGroup(a) - rankGroup(b);
    if (groupDiff !== 0) return groupDiff;
    if (a.totalPrice !== b.totalPrice) return a.totalPrice - b.totalPrice;
    if (a.totalDurationMinutes !== b.totalDurationMinutes) {
      return a.totalDurationMinutes - b.totalDurationMinutes;
    }
    return a.totalStops - b.totalStops;
  });

  const top = sorted.slice(0, MAX_RESULTS);
  const included = new Set(top.map((plan) => plan.id));
  const countByType = new Map<string, number>();
  for (const plan of top) countByType.set(plan.tripType, (countByType.get(plan.tripType) ?? 0) + 1);
  for (const plan of sorted) {
    if (included.has(plan.id)) continue;
    const count = countByType.get(plan.tripType) ?? 0;
    if (count >= MIN_PLANS_PER_TRIP_TYPE) continue;
    top.push(plan);
    included.add(plan.id);
    countByType.set(plan.tripType, count + 1);
  }

  const cheapestPrice = top.length > 0 ? Math.min(...top.map((p) => p.totalPrice)) : 0;
  return top.map((plan, index) => ({
    ...plan,
    score: computeScore(plan, cheapestPrice),
    whyRecommended: describePlan(plan, index === 0),
  }));
}

// Lower group ranks first: direct single tickets, then single tickets with
// stops, then same-airport separate tickets.
function rankGroup(plan: TripPlan): number {
  if (plan.usesSeparateTickets) return 2;
  return plan.isDirect ? 0 : 1;
}

function computeScore(plan: TripPlan, cheapestPrice: number): number {
  const groupBase = [1, 0.9, 0.75][rankGroup(plan)];
  const priceFactor = plan.totalPrice > 0 ? cheapestPrice / plan.totalPrice : 1;
  return Math.round(groupBase * priceFactor * 100) / 100;
}

function describePlan(plan: TripPlan, isBest: boolean): string {
  if (plan.requiresSelfTransfer) {
    return "Includes a self-managed airport change or separately stitched tickets — allow plenty of time between flights.";
  }
  if (plan.tripType === "OPEN_JAW_SINGLE_TICKET") {
    return (
      `One multi-city ticket covering ${plan.outbound.from} → ${plan.outbound.to} and ` +
      `${plan.return?.from ?? ""} → ${plan.return?.to ?? ""} — a single booking, ` +
      `often cheaper than separate one-way fares.`
    );
  }
  if (plan.tripType === "ROUND_TRIP_PLUS_POSITIONING") {
    const airport = plan.return?.connectionAirport ?? "the connection airport";
    return (
      `Cheap round-trip fare ${plan.outbound.from} ⇄ ${plan.outbound.to} plus a separate ` +
      `${plan.return?.from ?? ""} → ${airport} ticket — the connection stays in ${airport}.`
    );
  }
  if (plan.usesSeparateTickets) {
    const airport = plan.return?.connectionAirport ?? "the connection airport";
    return `Separate tickets on the way back, but both use ${airport} — you never change airports yourself.`;
  }
  if (plan.isDirect) {
    if (isBest) return "Cheapest direct option with no airport transfer required.";
    return plan.return === null
      ? "Direct flight — no airport change required."
      : "Direct flights only — no airport change required.";
  }
  return "Single tickets with airline-managed connections — no airport change required.";
}

function assemblePlan(outbound: FlightOption, returnLeg: ReturnLeg | null): TripPlan {
  const outboundSummary = summarizeSingle(outbound);
  const returnSummary = returnLeg ? summarizeReturnLeg(returnLeg) : null;
  const usesSeparateTickets = returnLeg?.kind === "separateSameAirport";
  const requiresSelfTransfer =
    outbound.requiresSelfTransfer ||
    (returnLeg?.kind === "single" && returnLeg.option.requiresSelfTransfer);
  const isDirect =
    outboundSummary.isDirect && (returnSummary ? returnSummary.isDirect && !usesSeparateTickets : true);

  return {
    id: returnLeg ? `${outbound.id}__${returnLegId(returnLeg)}` : outbound.id,
    tripType: classify(outbound, returnLeg),
    totalPrice: round2(outboundSummary.price + (returnSummary?.price ?? 0)),
    currency: outboundSummary.currency,
    isDirect,
    usesSeparateTickets,
    requiresSelfTransfer,
    score: 0,
    whyRecommended: "",
    totalDurationMinutes: outboundSummary.durationMinutes + (returnSummary?.durationMinutes ?? 0),
    totalStops: outboundSummary.stops + (returnSummary?.stops ?? 0),
    outbound: outboundSummary,
    return: returnSummary,
  };
}

function classify(outbound: FlightOption, returnLeg: ReturnLeg | null): TripType {
  if (returnLeg === null) return "OUTBOUND_ONLY";
  if (returnLeg.kind === "separateSameAirport") return "SAME_AIRPORT_SEPARATE_TICKETS";
  const isRoundtripShape =
    returnLeg.option.from === outbound.to && returnLeg.option.to === outbound.from;
  return isRoundtripShape ? "DIRECT_ROUNDTRIP" : "DIRECT_OPEN_JAW";
}

function summarizeSingle(option: FlightOption): LegSummary {
  return {
    from: option.from,
    to: option.to,
    date: option.date,
    departureAt: option.departureAt,
    arrivalAt: option.arrivalAt,
    durationMinutes: option.durationMinutes,
    stops: option.stops,
    airlines: uniqueAirlines(option),
    carriers: uniqueCarriers(option),
    airportSequence: [option.segments[0].from, ...option.segments.map((s) => s.to)],
    isDirect: option.stops === 0,
    usesSeparateTickets: false,
    price: option.price,
    currency: option.currency,
    checkedBags: option.checkedBags,
    ticketIds: [option.id],
  };
}

function summarizeReturnLeg(leg: ReturnLeg): LegSummary {
  if (leg.kind === "single") return summarizeSingle(leg.option);
  const { first, second } = leg;
  return {
    from: first.from,
    to: second.to,
    date: first.date,
    departureAt: first.departureAt,
    arrivalAt: second.arrivalAt,
    durationMinutes: minutesBetween(first.departureAt, second.arrivalAt),
    stops: 1,
    airlines: [...new Set([...uniqueAirlines(first), ...uniqueAirlines(second)])],
    carriers: uniqueCarriers(first, second),
    airportSequence: [first.from, leg.connectionAirport, second.to],
    isDirect: false,
    usesSeparateTickets: true,
    connectionAirport: leg.connectionAirport,
    connectionMinutes: leg.connectionMinutes,
    price: round2(first.price + second.price),
    currency: first.currency,
    checkedBags:
      first.checkedBags === null || second.checkedBags === null
        ? null
        : Math.min(first.checkedBags, second.checkedBags),
    ticketIds: [first.id, second.id],
  };
}

function uniqueAirlines(option: FlightOption): string[] {
  return [...new Set(option.segments.map((s) => s.carrierName ?? s.carrierCode))];
}

function uniqueCarriers(...options: FlightOption[]): { code: string; name: string }[] {
  const byCode = new Map<string, string>();
  for (const option of options) {
    for (const segment of option.segments) {
      if (!byCode.has(segment.carrierCode)) {
        byCode.set(segment.carrierCode, segment.carrierName ?? segment.carrierCode);
      }
    }
  }
  return [...byCode.entries()].map(([code, name]) => ({ code, name }));
}

function returnLegPrice(leg: ReturnLeg): number {
  return leg.kind === "single" ? leg.option.price : leg.first.price + leg.second.price;
}

function returnLegDeparture(leg: ReturnLeg): string {
  return leg.kind === "single" ? leg.option.departureAt : leg.first.departureAt;
}

function returnLegId(leg: ReturnLeg): string {
  return leg.kind === "single" ? leg.option.id : `${leg.first.id}+${leg.second.id}`;
}

function cheapest<T>(items: T[], price: (item: T) => number): T[] {
  return [...items].sort((a, b) => price(a) - price(b));
}

function minutesBetween(fromIso: string, toIso: string): number {
  return Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
