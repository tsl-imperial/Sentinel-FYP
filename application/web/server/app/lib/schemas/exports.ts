import { z } from 'zod';

// GET /api/exports
//
// Lists Network Inspector extractions in NETINSPECT_OUTPUT_DIR. Each export
// groups its 3 sibling files (network pickle, edges geojson, sentinel stats).

const exportFileKindSchema = z.enum(['network_pickle', 'edges_geojson', 'sentinel_stats']);

export const exportFileSchema = z.object({
  name: z.string(),
  kind: exportFileKindSchema,
  size_bytes: z.number().int(),
  url: z.string(),
});

export const exportEntrySchema = z.object({
  prefix: z.string(),
  created_at: z.string(),
  total_bytes: z.number().int(),
  files: z.array(exportFileSchema),
});

export const exportsListSchema = z.object({
  exports: z.array(exportEntrySchema),
});

export type ExportFileKind = z.infer<typeof exportFileKindSchema>;
export type ExportFile = z.infer<typeof exportFileSchema>;
export type ExportEntry = z.infer<typeof exportEntrySchema>;
export type ExportsList = z.infer<typeof exportsListSchema>;
