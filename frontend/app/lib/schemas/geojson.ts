import { z, type ZodType, type ZodTypeAny } from 'zod';

// Reusable GeoJSON geometry primitives. Kept lax (no inner-array length checks)
// because the data comes from geopandas which we trust at the boundary.

export const lineStringGeometrySchema = z.object({
  type: z.literal('LineString'),
  coordinates: z.array(z.array(z.number())),
});

export const multiLineStringGeometrySchema = z.object({
  type: z.literal('MultiLineString'),
  coordinates: z.array(z.array(z.array(z.number()))),
});

export const polygonGeometrySchema = z.object({
  type: z.literal('Polygon'),
  coordinates: z.array(z.array(z.array(z.number()))),
});

export const multiPolygonGeometrySchema = z.object({
  type: z.literal('MultiPolygon'),
  coordinates: z.array(z.array(z.array(z.array(z.number())))),
});

export const lineLikeGeometrySchema = z.union([
  lineStringGeometrySchema,
  multiLineStringGeometrySchema,
]);

export const polygonLikeGeometrySchema = z.union([
  polygonGeometrySchema,
  multiPolygonGeometrySchema,
]);

/**
 * Build a Feature schema with a typed `properties` body.
 *
 *   featureSchema(z.object({osm_id: z.string()}), lineLikeGeometrySchema)
 */
export function featureSchema<P extends ZodTypeAny, G extends ZodTypeAny>(
  properties: P,
  geometry: G,
) {
  return z.object({
    type: z.literal('Feature'),
    properties,
    geometry,
  });
}

/**
 * Build a FeatureCollection schema for a given Feature schema.
 */
export function featureCollectionSchema<F extends ZodType>(feature: F) {
  return z.object({
    type: z.literal('FeatureCollection'),
    features: z.array(feature),
  });
}
