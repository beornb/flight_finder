import { z } from "zod";
import { resolveProviders } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";
import {
  buildSearchPlan,
  createRecordingProvider,
  isDryRun,
  type ProviderPlan,
} from "@/lib/search/dry-run";
import { mergeSearchResponses, runSearch, SearchError } from "@/lib/search/engine";
import { searchRequestSchema } from "@/lib/validation/search-schema";
import type { SearchResponse } from "@/types/trip-plan";

const providerChoiceSchema = z.enum(["mock", "ignav", "duffel", "serpapi", "all"]).optional();

function errorResponse(error: unknown): Response {
  if (error instanceof SearchError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof ProviderError) {
    const status = error.kind === "rate_limit" ? 429 : 502;
    return Response.json({ error: `Flight provider error: ${error.message}` }, { status });
  }
  return Response.json({ error: "Unexpected error while searching flights." }, { status: 500 });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const providerParse = providerChoiceSchema.safeParse(
    typeof body === "object" && body !== null ? (body as { provider?: unknown }).provider : undefined
  );
  if (!providerParse.success) {
    return Response.json({ error: "Invalid provider choice." }, { status: 400 });
  }

  const parsed = searchRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      {
        error: "Invalid search request.",
        issues: parsed.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      { status: 400 }
    );
  }

  const resolved = resolveProviders(providerParse.data);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: 400 });
  }

  // SEARCH_DRY_RUN: walk the same strategies against recording providers and
  // return the query plan instead of fares. Sequential so each provider's
  // stage labels stay its own.
  if (isDryRun()) {
    try {
      const plans: ProviderPlan[] = [];
      for (const provider of resolved.providers) {
        const recording = createRecordingProvider(provider);
        await runSearch(parsed.data, recording.provider);
        plans.push(recording.plan());
      }
      return Response.json(buildSearchPlan(plans));
    } catch (error) {
      return errorResponse(error);
    }
  }

  const settled = await Promise.allSettled(
    resolved.providers.map((provider) => runSearch(parsed.data, provider))
  );
  const successes: SearchResponse[] = [];
  const providerFailures: string[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status === "fulfilled") {
      successes.push(outcome.value);
    } else {
      const reason = outcome.reason instanceof Error ? outcome.reason.message : "unknown error";
      providerFailures.push(`${resolved.providers[index].name}: ${reason}`);
    }
  });

  if (successes.length === 0) {
    return errorResponse(settled.find((o) => o.status === "rejected")?.reason);
  }

  const result = mergeSearchResponses(successes);
  if (providerFailures.length > 0) {
    result.meta.partialFailures = [...result.meta.partialFailures, ...providerFailures];
  }
  return Response.json(result);
}
