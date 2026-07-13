"use client";

import { useState } from "react";
import { kayakCompareUrl } from "@/lib/compare-link";
import { formatDate, formatDuration, formatPrice, formatTime } from "@/lib/format";
import type { ProviderChoice, SearchParams } from "@/lib/search/types";
import type { BookingLink, BookingLinksResponse } from "@/types/booking";
import type { SimilarOptionsResponse } from "@/types/similar-options";
import type { LegSummary, TripPlan } from "@/types/trip-plan";

const TRIP_TYPE_LABELS: Record<TripPlan["tripType"], string> = {
  DIRECT_ROUNDTRIP: "Round trip",
  DIRECT_OPEN_JAW: "Open jaw",
  OUTBOUND_ONLY: "One way",
  SAME_AIRPORT_SEPARATE_TICKETS: "Separate tickets, same airport",
  ROUND_TRIP_PLUS_POSITIONING: "Return fare + positioning flight",
  OPEN_JAW_SINGLE_TICKET: "Open jaw, single ticket",
  REJECTED_SELF_TRANSFER: "Self transfer",
};

function Badge({ tone, children }: { tone: "green" | "sky" | "amber" | "zinc"; children: React.ReactNode }) {
  const tones = {
    green: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
    sky: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
    amber: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
    zinc: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
  );
}

function LegRow({ title, leg }: { title: string; leg: LegSummary }) {
  return (
    <div className="flex flex-col gap-1 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-900">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{title}</span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">{formatDate(leg.date)}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {leg.airportSequence.join(" → ")}
        </span>
        <span className="text-sm text-zinc-600 dark:text-zinc-400">
          {formatTime(leg.departureAt)}–{formatTime(leg.arrivalAt)}
        </span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">{formatDuration(leg.durationMinutes)}</span>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {leg.isDirect ? "Direct" : `${leg.stops} stop${leg.stops === 1 ? "" : "s"}`}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        <span>{leg.airlines.join(", ")}</span>
        {leg.checkedBags != null && (
          <span>
            {leg.checkedBags === 0
              ? "No checked bag"
              : `${leg.checkedBags} checked bag${leg.checkedBags === 1 ? "" : "s"} included`}
          </span>
        )}
        {leg.usesSeparateTickets && leg.connectionAirport && (
          <span>
            Two tickets, both via {leg.connectionAirport}
            {leg.connectionMinutes !== undefined && ` (${formatDuration(leg.connectionMinutes)} between flights)`}
          </span>
        )}
      </div>
    </div>
  );
}

type Ticket = { id: string; label: string };

function planTickets(plan: TripPlan): Ticket[] {
  // Favorites saved by older versions may lack ticketIds.
  const tickets: Ticket[] = (plan.outbound.ticketIds ?? []).map((id) => ({ id, label: "Outbound" }));
  const returnLeg = plan.return;
  if (returnLeg) {
    (returnLeg.ticketIds ?? []).forEach((id, index, all) => {
      if (all.length === 1) {
        tickets.push({ id, label: "Return" });
        return;
      }
      const connection = returnLeg.connectionAirport ?? "";
      tickets.push({
        id,
        label:
          index === 0
            ? `Return ticket 1 — ${returnLeg.from} → ${connection}`
            : `Return ticket 2 — ${connection} → ${returnLeg.to}`,
      });
    });
  }
  // A round-trip fare appears as both the outbound and a return-half ticket;
  // collapse it into one entry.
  const merged: Ticket[] = [];
  for (const ticket of tickets) {
    const existing = merged.find((m) => m.id === ticket.id);
    if (existing) existing.label = "One ticket (outbound & return)";
    else merged.push({ ...ticket });
  }
  return merged;
}

function BookingLinkRow({ link }: { link: BookingLink }) {
  return (
    <li className="flex flex-wrap items-center gap-2 text-sm">
      <a
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-sky-600 underline-offset-2 hover:underline dark:text-sky-400"
      >
        {link.providerName}
      </a>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">
        {link.providerType === "airline" ? "Airline" : "Agency"}
        {link.fareName && ` · ${link.fareName}`}
        {link.price && ` · ${formatPrice(link.price.amount, link.price.currency)}`}
      </span>
    </li>
  );
}

type BookingLinksState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; links: Record<string, BookingLink[]>; partial: boolean };

type SimilarState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "loaded"; data: SimilarOptionsResponse };

function SimilarMatrix({ plan, data }: { plan: TripPlan; data: SimilarOptionsResponse }) {
  const currency = data.currency ?? plan.currency;

  if (!data.return) {
    return (
      <div className="flex flex-wrap gap-2">
        {data.outbound.map((cell) => (
          <span
            key={cell.date}
            className={`rounded-lg border px-3 py-1.5 text-sm ${
              cell.date === plan.outbound.date
                ? "border-sky-500 bg-sky-50 font-semibold dark:bg-sky-950"
                : "border-zinc-200 dark:border-zinc-700"
            }`}
          >
            {formatDate(cell.date)}:{" "}
            {cell.price === null ? "—" : formatPrice(cell.price, currency)}
          </span>
        ))}
      </div>
    );
  }

  const returnCells = data.return;
  let cheapest = Infinity;
  for (const out of data.outbound) {
    for (const ret of returnCells) {
      if (out.price !== null && ret.price !== null && ret.date >= out.date) {
        cheapest = Math.min(cheapest, out.price + ret.price);
      }
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead>
          <tr>
            <th className="p-2 text-left text-xs font-medium text-zinc-400">Out ↓ / Back →</th>
            {returnCells.map((ret) => (
              <th key={ret.date} className="p-2 text-right text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                {formatDate(ret.date)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.outbound.map((out) => (
            <tr key={out.date} className="border-t border-zinc-100 dark:border-zinc-800">
              <td className="p-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">
                {formatDate(out.date)}
              </td>
              {returnCells.map((ret) => {
                const valid = out.price !== null && ret.price !== null && ret.date >= out.date;
                const total = valid ? Math.round((out.price! + ret.price!) * 100) / 100 : null;
                const isCurrent = out.date === plan.outbound.date && ret.date === plan.return?.date;
                const isCheapest = total !== null && total === cheapest;
                return (
                  <td
                    key={ret.date}
                    className={`p-2 text-right tabular-nums ${
                      isCurrent ? "rounded-md ring-2 ring-sky-500" : ""
                    } ${
                      isCheapest
                        ? "font-semibold text-emerald-600 dark:text-emerald-400"
                        : "text-zinc-700 dark:text-zinc-300"
                    }`}
                  >
                    {total === null ? "—" : formatPrice(total, currency)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
        Same flights, other dates — cheapest combination in green, this trip outlined.
      </p>
    </div>
  );
}

type ResultCardProps = {
  plan: TripPlan;
  rank: number;
  searchContext: SearchParams | null;
  providerChoice?: ProviderChoice;
  excludedAirlineCodes?: string[];
  isFavorite: boolean;
  onToggleFavorite: (plan: TripPlan) => void;
};

export function ResultCard({
  plan,
  rank,
  searchContext,
  providerChoice,
  excludedAirlineCodes,
  isFavorite,
  onToggleFavorite,
}: ResultCardProps) {
  const [booking, setBooking] = useState<BookingLinksState>({ status: "idle" });
  const [similar, setSimilar] = useState<SimilarState>({ status: "idle" });
  const tickets = planTickets(plan);
  // Separate-ticket returns have no single "same flight" to re-date.
  const canShowSimilar = searchContext !== null && !plan.usesSeparateTickets;

  async function loadBookingLinks() {
    setBooking({ status: "loading" });
    try {
      const res = await fetch("/api/booking-links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticketIds: tickets.map((t) => t.id), adults: searchContext?.adults ?? 1 }),
      });
      if (!res.ok) {
        setBooking({ status: "error", message: "Could not load booking links. Please try again." });
        return;
      }
      const data = (await res.json()) as BookingLinksResponse;
      setBooking({ status: "loaded", links: data.links, partial: data.failures.length > 0 });
    } catch {
      setBooking({ status: "error", message: "Could not reach the booking service." });
    }
  }

  async function loadSimilarOptions() {
    if (!searchContext) return;
    setSimilar({ status: "loading" });
    try {
      const res = await fetch("/api/similar-options", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          outboundRoute: { origin: plan.outbound.from, destination: plan.outbound.to },
          returnRoute: plan.return ? { origin: plan.return.from, destination: plan.return.to } : null,
          outboundDateFrom: searchContext.outboundDateFrom,
          outboundDateTo: searchContext.outboundDateTo,
          returnDateFrom: searchContext.returnDateFrom,
          returnDateTo: searchContext.returnDateTo,
          adults: searchContext.adults,
          cabinClass: searchContext.cabinClass,
          directOnly: searchContext.directOnly,
          checkedBagIncluded: searchContext.checkedBagIncluded,
          excludedAirlines: excludedAirlineCodes?.length ? excludedAirlineCodes : undefined,
          provider: providerChoice,
        }),
      });
      if (!res.ok) {
        setSimilar({ status: "error", message: "Could not load similar options. Please try again." });
        return;
      }
      setSimilar({ status: "loaded", data: (await res.json()) as SimilarOptionsResponse });
    } catch {
      setSimilar({ status: "error", message: "Could not reach the search service." });
    }
  }

  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleFavorite(plan)}
            aria-label={isFavorite ? "Remove from favorites" : "Save to favorites"}
            aria-pressed={isFavorite}
            className={`text-xl leading-none transition-colors ${
              isFavorite ? "text-amber-400 hover:text-amber-500" : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"
            }`}
          >
            {isFavorite ? "★" : "☆"}
          </button>
          {rank === 1 && <Badge tone="green">Best value</Badge>}
          <Badge tone="zinc">{TRIP_TYPE_LABELS[plan.tripType]}</Badge>
          {plan.isDirect && <Badge tone="sky">Direct only</Badge>}
          {plan.requiresSelfTransfer ? (
            <Badge tone="amber">Self airport transfer</Badge>
          ) : plan.usesSeparateTickets ? (
            <Badge tone="amber">Separate tickets, same airport only</Badge>
          ) : (
            <Badge tone="green">No airport change required</Badge>
          )}
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            {formatPrice(plan.totalPrice, plan.currency)}
          </p>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {formatDuration(plan.totalDurationMinutes)} in the air · score {plan.score.toFixed(2)}
          </p>
        </div>
      </div>

      <div className={`grid grid-cols-1 gap-3 ${plan.return ? "md:grid-cols-2" : ""}`}>
        <LegRow title="Outbound" leg={plan.outbound} />
        {plan.return && <LegRow title="Return" leg={plan.return} />}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{plan.whyRecommended}</p>
        <div className="flex gap-2">
          <a
            href={kayakCompareUrl(plan, searchContext?.adults ?? 1)}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-zinc-400 px-3 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
          >
            Compare on Kayak
          </a>
          {canShowSimilar && similar.status !== "loaded" && (
            <button
              type="button"
              onClick={loadSimilarOptions}
              disabled={similar.status === "loading"}
              className="rounded-md border border-zinc-400 px-3 py-1 text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-60 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-900"
            >
              {similar.status === "loading" ? "Loading…" : "Similar options"}
            </button>
          )}
          {booking.status !== "loaded" && tickets.length > 0 && (
            <button
              type="button"
              onClick={loadBookingLinks}
              disabled={booking.status === "loading"}
              className="rounded-md border border-sky-600 px-3 py-1 text-xs font-semibold text-sky-600 hover:bg-sky-50 disabled:opacity-60 dark:border-sky-500 dark:text-sky-400 dark:hover:bg-sky-950"
            >
              {booking.status === "loading" ? "Loading…" : "Booking links"}
            </button>
          )}
        </div>
      </div>

      {booking.status === "error" && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{booking.message}</p>
      )}
      {similar.status === "error" && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">{similar.message}</p>
      )}

      {similar.status === "loaded" && (
        <div className="mt-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Similar options — {plan.outbound.from} → {plan.outbound.to}
            {plan.return && ` · ${plan.return.from} → ${plan.return.to}`}
          </p>
          <SimilarMatrix plan={plan} data={similar.data} />
        </div>
      )}

      {booking.status === "loaded" && (
        <div className="mt-3 space-y-3 rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
          {booking.partial && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              Some booking links could not be loaded.
            </p>
          )}
          {tickets.map((ticket) => {
            const links = booking.links[ticket.id] ?? [];
            return (
              <div key={ticket.id}>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {ticket.label}
                </p>
                {links.length === 0 ? (
                  <p className="text-xs text-zinc-500 dark:text-zinc-400">
                    No booking links available for this ticket.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {links.map((link) => (
                      <BookingLinkRow key={link.url} link={link} />
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
