import * as THREE from "three";
import * as legacyQuery from "./RecastUtils";
import * as geometry from "./GeometryUtils";
import { NavMeshQuery } from "recast-navigation";
import * as constants from "./Constants";

export function chooseClosestResult(
  edgeResult: any,
  legacyResult: any,
  originalPosition: THREE.Vector3Like
): any {
  if (!edgeResult && !legacyResult) return null;
  if (!edgeResult) {
    // Convert legacy result to edge result format
    return {
      position: legacyResult.position,
      edgeId: constants.LEGACY_NAVMESH_SURFACE_EDGE_ID,
      fromPointId: constants.LEGACY_PORTAL_FROM_FALLBACK,
      toPointId: constants.LEGACY_PORTAL_TO_FALLBACK,
      distance: legacyResult.distance,
    };
  }
  if (!legacyResult) return edgeResult;

  // Choose the one with smaller distance
  if (legacyResult.distance < edgeResult.distance) {
    // Convert legacy result to edge result format
    return {
      position: legacyResult.position,
      edgeId: constants.LEGACY_NAVMESH_SURFACE_EDGE_ID,
      fromPointId: constants.LEGACY_PORTAL_FROM_FALLBACK,
      toPointId: constants.LEGACY_PORTAL_TO_FALLBACK,
      distance: legacyResult.distance,
    };
  } else {
    return edgeResult;
  }
}

export function estimatePortalPathLength(
  legacyPortalPoints: Map<string, THREE.Vector3Like>,
  from: THREE.Vector3Like,
  to: THREE.Vector3Like
): number {
  // Find closest portals to both points
  const fromPortal = legacyQuery.findClosestLegacyPortal(
    legacyPortalPoints,
    from
  );
  const toPortal = legacyQuery.findClosestLegacyPortal(legacyPortalPoints, to);

  if (!fromPortal || !toPortal) return Infinity;

  // Calculate distances: from -> fromPortal -> toPortal -> to
  const fromToPortal = geometry.calculateDistance(
    from,
    legacyPortalPoints.get(fromPortal)!
  );
  const portalToPortal = geometry.calculateDistance(
    legacyPortalPoints.get(fromPortal)!,
    legacyPortalPoints.get(toPortal)!
  );
  const portalToTo = geometry.calculateDistance(
    legacyPortalPoints.get(toPortal)!,
    to
  );

  return fromToPortal + portalToPortal + portalToTo;
}

export function reconstructPath(
  previous: Map<string, string | null>,
  from: string,
  to: string
): string[] | null {
  const path: string[] = [];
  let current = to;

  while (current && current !== "") {
    path.unshift(current);
    current = previous.get(current) || "";
  }

  return path[0] === from ? path : null;
}

export function tryDirectLegacyNavMeshPath(
  legacyNavMeshQuery: NavMeshQuery | null,
  from: THREE.Vector3Like,
  to: THREE.Vector3Like
): THREE.Vector3Like[] | null {
  if (!legacyNavMeshQuery) return null;

  try {
    const fromV3 = new THREE.Vector3(from.x, from.y, from.z);
    const toV3 = new THREE.Vector3(to.x, to.y, to.z);

    const path = legacyNavMeshQuery.computePath(fromV3, toV3);
    if (path.success && path.path && path.path.length > 0) {
      return [from, ...path.path, to];
    }
  } catch (error) {
    console.error("Error computing direct legacy NavMesh path:", error);
  }

  return null;
}
