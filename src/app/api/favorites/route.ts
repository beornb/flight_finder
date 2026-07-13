import { z } from "zod";
import { saveFavorite } from "@/lib/saved/store";
import type { TripPlan } from "@/types/trip-plan";
import { tripPlanSnapshotSchema } from "@/lib/validation/saved-schema";
import { searchRequestSchema } from "@/lib/validation/search-schema";

const favoriteRequestSchema = z.object({
  search: searchRequestSchema,
  plan: tripPlanSnapshotSchema,
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = favoriteRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid favorite request.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  const search = await saveFavorite(parsed.data.search, parsed.data.plan as TripPlan);
  return Response.json({ search }, { status: 201 });
}
