import * as THREE from "three";
import { NavMeshQuery } from "recast-navigation";
import * as constants from "./Constants";

export function getNavmeshUnderPoint(
  point: THREE.Vector3Like,
  navMeshQueries: Map<string, NavMeshQuery>
): string | null {
  // Use NavMesh query to find nearest point on surface
  const pointV3 = new THREE.Vector3(point.x, point.y, point.z);

  console.log("Getting navmesh under point:", {
    point: point,
    navMeshQueries: navMeshQueries,
  });
  try {
    for (const [areaGroupId, areaGroupQuery] of navMeshQueries) {
      const result = (areaGroupQuery as NavMeshQuery).findClosestPoint(
        pointV3,
        {
          halfExtents: new THREE.Vector3(
            constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.x,
            constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.y,
            constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.z
          ),
        }
      );

      console.log(`Checking areaGroup ${areaGroupId}:`, {
        success: result.success,
        hasPoint: !!result.point,
        isPointOverPoly: result.isPointOverPoly,
        distance:
          result.success && result.point
            ? pointV3.distanceTo(new THREE.Vector3().copy(result.point))
            : "N/A",
      });

      if (result.success && result.point && result.isPointOverPoly) {
        return areaGroupId;
      }
    }
  } catch (error) {
    console.error("Error checking point on legacy NavMesh:", error);
  }

  return null;
}

export function isPointOnLegacyNavMesh(
  point: THREE.Vector3Like,
  navMeshQuery: NavMeshQuery
): boolean {
  // Use NavMesh query to find nearest point on surface
  const pointV3 = new THREE.Vector3(point.x, point.y, point.z);

  try {
    const result = navMeshQuery.findClosestPoint(pointV3, {
      halfExtents: new THREE.Vector3(
        constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.x,
        constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.y,
        constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.z
      ),
    });
    if (result.success && result.point) {
      return result.isPointOverPoly;
    }
  } catch (error) {
    console.error("Error checking point on legacy NavMesh:", error);
  }

  return false;
}

export function getNearestPositionOnNavMesh(
  legacyNavMeshQuery: NavMeshQuery | null,
  position: THREE.Vector3Like
): {
  position: THREE.Vector3Like;
  distance: number;
} | null {
  if (!legacyNavMeshQuery) {
    return null;
  }

  try {
    const positionV3 = new THREE.Vector3(position.x, position.y, position.z);
    const result = legacyNavMeshQuery.findClosestPoint(positionV3, {
      halfExtents: new THREE.Vector3(
        constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.x,
        constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.y,
        constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS.z
      ),
    });

    if (result.success && result.point) {
      const distance = positionV3.distanceTo(
        new THREE.Vector3().copy(result.point)
      );

      return {
        position: result.point,
        distance: distance,
      };
    } else {
      console.log("Legacy NavMesh query failed:", result);
    }
  } catch (error) {
    console.error("Error finding nearest point on legacy NavMesh:", error);
  }

  return null;
}
