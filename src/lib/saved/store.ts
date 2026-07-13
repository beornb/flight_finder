import type { SavedResult, SavedSearch } from "@/generated/prisma/client";
import type { SavedSearchDto } from "../../types/saved";
import type { TripPlan } from "../../types/trip-plan";
import { prisma } from "../prisma";
import type { SearchParams } from "../search/types";
import { stableStringify } from "./canonical";

type SavedSearchRow = SavedSearch & { results: SavedResult[] };

function toDto(row: SavedSearchRow): SavedSearchDto {
  return {
    id: row.id,
    params: JSON.parse(row.params) as SearchParams,
    createdAt: row.createdAt.toISOString(),
    favorites: row.results.map((result) => ({
      id: result.id,
      plan: JSON.parse(result.plan) as TripPlan,
      createdAt: result.createdAt.toISOString(),
    })),
  };
}

// Idempotent: saving the same params twice returns the existing row.
export async function saveSearch(params: SearchParams): Promise<SavedSearchDto> {
  const canonical = stableStringify(params);
  const row = await prisma.savedSearch.upsert({
    where: { params: canonical },
    create: { params: canonical },
    update: {},
    include: { results: true },
  });
  return toDto(row);
}

export async function listSavedSearches(): Promise<SavedSearchDto[]> {
  const rows = await prisma.savedSearch.findMany({
    include: { results: { orderBy: { createdAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDto);
}

export async function deleteSavedSearch(id: number): Promise<boolean> {
  const result = await prisma.savedSearch.deleteMany({ where: { id } });
  return result.count > 0;
}

// Favoriting a result implies saving its search: the favorite is linked to the
// saved search and cannot exist without it.
export async function saveFavorite(params: SearchParams, plan: TripPlan): Promise<SavedSearchDto> {
  const search = await saveSearch(params);
  await prisma.savedResult.upsert({
    where: { savedSearchId_planId: { savedSearchId: search.id, planId: plan.id } },
    create: { savedSearchId: search.id, planId: plan.id, plan: JSON.stringify(plan) },
    update: {},
  });
  const row = await prisma.savedSearch.findUniqueOrThrow({
    where: { id: search.id },
    include: { results: { orderBy: { createdAt: "desc" } } },
  });
  return toDto(row);
}

export async function deleteFavorite(id: number): Promise<boolean> {
  const result = await prisma.savedResult.deleteMany({ where: { id } });
  return result.count > 0;
}
