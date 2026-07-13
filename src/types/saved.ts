import type { SearchParams } from "@/lib/search/types";
import type { TripPlan } from "./trip-plan";

export type SavedResultDto = {
  id: number;
  plan: TripPlan;
  createdAt: string;
};

export type SavedSearchDto = {
  id: number;
  params: SearchParams;
  createdAt: string;
  favorites: SavedResultDto[];
};
