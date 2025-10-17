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
