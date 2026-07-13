import { z } from "zod";
import type { SearchParams } from "../search/types";

const iataAirport = z
  .string()
  .regex(/^[A-Za-z]{3}$/, "Expected a 3-letter IATA airport code")
  .transform((value) => value.toUpperCase());

const isoCountry = z
  .string()
  .regex(/^[A-Za-z]{2}$/, "Expected a 2-letter ISO country code")
  .transform((value) => value.toUpperCase());

// IATA carrier designators are two characters, letters or digits (U2, W6).
export const excludedAirlinesSchema = z
  .array(
    z
      .string()
      .regex(/^[A-Za-z0-9]{2}$/, "Expected a 2-character airline code")
      .transform((value) => value.toUpperCase())
  )
  .max(50)
  .optional();

type SlotFields = {
  country: "destinationCountry" | "returnFromCountry" | "returnToCountry";
  airport: "destinationAirport" | "returnFromAirport" | "returnToAirport";
};

const DESTINATION_SLOT: SlotFields = { country: "destinationCountry", airport: "destinationAirport" };
const RETURN_SLOTS: SlotFields[] = [
  { country: "returnFromCountry", airport: "returnFromAirport" },
  { country: "returnToCountry", airport: "returnToAirport" },
];

export const searchRequestSchema = z
  .object({
    originAirport: iataAirport,
    outboundDateFrom: z.iso.date(),
    outboundDateTo: z.iso.date(),
    destinationCountry: isoCountry.optional(),
    destinationAirport: iataAirport.optional(),
    directOnly: z.boolean().default(false),
    outboundOnly: z.boolean().default(false),
    returnDateFrom: z.iso.date().optional(),
    returnDateTo: z.iso.date().optional(),
    returnFromCountry: isoCountry.optional(),
    returnFromAirport: iataAirport.optional(),
    returnToCountry: isoCountry.optional(),
    returnToAirport: iataAirport.optional(),
    adults: z.number().int().min(1).max(9).default(1),
    cabinClass: z.enum(["ECONOMY", "PREMIUM_ECONOMY", "BUSINESS", "FIRST"]).default("ECONOMY"),
    thorough: z.boolean().default(false),
    checkedBagIncluded: z.boolean().default(false),
    allowSeparateTicketsSameAirportOnly: z.boolean().default(true),
    excludedAirlines: excludedAirlinesSchema,
  })
  .refine((data) => data.outboundDateFrom <= data.outboundDateTo, {
    message: "outboundDateFrom must not be after outboundDateTo",
    path: ["outboundDateTo"],
  })
  .superRefine((data, ctx) => {
    function checkSlot(slot: SlotFields, required: boolean) {
      const hasCountry = data[slot.country] !== undefined;
      const hasAirport = data[slot.airport] !== undefined;
      if (hasCountry && hasAirport) {
        ctx.addIssue({
          code: "custom",
          message: `Provide either ${slot.country} or ${slot.airport}, not both`,
          path: [slot.airport],
        });
      }
      if (required && !hasCountry && !hasAirport) {
        ctx.addIssue({
          code: "custom",
          message: `Either ${slot.country} or ${slot.airport} is required`,
          path: [slot.country],
        });
      }
    }

    checkSlot(DESTINATION_SLOT, true);
    for (const slot of RETURN_SLOTS) checkSlot(slot, !data.outboundOnly);

    if (data.outboundOnly) return;
    for (const field of ["returnDateFrom", "returnDateTo"] as const) {
      if (data[field] === undefined) {
        ctx.addIssue({
          code: "custom",
          message: `${field} is required unless outboundOnly is true`,
          path: [field],
        });
      }
    }
    if (data.returnDateFrom && data.returnDateTo && data.returnDateFrom > data.returnDateTo) {
      ctx.addIssue({
        code: "custom",
        message: "returnDateFrom must not be after returnDateTo",
        path: ["returnDateTo"],
      });
    }
    if (data.returnDateTo && data.outboundDateFrom > data.returnDateTo) {
      ctx.addIssue({
        code: "custom",
        message: "The return window must not end before the outbound window starts",
        path: ["returnDateFrom"],
      });
    }
  })
  // Drop return fields on one-way searches so identical searches serialize
  // identically regardless of leftover form values.
  .transform((data) =>
    data.outboundOnly
      ? {
          ...data,
          returnDateFrom: undefined,
          returnDateTo: undefined,
          returnFromCountry: undefined,
          returnFromAirport: undefined,
          returnToCountry: undefined,
          returnToAirport: undefined,
          allowSeparateTicketsSameAirportOnly: false,
        }
      : data
  );

export type SearchRequest = z.infer<typeof searchRequestSchema>;

// z.infer already matches SearchParams; this keeps the two in sync at compile time.
const _typecheck: SearchParams = {} as SearchRequest;
void _typecheck;
