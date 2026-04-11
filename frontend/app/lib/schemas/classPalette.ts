import { z } from 'zod';

// GET /api/class_palette → {order: [...], colors: {fclass: hex}}
//
// Backend source: backend/local_data.py:class_palette() which reads
// CLASS_COLORS from backend/config.py. Sub-millisecond cold + warm — does
// NOT trigger region_summaries() (which is multi-second cold). The workbench
// gates its <MapView> mount on this endpoint.
export const classPaletteSchema = z.object({
  order: z.array(z.string()),
  colors: z.record(z.string(), z.string()),
});
export type ClassPalette = z.infer<typeof classPaletteSchema>;
