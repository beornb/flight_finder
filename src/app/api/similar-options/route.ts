import { z } from "zod";
import { resolveProviders } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";
import { mergeSimilarOptionsResponses, runSimilarOptions } from "@/lib/search/engine";
import { similarOptionsRequestSchema } from "@/lib/validation/similar-schema";
import type { SimilarOptionsResponse } from "@/types/similar-options";

const providerChoiceSchema = z.enum(["mock", "ignav", "duffel", "serpapi", "all"]).optional();

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

  const parsed = similarOptionsRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid similar-options request." }, { status: 400 });
  }

  const resolved = resolveProviders(providerParse.data);
  if ("error" in resolved) {
    return Response.json({ error: resolved.error }, { status: 400 });
  }

  const settled = await Promise.allSettled(
    resolved.providers.map((provider) => runSimilarOptions(parsed.data, provider))
  );
  const successes = settled
    .filter((o): o is PromiseFulfilledResult<SimilarOptionsResponse> => o.status === "fulfilled")
    .map((o) => o.value);

  if (successes.length === 0) {
    const reason = settled.find((o) => o.status === "rejected")?.reason;
    if (reason instanceof ProviderError) {
      const status = reason.kind === "rate_limit" ? 429 : 502;
      return Response.json({ error: `Flight provider error: ${reason.message}` }, { status });
    }
    return Response.json({ error: "Unexpected error loading similar options." }, { status: 500 });
  }

  return Response.json(mergeSimilarOptionsResponses(successes));
}
