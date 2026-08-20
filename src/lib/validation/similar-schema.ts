import { z } from "zod";
import { excludedAirlinesSchema } from "./search-schema";

const iataAirport = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "Expected a 3-letter IATA airport code")
  .transform((value) => value.toUpperCase());

const route = z.object({
  origin: iataAirport,
  destination: iataAirport,
});

export const similarOptionsRequestSchema = z
  .object({
    outboundRoute: route,
    returnRoute: route.nullable(),
    outboundDateFrom: z.iso.date(),
    outboundDateTo: z.iso.date(),
    returnDateFrom: z.iso.date().optional(),
    returnDateTo: z.iso.date().optional(),
    adults: z.number().int().min(1).max(9).default(1),
    cabinClass: z.enum(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]).default("ECONOMY"),
    directOnly: z.boolean().default(false),
    checkedBagIncluded: z.boolean().default(false),
    maxLegHours: z.number().int().min(1).max(72).optional(),
    excludedAirlines: excludedAirlinesSchema,
  })
  .refine((data) => data.outboundDateFrom <= data.outboundDateTo, {
    message: "outboundDateFrom must not be after outboundDateTo",
    path: ["outboundDateTo"],
  })
  .refine(
    (data) => data.returnRoute === null || (data.returnDateFrom !== undefined && data.returnDateTo !== undefined),
    { message: "Return dates are required when a return route is given", path: ["returnDateFrom"] }
  );

export type SimilarOptionsRequest = z.infer<typeof similarOptionsRequestSchema>;
