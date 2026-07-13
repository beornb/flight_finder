import { listSavedSearches, saveSearch } from "@/lib/saved/store";
import { searchRequestSchema } from "@/lib/validation/search-schema";

export async function GET() {
  const searches = await listSavedSearches();
  return Response.json({ searches });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = searchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid search parameters.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  const search = await saveSearch(parsed.data);
  return Response.json({ search }, { status: 201 });
}
