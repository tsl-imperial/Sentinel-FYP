import { z } from 'zod';
import { featureSchema, featureCollectionSchema, polygonLikeGeometrySchema } from './geojson';

// GET /api/boundary_layer?region=
//
// Local-data backend returns a GeoJSON FeatureCollection (typically a single
// Polygon — the convex hull of the region's roads).

const boundaryFeatureSchema = featureSchema(
  z.record(z.string(), z.unknown()).optional(),
  polygonLikeGeometrySchema,
);

export const boundaryLayerSchema = z.object({
  geojson: featureCollectionSchema(boundaryFeatureSchema),
});

export type BoundaryLayer = z.infer<typeof boundaryLayerSchema>;
