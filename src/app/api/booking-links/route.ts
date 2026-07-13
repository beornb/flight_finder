import { z } from "zod";
import { resolveProviderForTicket } from "@/lib/providers";
import { ProviderError } from "@/lib/providers/types";
import type { BookingLink, BookingLinksResponse } from "@/types/booking";

const bookingLinksRequestSchema = z.object({
  // A trip plan spans at most three tickets (outbound + two separate returns).
  ticketIds: z.array(z.string().min(1)).min(1).max(3),
  adults: z.number().int().min(1).max(9).default(1),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  const parsed = bookingLinksRequestSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid booking links request." }, { status: 400 });
  }

  const links: Record<string, BookingLink[]> = {};
  const failures: string[] = [];

  try {
    await Promise.all(
      [...new Set(parsed.data.ticketIds)].map(async (ticketId) => {
        // The ticket's prefix identifies the provider that priced it.
        const provider = resolveProviderForTicket(ticketId);
        if (!provider) {
          links[ticketId] = [];
          failures.push(`no configured provider for ticket ${ticketId}`);
          return;
        }
        try {
          links[ticketId] = await provider.getBookingLinks(ticketId, { adults: parsed.data.adults });
        } catch (error) {
          if (error instanceof ProviderError && error.kind === "auth") throw error;
          links[ticketId] = [];
          failures.push(error instanceof Error ? error.message : "unknown provider error");
        }
      })
    );
  } catch (error) {
    if (error instanceof ProviderError) {
      return Response.json({ error: `Flight provider error: ${error.message}` }, { status: 502 });
    }
    return Response.json({ error: "Unexpected error fetching booking links." }, { status: 500 });
  }

  const response: BookingLinksResponse = { links, failures: [...new Set(failures)] };
  return Response.json(response);
}
