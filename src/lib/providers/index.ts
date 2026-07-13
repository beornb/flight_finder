import type { ProviderChoice } from "../search/types";
import { createDuffelProvider } from "./duffel";
import { createIgnavProvider } from "./ignav";
import { createMockProvider } from "./mock";
import { createSerpApiProvider } from "./serpapi";
import type { FlightProvider } from "./types";

function ignavIfConfigured(): FlightProvider | null {
  const apiKey = process.env.IGNAV_API_KEY;
  if (!apiKey) return null;
  return createIgnavProvider({ apiKey, market: process.env.IGNAV_MARKET ?? "AT" });
}

function duffelIfConfigured(): FlightProvider | null {
  const apiKey = process.env.DUFFEL_API_KEY;
  if (!apiKey) return null;
  return createDuffelProvider({ apiKey });
}

function serpApiIfConfigured(): FlightProvider | null {
  const apiKey = process.env.SERP_API_KEY;
  if (!apiKey) return null;
  return createSerpApiProvider({ apiKey });
}

// Legacy env-based selection, used when a request names no provider:
// FLIGHT_PROVIDER=ignav|duffel|mock, else Ignav → Duffel → mock.
export function getFlightProvider(): FlightProvider {
  const requested = process.env.FLIGHT_PROVIDER;
  if (requested === "mock") return createMockProvider();
  if (requested === "duffel") {
    const duffel = duffelIfConfigured();
    if (duffel) return duffel;
  }
  if (requested === "ignav") {
    const ignav = ignavIfConfigured();
    if (ignav) return ignav;
  }
  return ignavIfConfigured() ?? duffelIfConfigured() ?? createMockProvider();
}

export type ResolvedProviders = { providers: FlightProvider[] } | { error: string };

// Resolve a request's provider choice. "all" means every configured live
// provider, falling back to the mock when none are configured.
export function resolveProviders(choice: ProviderChoice | undefined): ResolvedProviders {
  if (choice === undefined) return { providers: [getFlightProvider()] };
  if (choice === "mock") return { providers: [createMockProvider()] };
  if (choice === "ignav") {
    const ignav = ignavIfConfigured();
    return ignav ? { providers: [ignav] } : { error: "Ignav is not configured (IGNAV_API_KEY missing)." };
  }
  if (choice === "duffel") {
    const duffel = duffelIfConfigured();
    return duffel
      ? { providers: [duffel] }
      : { error: "Duffel is not configured (DUFFEL_API_KEY missing)." };
  }
  if (choice === "serpapi") {
    const serpapi = serpApiIfConfigured();
    return serpapi
      ? { providers: [serpapi] }
      : { error: "SerpApi is not configured (SERP_API_KEY missing)." };
  }
  const live = [ignavIfConfigured(), duffelIfConfigured(), serpApiIfConfigured()].filter(
    (provider): provider is FlightProvider => provider !== null
  );
  return { providers: live.length > 0 ? live : [createMockProvider()] };
}

// Ticket ids are provider-prefixed (ignav-, duffel-, mock-), so booking links
// always come from the provider that produced the fare, regardless of which
// provider the user currently searches with.
export function resolveProviderForTicket(ticketId: string): FlightProvider | null {
  if (ticketId.startsWith("mock-")) return createMockProvider();
  if (ticketId.startsWith("ignav-")) return ignavIfConfigured();
  if (ticketId.startsWith("duffel-")) return duffelIfConfigured();
  if (ticketId.startsWith("serpapi-")) return serpApiIfConfigured();
  return null;
}
