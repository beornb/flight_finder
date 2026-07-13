import type { DatePrice } from "@/lib/search/similar";

export type SimilarOptionsResponse = {
  currency: string | null;
  // Cheapest price per outbound date for the plan's outbound route.
  outbound: DatePrice[];
  // Same for the return route; null for one-way plans.
  return: DatePrice[] | null;
};
