import * as THREE from "three";
import * as geometry from "./GeometryUtils";
import * as constants from "./Constants";
import { Area, NavMap, Points, EdgeWeightInfo } from "./NavgraphTypes";
import { NavMeshQuery } from "recast-navigation";
import * as recastUtils from "./RecastUtils";

export function getAreasContainingEdge(map: NavMap, edgeId: string): string[] {
  if (!map) return [];

  const edge = map.edges[edgeId];
  if (!edge) return [];

  return Object.entries(map.areas)
    .filter(
      ([_, area]) =>
        area.points.includes(edge.from) && area.points.includes(edge.to)
    )
    .map(([areaId, _]) => areaId);
}

export function findExitPoints(
  map: NavMap,
  areaId: string,
  legacyNavMeshQuery?: NavMeshQuery | null
): string[] {
  if (!map) return [];

  const area = map.areas[areaId];
  const exitPoints: string[] = [];

  area.points.forEach((pointId) => {
    // Check if this point connects to edges outside this area
    const connectingEdges = Object.entries(map.edges).filter(
      ([_, edge]) => edge.from === pointId || edge.to === pointId
    );

    // If point connects to edges that don't belong to this area, it's an exit
    const hasExternalConnections = connectingEdges.some(([edgeId, _]) => {
      const edgeAreas = getAreasContainingEdge(map, edgeId);
      return !edgeAreas.includes(areaId);
    });

    // Also check if point is on legacy NavMesh using the query
    let isOnLegacyNavMesh = false;
    if (legacyNavMeshQuery) {
      const point = map.points[pointId];
      if (point) {
        isOnLegacyNavMesh = recastUtils.isPointOnLegacyNavMesh(
          point,
          legacyNavMeshQuery
        );
      }
    }

    if (hasExternalConnections || isOnLegacyNavMesh) {
      exitPoints.push(pointId);
    }
  });

  return exitPoints;
}

export function isPointOnAreaEdge(
  map: NavMap,
  point: THREE.Vector3Like,
  areaId: string
): boolean {
  if (!map) return false;

  const area = map.areas[areaId];
  if (!area) return false;

  for (let i = 0; i < area.points.length; i++) {
    const fromPointId = area.points[i];
    const toPointId = area.points[(i + 1) % area.points.length];

    const fromPoint = map.points[fromPointId];
    const toPoint = map.points[toPointId];

    if (
      fromPoint &&
      toPoint &&
      geometry.isPointOnEdge(point, fromPoint, toPoint)
    ) {
      return true;
    }
  }

  return false;
}

export function isPointInsideArea(
  map: NavMap,
  point: THREE.Vector3Like,
  areaId: string
): boolean {
  if (!map) return false;

  const area = map.areas[areaId];
  if (!area) return false;

  // Get all vertices of the area
  const vertices: THREE.Vector3Like[] = [];
  area.points.forEach((pointId) => {
    const point = map.points[pointId];
    if (point) {
      vertices.push(point);
    }
  });

  // Remove duplicates
  const uniqueVertices = vertices.filter(
    (vertex, index, self) =>
      index === self.findIndex((v) => geometry.pointsAreEqual(vertex, v))
  );

  // Use ray casting to determine if point is inside polygon
  return geometry.isPointInPolygon(point, uniqueVertices);
}

export function findAreaContainingPoint(
  map: NavMap,
  point: THREE.Vector3Like
): string | null {
  if (!map) return null;

  // Check each area to see if the point is inside it
  for (const [areaId, area] of Object.entries(map.areas)) {
    if (isPointInsideArea(map, point, areaId)) {
      return areaId;
    }
  }

  return null;
}

export function getEdgeWeight(
  edgeWeights: Map<string, EdgeWeightInfo[]>,
  from: string,
  to: string
): number {
  // First check if we have stored weights for this edge
  const connections = edgeWeights.get(constants.createEdgeWeightKey(from, to));
  if (connections && connections.length > 0) {
    // Find the minimum weight among all connection types
    return connections.reduce(
      (min, conn) => (conn.weight < min ? conn.weight : min),
      Infinity
    );
  }

  // Handle intermediate points - calculate actual distance to their edge endpoints
  if (
    from === constants.FROM_INTERMEDIATE ||
    to === constants.FROM_INTERMEDIATE
  ) {
    const other = from === constants.FROM_INTERMEDIATE ? to : from;
    // Calculate distance from intermediate point to the other node
    // For now, use a small weight since we don't have access to the intermediate position here
    return constants.INTERMEDIATE_POINT_WEIGHT;
  }

  if (from === constants.TO_INTERMEDIATE || to === constants.TO_INTERMEDIATE) {
    const other = from === constants.TO_INTERMEDIATE ? to : from;
    // Calculate distance from intermediate point to the other node
    // For now, use a small weight since we don't have access to the intermediate position here
    return constants.INTERMEDIATE_POINT_WEIGHT;
  }

  // Regular edge weight - check if connection exists
  return Infinity;
}

export function buildPolygonFromArea(
  area: Area,
  points: Points
): THREE.Vector3Like[] | null {
  if (!points) return null;

  // Find a starting edge and build the polygon
  const polygon: THREE.Vector3Like[] = area.points.map((pointId) => {
    return points[pointId];
  });

  return polygon.length > 2 ? polygon : null;
}
