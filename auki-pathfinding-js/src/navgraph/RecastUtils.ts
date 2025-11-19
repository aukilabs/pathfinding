import { NavMeshQuery } from "@recast-navigation/core";
import * as constants from "./Constants";
import { V3, geometry } from "@auki/navgraph";

export function getNavmeshUnderPoint(
  point: V3,
  navMeshQueries: Map<string, NavMeshQuery>
): string | null {
  // Use NavMesh query to find nearest point on surface

  try {
    for (const [areaGroupId, areaGroupQuery] of navMeshQueries) {
      const result = (areaGroupQuery as NavMeshQuery).findClosestPoint(point, {
        halfExtents: constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS,
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
  point: V3,
  navMeshQuery: NavMeshQuery
): boolean {
  // Use NavMesh query to find nearest point on surface
  try {
    const result = navMeshQuery.findClosestPoint(point, {
      halfExtents: constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS,
    });
    if (result.success && result.point) {
      return result.isPointOverPoly;
    }
  } catch (error) {
    console.error("Error checking point on legacy NavMesh:", error);
  }

  return false;
}

export function findClosestPoint(
  legacyNavMeshQuery: NavMeshQuery | null,
  position: V3
): {
  position: V3;
  distance: number;
} | null {
  if (!legacyNavMeshQuery) {
    return null;
  }

  try {
    const result = legacyNavMeshQuery.findClosestPoint(position, {
      halfExtents: constants.DEFAULT_NAVMESH_QUERY_HALF_EXTENTS,
    });

    if (result.success && result.point) {
      const distance = geometry.calculateDistance(position, result.point);

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
