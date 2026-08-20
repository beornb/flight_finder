import path from "node:path";
import fs from "node:fs";
import { createDuffelProvider } from "./providers/duffel";
import { createIgnavProvider } from "./providers/ignav";
import { createMockProvider } from "./providers/mock";
import { createSerpApiProvider } from "./providers/serpapi";
import { ProviderError, type FlightProvider } from "./providers/types";
import { isDryRun } from "./search/dry-run";
import type { FlightQuery } from "./search/types";
import { prisma } from "./prisma";

export type ApiTestStatus =
  | "OK"
  | "SKIPPED"
  | "INVALID_KEY"
  | "EXPIRED_CREDITS"
  | "RATE_LIMITED"
  | "NOT_CONFIGURED"
  | "ERROR";

export type ApiTestResult = {
  provider: string;
  keyName: string;
  keyMasked: string | null;
  status: ApiTestStatus;
  message: string;
  optionsFound: number;
  durationMs: number;
  details?: Record<string, unknown>;
};

export type TestOptions = {
  origin?: string;
  destination?: string;
  daysInFuture?: number;
  filterProvider?: string;
};

/**
 * Helper to mask sensitive API keys for display
 */
export function maskKey(key: string | undefined): string | null {
  if (!key) return null;
  if (key.length <= 8) return "********";
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Generate a dynamic future date string (YYYY-MM-DD)
 */
export function getSampleDate(daysInFuture = 30): string {
  const d = new Date();
  d.setDate(d.getDate() + daysInFuture);
  return d.toISOString().split("T")[0];
}

/**
 * Create a standard test query
 */
export function createSampleQuery(options: TestOptions = {}): FlightQuery {
  const origin = options.origin ?? "VIE";
  const destination = options.destination ?? "LHR";
  const date = getSampleDate(options.daysInFuture ?? 30);

  return {
    origin,
    destination,
    date,
    adults: 1,
    cabinClass: "ECONOMY",
    nonStopOnly: false,
    checkedBagIncluded: false,
  };
}

/**
 * Test a single flight provider with a sample query
 */
export async function testProviderKey(
  name: string,
  keyEnvName: string,
  createFn: (apiKey: string) => FlightProvider,
  options: TestOptions = {}
): Promise<ApiTestResult> {
  const apiKey = process.env[keyEnvName];
  if (!apiKey || apiKey.trim() === "") {
    return {
      provider: name,
      keyName: keyEnvName,
      keyMasked: null,
      status: "NOT_CONFIGURED",
      message: `Environment variable ${keyEnvName} is missing or empty.`,
      optionsFound: 0,
      durationMs: 0,
    };
  }

  const maskedKey = maskKey(apiKey);
  const provider = createFn(apiKey);
  const sampleQuery = createSampleQuery(options);

  // A live probe is the only way to validate a key, so SEARCH_DRY_RUN turns
  // this check off rather than reporting a result it never verified.
  if (isDryRun()) {
    return {
      provider: name,
      keyName: keyEnvName,
      keyMasked: maskedKey,
      status: "SKIPPED",
      message: "SEARCH_DRY_RUN is on; no request was made.",
      optionsFound: 0,
      durationMs: 0,
      details: { sampleQuery: { ...sampleQuery } },
    };
  }

  const startTime = Date.now();

  try {
    const results = await provider.searchOneWay(sampleQuery);
    const durationMs = Date.now() - startTime;

    return {
      provider: name,
      keyName: keyEnvName,
      keyMasked: maskedKey,
      status: "OK",
      message: `Successfully fetched ${results.length} flight option(s). Key is active.`,
      optionsFound: results.length,
      durationMs,
    };
  } catch (error: unknown) {
    const durationMs = Date.now() - startTime;
    let status: ApiTestStatus = "ERROR";
    let message = error instanceof Error ? error.message : String(error);

    if (error instanceof ProviderError) {
      if (error.kind === "auth") {
        status = "INVALID_KEY";
        message = `Authentication failed: ${error.message}. Check if key is correct/expired.`;
      } else if (error.kind === "rate_limit") {
        status = "EXPIRED_CREDITS";
        message = `Rate limit or credit quota exceeded: ${error.message}. Check account balance.`;
      } else if (error.kind === "unavailable") {
        status = "ERROR";
        message = `Provider API unavailable: ${error.message}`;
      } else if (error.kind === "bad_request") {
        status = "ERROR";
        message = `Bad query request: ${error.message}`;
      }
    } else {
      const lower = message.toLowerCase();
      if (lower.includes("unauthorized") || lower.includes("invalid api key") || lower.includes("forbidden") || lower.includes("401") || lower.includes("403")) {
        status = "INVALID_KEY";
      } else if (
        lower.includes("quota") ||
        lower.includes("out of search") ||
        lower.includes("credit") ||
        lower.includes("limit") ||
        lower.includes("429") ||
        lower.includes("402")
      ) {
        status = "EXPIRED_CREDITS";
      }
    }

    return {
      provider: name,
      keyName: keyEnvName,
      keyMasked: maskedKey,
      status,
      message,
      optionsFound: 0,
      durationMs,
    };
  }
}

/**
 * Test Database Connection (compatible with both Bun & Node)
 */
export async function testDatabase(): Promise<ApiTestResult> {
  const startTime = Date.now();
  const dbUrl = process.env.DATABASE_URL ?? "file:./prisma/dev.db";
  const maskedKey = maskKey(dbUrl);

  try {
    const relativePath = dbUrl.replace(/^file:/, "");
    const absolutePath = path.resolve(process.cwd(), relativePath);

    if (!fs.existsSync(absolutePath)) {
      return {
        provider: "Database (Prisma/SQLite)",
        keyName: "DATABASE_URL",
        keyMasked: maskedKey,
        status: "ERROR",
        message: `Database file does not exist at ${absolutePath}`,
        optionsFound: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // Bun native sqlite check when better-sqlite3 native addon is bypassed
    if (typeof (globalThis as unknown as { Bun: unknown }).Bun !== "undefined" && dbUrl.startsWith("file:")) {
      // @ts-expect-error bun:sqlite is runtime specific to Bun
      const { Database } = await import("bun:sqlite");
      const db = new Database(absolutePath);
      db.query("SELECT 1").get();
      db.close();
    } else {
      await prisma.$queryRaw`SELECT 1`;
    }

    const durationMs = Date.now() - startTime;
    return {
      provider: "Database (Prisma/SQLite)",
      keyName: "DATABASE_URL",
      keyMasked: maskedKey,
      status: "OK",
      message: "Database connection successful.",
      optionsFound: 1,
      durationMs,
    };
  } catch (err: unknown) {
    const durationMs = Date.now() - startTime;
    return {
      provider: "Database (Prisma/SQLite)",
      keyName: "DATABASE_URL",
      keyMasked: maskedKey,
      status: "ERROR",
      message: `Database connection error: ${err instanceof Error ? err.message : String(err)}`,
      optionsFound: 0,
      durationMs,
    };
  }
}

/**
 * Run tests for specified or all API keys
 */
export async function testAllApiKeys(options: TestOptions = {}): Promise<ApiTestResult[]> {
  const results: ApiTestResult[] = [];
  const filter = options.filterProvider?.toLowerCase();

  const shouldRun = (name: string) => {
    if (!filter || filter === "all") return true;
    return name.toLowerCase().includes(filter);
  };

  // 1. Ignav API
  if (shouldRun("ignav")) {
    results.push(
      await testProviderKey(
        "Ignav",
        "IGNAV_API_KEY",
        (key) => createIgnavProvider({ apiKey: key, market: process.env.IGNAV_MARKET ?? "AT" }),
        options
      )
    );
  }

  // 2. Duffel API
  if (shouldRun("duffel")) {
    results.push(
      await testProviderKey(
        "Duffel",
        "DUFFEL_API_KEY",
        (key) => createDuffelProvider({ apiKey: key }),
        options
      )
    );
  }

  // 3. SerpApi API
  if (shouldRun("serpapi")) {
    results.push(
      await testProviderKey(
        "SerpApi",
        "SERP_API_KEY",
        (key) => createSerpApiProvider({ apiKey: key }),
        options
      )
    );
  }

  // 4. Mock Provider (Reference/Baseline)
  if (shouldRun("mock")) {
    const mockStartTime = Date.now();
    try {
      const mock = createMockProvider();
      const mockResults = await mock.searchOneWay(createSampleQuery(options));
      results.push({
        provider: "Mock Provider",
        keyName: "FLIGHT_PROVIDER",
        keyMasked: "N/A (Built-in)",
        status: "OK",
        message: `Returned ${mockResults.length} synthetic flight options.`,
        optionsFound: mockResults.length,
        durationMs: Date.now() - mockStartTime,
      });
    } catch (err: unknown) {
      results.push({
        provider: "Mock Provider",
        keyName: "FLIGHT_PROVIDER",
        keyMasked: "N/A",
        status: "ERROR",
        message: String(err),
        optionsFound: 0,
        durationMs: Date.now() - mockStartTime,
      });
    }
  }

  // 5. Database Connection
  if (shouldRun("database") || shouldRun("db") || shouldRun("prisma")) {
    results.push(await testDatabase());
  }

  return results;
}
