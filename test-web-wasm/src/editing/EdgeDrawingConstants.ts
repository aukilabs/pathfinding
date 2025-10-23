export const EDGE_DRAWING_CONSTANTS = {
  POINT_SNAP_DISTANCE: 0.4,
  EDGE_SNAP_DISTANCE: 0.3,
  INTERSECTION_TOLERANCE: 0.01,
  AREA_SPLIT_MIN_LENGTH: 0.1,
} as const;

// User preferences for area splitting behavior
export const AREA_SPLIT_BEHAVIOR = {
  SPLIT_AREAS: "split_areas", // Create separate areas, keep cutting edges
  REMOVE_INTERNAL_EDGES: "remove_internal_edges", // Keep single area, remove cutting edges
} as const;

export type AreaSplitBehavior =
  (typeof AREA_SPLIT_BEHAVIOR)[keyof typeof AREA_SPLIT_BEHAVIOR];
