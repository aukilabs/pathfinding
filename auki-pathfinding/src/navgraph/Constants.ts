/**
 * Constants for Navigation Graph System
 *
 * This file contains all magic strings and identifiers used throughout
 * the navigation system to prevent typos and improve maintainability.
 */

// ============================================================================
// INTERMEDIATE NODE IDENTIFIERS
// ============================================================================

/** Identifier for the intermediate node representing the start position */
export const FROM_INTERMEDIATE = "from_intermediate";

/** Identifier for the intermediate node representing the end position */
export const TO_INTERMEDIATE = "to_intermediate";

// ============================================================================
// LEGACY NAVMESH IDENTIFIERS
// ============================================================================

/** Edge ID used to identify legacy NavMesh surface edges */
export const LEGACY_NAVMESH_SURFACE_EDGE_ID = "_legacy_navmesh_surface";

/** Prefix for legacy portal point IDs */
const LEGACY_PORTAL_PREFIX = "legacy_portal_";

/** Fallback portal IDs when no specific portal is found */
export const LEGACY_PORTAL_FROM_FALLBACK = "_legacy_portal_from";
export const LEGACY_PORTAL_TO_FALLBACK = "_legacy_portal_to";

// ============================================================================
// PATH TEMPLATES
// ============================================================================

/** Template for creating legacy portal IDs */
export const LEGACY_PORTAL_ID_TEMPLATE = (pointId: string) =>
  `${LEGACY_PORTAL_PREFIX}${pointId}`;

/** Template for creating temporary path keys */
export const TEMP_PATH_KEY_TEMPLATES = {
  FROM_TO_NODE: (nodeId: string) => `${FROM_INTERMEDIATE}-${nodeId}`,
  NODE_TO_TO: (nodeId: string) => `${nodeId}-${TO_INTERMEDIATE}`,
  FROM_TO_EXIT: (exitId: string) => `${FROM_INTERMEDIATE}-${exitId}`,
  EXIT_TO_TO: (exitId: string) => `${exitId}-${TO_INTERMEDIATE}`,
} as const;

// ============================================================================
// EDGE WEIGHT KEYS
// ============================================================================

/** Template for creating edge weight keys */
export const EDGE_WEIGHT_KEY_TEMPLATE = (from: string, to: string) =>
  `${from}-${to}`;

// ============================================================================
// NAVMESH QUERY CONFIGURATION
// ============================================================================

/** Default half extents for NavMesh queries */
export const DEFAULT_NAVMESH_QUERY_HALF_EXTENTS = {
  x: 100,
  y: 10,
  z: 100,
} as const;

/** Tolerance for point-on-edge detection */
export const POINT_ON_EDGE_TOLERANCE = 0.1;

/** Tolerance for point equality comparison */
export const POINT_EQUALITY_TOLERANCE = 0.001;

/** Distance threshold for legacy NavMesh surface detection */
export const LEGACY_NAVMESH_SURFACE_THRESHOLD = 0.5;

// ============================================================================
// PATHFINDING CONFIGURATION
// ============================================================================

/** Tolerance factor for direct NavMesh path vs portal path comparison */
export const DIRECT_PATH_TOLERANCE_FACTOR = 1.1;

/** Default weight for intermediate point connections */
export const INTERMEDIATE_POINT_WEIGHT = 0.1;

// ============================================================================
// NAVMESH BUILDING CONFIGURATION
// ============================================================================

/** Default NavMesh building parameters */
export const DEFAULT_NAVMESH_PARAMS = {
  walkableRadius: 0,
  cs: 0.05,
  ch: 0.05,
  maxSimplificationError: 0.5,
  minRegionArea: 0,
  mergeRegionArea: 0,
  detailSampleDist: 2,
  detailSampleMaxError: 0.5,
  maxEdgeLen: 30,
} as const;

// ============================================================================
// POLYGON EXPANSION
// ============================================================================

/** Default expansion distance for polygon expansion */
export const DEFAULT_POLYGON_EXPANSION_DISTANCE = 0.01;

// ============================================================================
// TYPE GUARDS
// ============================================================================

/** Check if a node ID represents a legacy portal */
export const isLegacyPortal = (nodeId: string): boolean =>
  nodeId.startsWith(LEGACY_PORTAL_PREFIX);

/** Check if a node ID represents an intermediate node */
export const isIntermediateNode = (nodeId: string): boolean =>
  nodeId === FROM_INTERMEDIATE || nodeId === TO_INTERMEDIATE;

/** Check if an edge ID represents a legacy NavMesh surface */
export const isLegacyNavMeshEdge = (edgeId: string): boolean =>
  edgeId === LEGACY_NAVMESH_SURFACE_EDGE_ID;

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/** Create a legacy portal ID from a point ID */
export const createLegacyPortalId = (pointId: string): string =>
  LEGACY_PORTAL_ID_TEMPLATE(pointId);

/** Create an edge weight key from two node IDs */
export const createEdgeWeightKey = (from: string, to: string): string =>
  EDGE_WEIGHT_KEY_TEMPLATE(from, to);

/** Create a temporary path key for from intermediate to a node */
export const createFromIntermediatePathKey = (nodeId: string): string =>
  TEMP_PATH_KEY_TEMPLATES.FROM_TO_NODE(nodeId);

/** Create a temporary path key for a node to to intermediate */
export const createToIntermediatePathKey = (nodeId: string): string =>
  TEMP_PATH_KEY_TEMPLATES.NODE_TO_TO(nodeId);
