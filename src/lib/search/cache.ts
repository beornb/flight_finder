import { prisma } from "../prisma";
import { isDryRun } from "./dry-run";
import type { FlightOption } from "./types";

const CACHE_TTL_MS = 15 * 60 * 1000;

// Cache failures must never break a search; fares are just re-fetched.
export async function getCachedOptions<T = FlightOption[]>(cacheKey: string): Promise<T | null> {
  // A dry run must report the whole plan, not just its cache misses.
  if (isDryRun()) return null;
  try {
    const entry = await prisma.apiCache.findUnique({ where: { cacheKey } });
    if (!entry || entry.expiresAt < new Date()) return null;
    return JSON.parse(entry.payload) as T;
  } catch {
    return null;
  }
}

export async function setCachedOptions<T>(cacheKey: string, options: T): Promise<void> {
  if (isDryRun()) return;
  try {
    const payload = JSON.stringify(options);
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    await prisma.apiCache.upsert({
      where: { cacheKey },
      create: { cacheKey, payload, expiresAt },
      update: { payload, expiresAt },
    });
  } catch {
    // ignore: caching is best-effort
  }
}
