import * as THREE from "three";
import { NavMesh, NavMeshQuery } from "recast-navigation";
import * as geometry from "./GeometryUtils";

export function isPointOnLegacyNavMesh(
  point: THREE.Vector3Like,
  navMeshQuery: NavMeshQuery
): boolean {
  // Use NavMesh query to find nearest point on surface
  const pointV3 = new THREE.Vector3(point.x, point.y, point.z);

  try {
    const result = navMeshQuery.findClosestPoint(pointV3, {
      halfExtents: new THREE.Vector3(100, 10, 100),
    });
    if (result.success && result.point) {
      const distance = pointV3.distanceTo(
        new THREE.Vector3().copy(result.point)
      );
      return distance < 0.5; // Within 0.5 units of NavMesh surface
    }
  } catch (error) {
    console.error("Error checking point on legacy NavMesh:", error);
  }

  return false;
}

export function getNearestPositionOnLegacyNavMesh(
  legacyNavMeshQuery: NavMeshQuery | null,
  position: THREE.Vector3Like
): {
  position: THREE.Vector3Like;
  distance: number;
} | null {
  if (!legacyNavMeshQuery) {
    console.log("No legacy NavMesh query available");
    return null;
  }

  try {
    const positionV3 = new THREE.Vector3(position.x, position.y, position.z);
    const result = legacyNavMeshQuery.findClosestPoint(positionV3, {
      halfExtents: new THREE.Vector3(100, 10, 100),
    });

    if (result.success && result.point) {
      const distance = positionV3.distanceTo(
        new THREE.Vector3().copy(result.point)
      );
      console.log(
        `Legacy NavMesh found at distance ${distance} for position:`,
        position
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

export function findClosestLegacyPortal(
  legacyPortalPoints: Map<string, THREE.Vector3Like>,
  position: THREE.Vector3Like
): string | null {
  let closestPortal: string | null = null;
  let minDistance = Infinity;

  legacyPortalPoints.forEach((portalPoint, portalId) => {
    const distance = geometry.calculateDistance(position, portalPoint);
    if (distance < minDistance) {
      minDistance = distance;
      closestPortal = portalId;
    }
  });

  return closestPortal;
}

export function projectPointOntoLegacyNavMesh(
  point: THREE.Vector3Like,
  navMeshQuery: NavMeshQuery
): THREE.Vector3Like {
  const pointV3 = new THREE.Vector3(point.x, point.y, point.z);

  try {
    const result = navMeshQuery.findClosestPoint(pointV3, {
      halfExtents: new THREE.Vector3(100, 10, 100),
    });
    if (result.success && result.point) {
      return result.point;
    }
  } catch (error) {
    console.error("Error projecting point onto legacy NavMesh:", error);
  }

  // Fallback to original point if projection fails
  return point;
}
