import { z } from "zod";

// Favorited plans are stored as snapshots, so only the fields the app relies
// on are validated strictly; the rest of the plan passes through untouched.
const legSchema = z.looseObject({
  from: z.string(),
  to: z.string(),
  date: z.string(),
  price: z.number(),
  currency: z.string(),
});

export const tripPlanSnapshotSchema = z.looseObject({
  id: z.string().min(1),
  tripType: z.string(),
  totalPrice: z.number(),
  currency: z.string(),
  isDirect: z.boolean(),
  usesSeparateTickets: z.boolean(),
  requiresSelfTransfer: z.boolean(),
  whyRecommended: z.string(),
  outbound: legSchema,
  return: legSchema.nullable(),
});

export const idParamSchema = z.coerce.number().int().positive();
