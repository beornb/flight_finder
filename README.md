# Flight Finder

A flight discovery and comparison tool for travelers who are flexible on destination airport and
care about the **lowest total price**.

One search (origin airport, flexible destination, return-from/return-to, date ranges) is expanded
into many concrete airport + date searches across multiple fare strategies behind the scenes.
Results are normalized into trip plans and ranked by directness, then price, then travel time;
options requiring a self-managed airport change are clearly flagged.

## Running locally

```bash
npm install
cp .env.example .env        # add provider keys as needed
npx prisma migrate dev      # creates prisma/dev.db and generates the client
npm run dev                 # http://localhost:3097
```

Run the unit tests (search expansion, ranking, normalization, merging) with:

```bash
npm test
```

## Search inputs

- **Locations** — the origin is a single airport; "Fly to", "Return from", and "Return to" each
  accept a whole country, one exact airport, or a city with all its airports (London → LHR, LGW,
  STN, LTN; Tokyo → HND, NRT; extend `METRO_AREAS` in `src/lib/data/airports.ts`). Unknown IATA
  codes can be typed directly — providers know more airports than the local dataset.
- **Date ranges** for outbound and return; **Outbound only** switches to one-way trips.
- **Toggles** — Direct only, Checked bag included (drops fares explicitly known to be bag-less,
  keeps unknowns), Separate tickets same airport only (enables the hub-combo and positioning
  strategies), Thorough search (see below).
- **Flight data dropdown** — pick a provider or **All providers** (see Providers).
- Form values persist in localStorage and restore on the next visit (stale dates reset); the
  **Reset** button restores defaults.

## Fare strategies

Every search runs all applicable strategies and ranks the plans together:

1. **Two one-way tickets** — origin → each destination candidate, and return-from → return-to,
   across the date grid (this is the baseline open-jaw/round-trip shape).
2. **Same-airport separate tickets** — two nonstop tickets connecting through the same hub with a
   3–12 h buffer; can undercut single tickets.
3. **Round-trip fares** (when the trip ends back at the origin) — as complete single-ticket round
   trips when the destination doubles as the return-from airport, and as **nested returns**: a
   cheap origin⇄destination return whose inbound half is reached via a separate positioning
   flight connecting at the same airport.
4. **Single-ticket multi-city (open jaw)** — with a multi-city capable provider (Duffel, SerpApi),
   both legs priced together as one booking; airline fare construction often makes these far
   cheaper than separate one-ways.

Ranking: direct single tickets → single tickets with stops → separate tickets; within each group
by price, then duration, then stops. The top 20 plans are shown, with at least the best 3 of each
trip type kept visible. Anything requiring a self-managed airport change is flagged with a warning
badge rather than hidden.

Date ranges are sampled to 4 dates and country slots to 4 airports by default; the **Thorough
search** toggle lifts these (every day up to 14, more airports, wider round-trip/multi-city
combos) at the cost of many more provider requests.

## Results tooling

- **Airline filter** — every airline in the results with its cheapest total price; unchecking
  hides plans involving it. The 🚫 button adds an airline to a **permanent exclusion list**
  (localStorage) that is pushed down to providers on every future search and manageable from a
  chips panel.
- **Similar options** — a per-plan date matrix showing the same routes across all outbound ×
  return date combinations (served almost entirely from cache right after a search).
- **Booking links** — fetched on demand per ticket, routed to the provider that priced it
  (Ignav returns airline/agency deep links; Duffel and SerpApi have none).
- **Compare on Kayak** — a prefilled Kayak multi-city link per plan for one-click cross-checking.
- **Saved searches & favorites** — stored in SQLite; a favorite (★) always belongs to a saved
  search (favoriting auto-saves it, deleting the search removes its favorites). Favorites recall
  the full stored trip snapshot ("Details") without re-searching.

## Providers

The app talks to flight data through a provider-agnostic interface
(`src/lib/providers/types.ts`); everything downstream is provider-independent. The "Flight data"
dropdown picks per search; **All providers** searches every configured live provider in parallel,
dedupes structurally identical flights (keeping the cheaper offer), and re-ranks the merged
results. `FLIGHT_PROVIDER` in `.env` only sets the fallback when a request names no provider.

- **Ignav** (`IGNAV_API_KEY`, [ignav.com](https://ignav.com)) — one-way and round-trip fares with
  booking links, billed per request. Direct-only (`max_stops`), airline exclusions
  (`airlines_exclude`), and the bag rule (`min_checked_bags`) push down to the API;
  `IGNAV_MARKET` controls currency/locale. Upstream 424s are retried once.
- **Duffel** (`DUFFEL_API_KEY`, [duffel.com](https://duffel.com)) — one-way, round-trip, and true
  multi-city offers; rich baggage data; test-mode keys return free synthetic offers. Airline
  exclusions and the bag rule are applied locally. No external booking links (Duffel books via
  its orders API).
- **Google Flights via SerpApi** (`SERP_API_KEY`, [serpapi.com](https://serpapi.com)) — one-way,
  round-trip, and multi-city, billed per search with `deep_search` accuracy. Origin/destination
  accept comma-separated airport lists, so the engine batches all candidate airports into single
  searches. Two-slice fares use Google's token flow pairing the top 3 first legs (1 + up to 3
  searches per query). No baggage data, no booking links.
- **Mock** — with no keys (or provider "Mock"), a deterministic offline generator exercises every
  strategy, including self-transfer traps and discounted round-trip/multi-city fares.

Partial failures (one provider or route failing) are reported in the UI instead of failing the
whole search. Provider responses are cached in SQLite for 15 minutes, keyed per provider and
query, to keep repeat searches fast and request costs down.

## Architecture

```
src/
  app/
    page.tsx                     landing page (server component)
    api/
      search/route.ts            POST /api/search — validate, fan out, merge, respond
      similar-options/route.ts   POST — per-route date/price matrix
      booking-links/route.ts     POST — per-ticket booking links (routed by ticket prefix)
      saved-searches/route.ts    GET/POST (+ [id] DELETE)
      favorites/route.ts         POST (+ [id] DELETE)
  components/                    client components: form, location combobox, results,
                                 result cards, saved searches, excluded airlines
  lib/
    prisma.ts                    Prisma client (better-sqlite3 adapter)
    data/airports.ts             static airports, metro areas, fallback hubs
    compare-link.ts              Kayak multi-city deep links
    saved/                       saved-search store + canonical params serialization
    providers/                   ignav, duffel, serpapi, mock behind one interface
    search/
      expand.ts                  pure: slots/date ranges → queries, caps, airport batching
      normalize.ts               pure: Ignav itineraries → internal FlightOption
      rank.ts                    pure: plan assembly (all strategies), ranking, scoring
      similar.ts                 pure: cheapest price per date
      airline-filter.ts          pure: airline stats + filtering
      engine.ts                  orchestration: run/cache queries, strategies, merging
    validation/                  Zod request schemas
  types/                         public API response types
prisma/schema.prisma             api_cache, saved_search, saved_result
```

### API

- `POST /api/search` — request contract in `src/lib/validation/search-schema.ts`, response shape
  in `src/types/trip-plan.ts`. Optional top-level `provider` and `excludedAirlines` ride alongside
  the search params without affecting saved-search identity.
- `POST /api/similar-options`, `POST /api/booking-links` — support the result-card tooling.
- `GET/POST /api/saved-searches`, `DELETE /api/saved-searches/:id`, `POST /api/favorites`,
  `DELETE /api/favorites/:id` — persistence.
