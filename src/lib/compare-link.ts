import type { TripPlan } from "../types/trip-plan";

// Kayak accepts multi-city searches directly in the URL path:
// /flights/CPT-LHR/2026-12-11/VIE-CPT/2027-01-19/2adults
// Useful to check whether a single-ticket (open-jaw) fare beats the plan.
export function kayakCompareUrl(plan: TripPlan, adults: number): string {
  const segments = [`${plan.outbound.from}-${plan.outbound.to}`, plan.outbound.date];
  if (plan.return) {
    segments.push(`${plan.return.from}-${plan.return.to}`, plan.return.date);
  }
  if (adults > 1) {
    segments.push(`${adults}adults`);
  }
  return `https://www.kayak.com/flights/${segments.join("/")}?sort=bestflight_a`;
}
