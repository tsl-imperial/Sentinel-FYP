import { z } from 'zod';

// GET /api/road_indices?osm_id=N → { osm_id, indices: [...] }
//
// Backend source: backend/local_data.py:indices_for_osm_id_all_years()
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

export const roadPredictionSchema = z.object({
  pred_surface: z.enum(['paved', 'unpaved']).nullable(),
  prob_paved: z.number().nullable(),
  prob_unpaved: z.number().nullable(),
  confidence: z.number().nullable(),
  low_confidence: z.boolean().nullable(),
  is_labelled_train_road: z.boolean().nullable(),
});
export type RoadPrediction = z.infer<typeof roadPredictionSchema>;

export const roadIndicesSchema = z.object({
  osm_id: z.string(),
  indices: z.array(roadIndicesEntrySchema),
  prediction: roadPredictionSchema.nullable().optional(),
});
export type RoadIndices = z.infer<typeof roadIndicesSchema>;
