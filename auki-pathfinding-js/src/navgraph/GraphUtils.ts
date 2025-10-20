import * as THREE from "three";
import * as geometry from "./GeometryUtils";
import * as constants from "./Constants";
import { Area, NavMap, Points, EdgeWeightInfo } from "./NavgraphTypes";
import { NavMeshQuery } from "recast-navigation";
import * as recastUtils from "./RecastUtils";

export function getAreasContainingEdge(map: NavMap, edgeId: string): string[] {
  if (!map) return [];

  return Object.entries(map.areas)
    .filter(([_, area]) => area.edges.includes(edgeId))
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

  const allpoints = new Set<string>();

  area.edges.forEach((edgeId) => {
    const edge = map.edges[edgeId];
    if (edge) {
      allpoints.add(edge.from);
      allpoints.add(edge.to);
    }
  });

  allpoints.forEach((pointId) => {
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

  for (let i = 0; i < area.edges.length; i++) {
    const edge = map.edges[area.edges[i]];
    const fromPointId = edge.from;
    const toPointId = edge.to;
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
  const points = new Set<string>();
  area.edges.forEach((edgeId) => {
    const edge = map.edges[edgeId];
    if (edge) {
      points.add(edge.from);
      points.add(edge.to);
    }
  });

  const vertices: THREE.Vector3Like[] = Array.from(points).map(
    (pointId) => map.points[pointId]
  );
  // Use ray casting to determine if point is inside polygon
  return geometry.isPointInPolygon(point, vertices);
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
  areaId: string,
  map: NavMap
): THREE.Vector3Like[] | null {
  if (!map) return null;
  const area = map.areas[areaId];
  if (!area) return null;

  console.log("Building polygon for area:", area.edges);

  // Build ordered polygon from area edges
  const edgeMap = new Map<string, { from: string; to: string }>();
  area.edges.forEach((edgeId) => {
    const edge = map.edges[edgeId];
    if (edge) {
      edgeMap.set(edgeId, edge);
    }
  });

  console.log("Edge map:", Object.fromEntries(edgeMap));

  // Find a starting edge and build the polygon
  const polygon: THREE.Vector3Like[] = [];
  const visited = new Set<string>();

  const firstEdgeId = area.edges[0];
  const firstEdge = edgeMap.get(firstEdgeId);
  if (!firstEdge) {
    console.log("First edge not found:", firstEdgeId);
    return null;
  }

  let currentPoint = firstEdge.from;
  let currentEdgeId: string | undefined = firstEdgeId;

  console.log(
    "Starting with edge:",
    currentEdgeId,
    "from point:",
    currentPoint
  );

  while (currentEdgeId && !visited.has(currentEdgeId)) {
    visited.add(currentEdgeId);

    const edge = edgeMap.get(currentEdgeId);
    if (!edge) {
      console.log("Edge not found:", currentEdgeId);
      break;
    }

    const point = map.points[currentPoint];
    console.log("Adding point:", currentPoint, "at", point);
    polygon.push(point);
    currentPoint = edge.to;

    // Find next edge that starts from current point OR ends at current point
    currentEdgeId = area.edges.find((eid) => {
      const e = edgeMap.get(eid);
      return (
        e &&
        !visited.has(eid) &&
        (e.from === currentPoint || e.to === currentPoint)
      );
    });

    // If we found an edge that ends at current point, we need to reverse it
    if (currentEdgeId) {
      const e = edgeMap.get(currentEdgeId);
      if (e && e.to === currentPoint) {
        // Swap from/to for this edge in our path
        const temp = e.from;
        e.from = e.to;
        e.to = temp;
      }
    }

    console.log("Next edge:", currentEdgeId);
  }

  console.log("Final polygon:", polygon);
  return polygon.length > 2 ? polygon : null;
}
