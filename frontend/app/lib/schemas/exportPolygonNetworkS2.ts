import { z } from 'zod';

/**
 * POST /api/export_polygon_network_s2
 *
 * Request shape (sent by the workbench):
 *   { polygon: [[lng, lat], ...], filename, year, quarter, cloud, scale, buffer, region }
 *
 * Success response shape (truncated to what the UI uses):
 *   { status: "ok", links: {...}, files: {...}, summary: {...} }
 */
export const exportRequestSchema = z.object({
  polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
  filename: z.string().min(1),
  year: z.number().int(),
  quarter: z.string(),
  cloud: z.number().int(),
  scale: z.number().int().optional(),
  buffer: z.number().int().optional(),
  region: z.string(),
});
export type ExportRequest = z.infer<typeof exportRequestSchema>;

const sentinelMeanSchema = z.record(z.string(), z.number().nullable()).nullable().optional();

export const exportResponseSchema = z.object({
  status: z.literal('ok'),
  /** True when osmnx succeeded but the Sentinel-2 reduction failed (e.g.,
   *  Earth Engine not initialized, GEE timeout). The network outputs are
   *  still persisted and the road metrics are valid; only sentinel_mean
   *  will be null. The frontend renders this as a warning toast instead of
   *  the success toast. */
  degraded: z.boolean().optional(),
  degraded_reason: z.string().optional(),
  links: z
    .object({
      mapillary: z.string().url().optional(),
      google_street_view: z.string().url().optional(),
      centroid_lat: z.number().optional(),
      centroid_lon: z.number().optional(),
    })
    .optional(),
  files: z
    .object({
      network_pickle: z.string().optional(),
      edges_geojson: z.string().optional(),
      sentinel_stats_json: z.string().optional(),
    })
    .optional(),
  summary: z
    .object({
      node_count: z.number(),
      edge_count: z.number(),
      total_road_km: z.number(),
      year: z.number().optional(),
      quarter: z.string().optional(),
      cloud: z.number().optional(),
      scale_m: z.number().optional(),
      buffer_m: z.number().optional(),
      sentinel_mean: sentinelMeanSchema,
    })
    .optional(),
});
export type ExportResponse = z.infer<typeof exportResponseSchema>;
