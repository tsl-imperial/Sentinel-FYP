import { z } from 'zod';

// GET /api/healthz → {status: "ok"}
export const healthzSchema = z.object({
  status: z.literal('ok'),
});
export type Healthz = z.infer<typeof healthzSchema>;
