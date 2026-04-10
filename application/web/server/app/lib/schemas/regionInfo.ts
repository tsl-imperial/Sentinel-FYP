import { z } from 'zod';

// GET /api/region_info?region= → {center: [lat, lng]}
export const regionInfoSchema = z.object({
  center: z.tuple([z.number(), z.number()]),
});
export type RegionInfo = z.infer<typeof regionInfoSchema>;
