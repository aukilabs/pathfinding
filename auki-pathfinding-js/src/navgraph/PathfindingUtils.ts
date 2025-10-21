import * as THREE from "three";
import * as legacyQuery from "./RecastUtils";
import * as geometry from "./GeometryUtils";
import { NavMeshQuery } from "recast-navigation";
import * as constants from "./Constants";

export function chooseClosestResult(
  edgeResult: {
    position: THREE.Vector3Like;
    edgeId: string;
    fromPointId: string;
    toPointId: string;
    distance: number;
  } | null,
  legacyResult: {
    position: THREE.Vector3Like;
    distance: number;
  } | null,
  inAreaGroupResult: {
    areaGroupId: string;
    position: THREE.Vector3Like;
  } | null
): {
  position: THREE.Vector3Like;
  distance: number;
  edgeId: string;
  fromPointId: string;
  toPointId: string;
} | null {
  if (inAreaGroupResult)
    return {
      position: inAreaGroupResult.position,
      distance: 0,
      edgeId: constants.WITHIN_AREA_GROUP_EDGE_ID,
      fromPointId: inAreaGroupResult.areaGroupId,
      toPointId: inAreaGroupResult.areaGroupId,
    };
  if (!edgeResult && !legacyResult) return null;
  if (!edgeResult) return convertLegacyToEdgeResult(legacyResult);
  if (!legacyResult) return edgeResult;

  // Choose the one with smaller distance
  return legacyResult.distance < edgeResult.distance
    ? convertLegacyToEdgeResult(legacyResult)
    : edgeResult;
}

function convertLegacyToEdgeResult(legacyResult: any): any {
  return {
    position: legacyResult.position,
    edgeId: constants.LEGACY_NAVMESH_SURFACE_EDGE_ID,
    fromPointId: constants.LEGACY_PORTAL_FROM_FALLBACK,
    toPointId: constants.LEGACY_PORTAL_TO_FALLBACK,
    distance: legacyResult.distance,
  };
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
