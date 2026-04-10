import { z } from 'zod';
import { featureSchema, featureCollectionSchema, lineLikeGeometrySchema } from './geojson';

// GET /api/overview_layers?region=
//
// Local-data backend returns one entry per road class with:
//   class:         OSM fclass (trunk, primary, secondary, ...)
//   color:         hex color string
//   geojson:       FeatureCollection of LineStrings/MultiLineStrings
//   feature_count: number of features (denormalised for the legend display)

const roadFeatureSchema = featureSchema(
  z
    .object({
      osm_id: z.string().optional(),
      name: z.string().nullable().optional(),
      fclass: z.string().optional(),
    })
    .passthrough(),
  lineLikeGeometrySchema,
);

export const overviewLayersSchema = z.object({
  layers: z.array(
    z.object({
      class: z.string(),
      color: z.string(),
      geojson: featureCollectionSchema(roadFeatureSchema),
      feature_count: z.number().int(),
    }),
  ),
});

export type OverviewLayers = z.infer<typeof overviewLayersSchema>;
export type OverviewLayer = OverviewLayers['layers'][number];
