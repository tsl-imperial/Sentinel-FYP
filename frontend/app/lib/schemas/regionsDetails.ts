import { z } from 'zod';

// GET /api/regions/details
//
// Per-region summaries plus the canonical road class palette + render order.
// Shipping the palette in the same payload keeps the frontend free of any
// hardcoded color or class-list copy.

export const regionSummarySchema = z.object({
  name: z.string(),
  road_km: z.number(),
  edge_count: z.number().int(),
  area_km2: z.number(),
  class_composition: z.record(z.string(), z.number()),
});

export const classPaletteSchema = z.object({
  order: z.array(z.string()),
  colors: z.record(z.string(), z.string()),
});

export const regionsDetailsSchema = z.object({
  regions: z.array(regionSummarySchema),
  class_palette: classPaletteSchema,
});

export type RegionSummary = z.infer<typeof regionSummarySchema>;
export type ClassPalette = z.infer<typeof classPaletteSchema>;
export type RegionsDetails = z.infer<typeof regionsDetailsSchema>;
