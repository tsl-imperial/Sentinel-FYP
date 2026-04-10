import { z } from 'zod';

// GET /api/regions → string[] (e.g. ["Ghana", "Greater Accra", "Ashanti", ...])
export const regionsSchema = z.array(z.string());
export type Regions = z.infer<typeof regionsSchema>;
