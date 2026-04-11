import { z } from 'zod';

// GET /api/road_indices?osm_id=N → { osm_id, indices: [...] }
//
// Backend source: application/web/local_data.py:indices_for_osm_id_all_years()
// which slices the (osm_id, year, quarter) MultiIndex on the per-road parquet.
// Returns ALL years/quarters for the requested road, sorted most-recent first.
//
// Used by the workbench hover popup (filters client-side to current
// TimeSlider year) and the click-to-dock road inspector (shows all years).
// Empty list is success (the road exists but has no indices), NOT an error.
export const roadIndicesEntrySchema = z.object({
  year: z.number().int(),
  quarter: z.string(),
  ndvi: z.number().nullable(),
  ndmi: z.number().nullable(),
  ndbi: z.number().nullable(),
  ndwi: z.number().nullable(),
  bsi: z.number().nullable(),
});
export type RoadIndicesEntry = z.infer<typeof roadIndicesEntrySchema>;

export const roadIndicesSchema = z.object({
  osm_id: z.string(),
  indices: z.array(roadIndicesEntrySchema),
});
export type RoadIndices = z.infer<typeof roadIndicesSchema>;
