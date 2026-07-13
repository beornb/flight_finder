# Flight Search App Builder Prompt

Build a production-ready MVP web application inside the **already initialized template project**.

The application is a **flight discovery and comparison tool** for users who are flexible on destination airport but care strongly about **lowest total price** and **no self-managed airport transfers**. The app should search across many combinations based on broad user criteria, aggregate the results, rank the options, and present the best trip plans clearly. Skyscanner offers direct-flight filtering and broad flight search UX patterns, while Amadeus exposes nonstop filtering and flight-shopping APIs suitable for building the search engine layer.[1][2][3]

## Core objective

Create an app that:

- Accepts flexible trip search inputs.
- Expands one user query into multiple real flight searches.
- Searches for the cheapest viable trip options.
- Avoids requiring the traveler to transfer themselves between different airports.
- Prefers direct flights when possible.
- Supports a fallback where separate tickets are allowed **only** if the connection happens through the **same airport** and does not require the traveler to move between airports on their own.[1][3]

## Required stack

Use this exact stack unless there is a strong technical reason not to:

- Next.js with App Router and TypeScript.
- Tailwind CSS.
- Prisma.
- SQLite with `better-sqlite3`.
- Route handlers in Next.js for backend endpoints.
- Server-side integration with **Amadeus as the primary search engine/provider**.

Use Amadeus as the main flight data provider because its flight APIs support shopping flows and nonstop filtering suitable for a first implementation.[2][4]

## Current project assumptions

Assume the project already exists and has been initialized.
Do **not** recreate the project from scratch.
Do **not** introduce a separate backend service unless absolutely necessary.
Keep the architecture simple and easy to extend.

Assume Prisma has been initialized but the database schema may still be empty.
If database persistence is useful, add only the minimum needed models.
Do not overengineer authentication, background jobs, or admin panels for the MVP.

## Product rules

The application must follow these rules:

1. The user starts from a single origin airport.
2. The user supplies an outbound date range.
3. The user supplies a destination country rather than a destination airport.
4. The user can enable a direct-flights-only option.
5. The user supplies a return-from country.
6. The user supplies a return-to country.
7. The app must search many combinations of airports and dates behind the scenes.
8. The app must rank results primarily by total cost, but must reject options that require self-managed airport transfer.
9. If no direct or acceptable single-itinerary return exists, the app may try a fallback using two separate flights **only when**:
   - the second leg departs from the **same airport** the traveler arrived at for the connection, and
   - the traveler does **not** need to move across a city or between airports themselves.[1][3]

## Required user inputs

Implement these search parameters in the UI and backend contract:

- `originAirport`: exact IATA airport code or selected airport object.
- `outboundDateFrom`: date.
- `outboundDateTo`: date.
- `destinationCountry`: ISO country code.
- `directOnly`: boolean.
- `returnDateFrom`: date.
- `returnDateTo`: date.
- `returnFromCountry`: ISO country code.
- `returnToCountry`: ISO country code.
- `adults`: integer, default 1.
- `cabinClass`: optional enum, default economy.
- `allowSeparateTicketsSameAirportOnly`: boolean, default true.
- `allowAirportTransferBySelf`: boolean, default false.

Also support the internal concept of candidate destination airports and candidate return airports, but do not force the user to choose them manually up front.[3][4]

## Search engine behavior

Use **Amadeus** as the search engine abstraction for the MVP.

Design the code so the app has a provider layer such as:

- `src/lib/providers/amadeus.ts`
- `src/lib/search/expand.ts`
- `src/lib/search/rank.ts`
- `src/app/api/search/route.ts`

The provider layer should:

- Resolve or accept airport and country inputs.
- Expand country-level searches into airport-level searches.
- Expand date ranges into multiple concrete search combinations.
- Call the provider APIs safely on the server side.
- Normalize all results into one internal trip-plan format.

The search engine should prefer direct or nonstop results where requested, since Amadeus supports a nonstop filter and flight-shopping flows.[2][4]

## Search flow

Implement the search logic in this order:

1. Generate outbound airport candidates inside the destination country.
2. Generate outbound date combinations between `outboundDateFrom` and `outboundDateTo`.
3. Search outbound trips from `originAirport` to all valid destination-country airports.
4. If `directOnly` is enabled, keep only direct or nonstop results.[1][2]
5. Generate return airport candidates from `returnFromCountry` to `returnToCountry`.
6. Generate return date combinations between `returnDateFrom` and `returnDateTo`.
7. Search acceptable returns.
8. Prefer:
   - single-itinerary direct returns,
   - then acceptable same-airport connection fallbacks,
   - reject self-transfer options.
9. Build complete trip plans and rank them.

## Trip-plan output model

Represent final search results as trip plans rather than raw flight rows.

At minimum support these internal result types:

- `DIRECT_ROUNDTRIP`
- `DIRECT_OPEN_JAW`
- `SAME_AIRPORT_SEPARATE_TICKETS`
- `REJECTED_SELF_TRANSFER`

Only show valid trip plans in the UI by default. Rejected options may be logged internally for debugging but should not be presented as recommended options.

## Ranking rules

Rank results using this priority order:

1. Reject any result that requires self-transfer between different airports.
2. Prefer direct itineraries.
3. Then prefer acceptable same-airport separate-ticket options.
4. Within each valid group, rank by lowest total price.
5. Then rank by lowest total travel time.
6. Then rank by fewer stops and lower connection risk.

This app is not just a fare browser. It is a **comfort-constrained cheapest-trip finder**.

## UI requirements

Build a clean MVP UI with:

- A search form on the main page.
- Country and airport inputs with clear labels.
- Date-range inputs for outbound and return.
- Toggles or checkboxes for direct-only and separate-ticket fallback behavior.
- A results list with strong visual hierarchy.
- A clear explanation of why a result is recommended.
- Price, total duration, number of stops, airport sequence, airline names if available, and whether the result is direct or uses same-airport separate tickets.
- Empty, loading, and error states.

For each result card, show:

- Total price.
- Outbound summary.
- Return summary.
- Trip type.
- Whether it is direct.
- Whether separate tickets are involved.
- Why it passed the “no self-transfer” rule.

## UX constraints

The user should never need to understand the internal search expansion.
The UI should feel simple even if the backend runs many searches.

Use plain language like:

- “Direct only”
- “No airport change required”
- “Separate tickets, same airport only”
- “Best value without self-transfer”

## Data and persistence

Use SQLite with `better-sqlite3` and Prisma only where persistence adds clear value.
Reasonable persisted entities may include:

- saved searches,
- cached airport metadata,
- cached country-airport mappings,
- cached normalized results.

If persistence is not yet necessary for the first version, keep the schema minimal and focus on the application structure first.

## API contract

Create a POST endpoint for search requests, for example:

- `POST /api/search`

Example request body:

```json
{
  "originAirport": "VIE",
  "outboundDateFrom": "2026-09-01",
  "outboundDateTo": "2026-09-10",
  "destinationCountry": "PT",
  "directOnly": true,
  "returnDateFrom": "2026-09-10",
  "returnDateTo": "2026-09-20",
  "returnFromCountry": "IT",
  "returnToCountry": "AT",
  "adults": 1,
  "cabinClass": "ECONOMY",
  "allowSeparateTicketsSameAirportOnly": true,
  "allowAirportTransferBySelf": false
}
```

Example response shape:

```json
{
  "searchSummary": {
    "originAirport": "VIE",
    "destinationCountry": "PT",
    "returnFromCountry": "IT",
    "returnToCountry": "AT",
    "directOnly": true
  },
  "results": [
    {
      "tripType": "DIRECT_OPEN_JAW",
      "totalPrice": 182.5,
      "currency": "EUR",
      "isDirect": true,
      "usesSeparateTickets": false,
      "requiresSelfTransfer": false,
      "score": 0.92,
      "whyRecommended": "Cheapest direct option with no airport transfer required.",
      "outbound": {
        "from": "VIE",
        "to": "LIS",
        "date": "2026-09-03"
      },
      "return": {
        "from": "FCO",
        "to": "VIE",
        "date": "2026-09-14"
      }
    }
  ]
}
```

## Code quality requirements

- Use TypeScript everywhere.
- Keep the provider layer isolated from UI code.
- Validate request payloads with Zod.
- Keep search expansion logic pure and testable.
- Normalize provider responses into app-specific types before ranking.
- Avoid tight coupling to Amadeus-specific response shapes outside the provider module.
- Use server-side environment variables for provider credentials.
- Add clear error handling for rate limits, no results, invalid inputs, and partial failures.

## Suggested file structure

Use or adapt this structure:

```text
src/
  app/
    page.tsx
    api/
      search/
        route.ts
  components/
    search-form.tsx
    results-list.tsx
    result-card.tsx
  lib/
    prisma.ts
    providers/
      amadeus.ts
    search/
      types.ts
      expand.ts
      rank.ts
      normalize.ts
    validation/
      search-schema.ts
  types/
    trip-plan.ts
prisma/
  schema.prisma
```

## Deliverables

Implement the app directly in the existing initialized project and provide:

1. The complete application code.
2. Any required Prisma schema changes.
3. Environment variable examples.
4. A short README section explaining how to run the app locally.
5. A clear note about what is mocked versus what is live.

If live Amadeus integration is not possible immediately, still build the full architecture and use a mocked provider that matches the final normalized output shape, but keep Amadeus as the intended production provider.[4][2]

## Important constraints

- Do not build a booking engine.
- Do not implement payments.
- Do not optimize for multi-user accounts yet.
- Do not build airline loyalty features.
- Do not require the traveler to manually coordinate airport transfers.
- Keep the MVP focused on finding the best cheap trip plans under the comfort constraint.

## Final instruction

Produce a polished MVP codebase from the initialized template project that is simple, extensible, and centered on **cheapest valid trip plans with no self-managed airport transfers**, using **Amadeus as the search engine abstraction** for the first implementation.[4][2][3]