import * as THREE from "three";
import * as geometry from "./GeometryUtils";
import * as constants from "./Constants";
import { NavMap, EdgeWeightInfo } from "./NavgraphTypes";
import { NavMeshQuery } from "recast-navigation";
import * as recastUtils from "./RecastUtils";
import { createEdgeWeightKey } from "./Constants";

export function getAreasContainingEdge(map: NavMap, edgeId: string): string[] {
  if (!map) return [];

  return Object.entries(map.areas)
    .filter(([_, area]) => area.edges.includes(edgeId))
    .map(([areaId, _]) => areaId);
}

export function findExitPointsForGroup(
  map: NavMap,
  areaGroupId: string,
  areaIds: string[],
  legacyNavMeshQuery?: NavMeshQuery | null
): string[] {
  if (!map) return [];

  const allPoints = new Set<string>();

  // Collect all exit points from all areas in this group
  for (const areaId of areaIds) {
    const area = map.areas[areaId];
    area.edges.forEach((edgeId) => {
      const edge = map.edges[edgeId];
      if (edge) {
        allPoints.add(edge.from);
        allPoints.add(edge.to);
      }
    });
  }

  const exitPoints = new Set<string>();

  allPoints.forEach((pointId) => {
    // Check if this point connects to edges outside this area
    const connectingEdges = Object.entries(map.edges).filter(
      ([_, edge]) => edge.from === pointId || edge.to === pointId
    );

    // If point connects to edges that don't belong to this area, it's an exit
    const hasExternalConnections = connectingEdges.some(([edgeId, _]) => {
      const edgeAreas = getAreasContainingEdge(map, edgeId);
      // Return true if this edge has no areas OR has areas outside our group
      return (
        edgeAreas.length === 0 ||
        edgeAreas.some((areaId) => !areaIds.includes(areaId))
      );
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
      exitPoints.add(pointId);
    }
  });

  return Array.from(exitPoints);
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

  // Build ordered polygon from area edges
  const edgeMap = new Map<string, { from: string; to: string }>();
  area.edges.forEach((edgeId) => {
    const edge = map.edges[edgeId];
    if (edge) {
      edgeMap.set(edgeId, edge);
    }
  });

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

  while (currentEdgeId && !visited.has(currentEdgeId)) {
    visited.add(currentEdgeId);

    const edge = edgeMap.get(currentEdgeId);
    if (!edge) {
      console.log("Edge not found:", currentEdgeId);
      break;
    }

    const point = map.points[currentPoint];
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
  }

  return polygon.length > 2 ? polygon : null;
}

export function getNearestPositionOnEdge(
  map: NavMap,
  position: THREE.Vector3Like
): {
  position: THREE.Vector3Like;
  edgeId: string;
  fromPointId: string;
  toPointId: string;
  distance: number;
} | null {
  let nearestPosition: THREE.Vector3Like | null = null;
  let nearestEdgeId: string | null = null;
  let nearestFromPointId: string | null = null;
  let nearestToPointId: string | null = null;
  let minDistance = Infinity;

  // Check all edges
  Object.entries(map.edges).forEach(([edgeId, edge]) => {
    const fromPoint = map.points[edge.from];
    const toPoint = map.points[edge.to];

    if (!fromPoint || !toPoint) return;

    // Find closest point on this edge
    const closestPoint = geometry.getClosestPointOnLineSegment(
      position,
      fromPoint,
      toPoint
    );
    const distance = geometry.calculateDistance(position, closestPoint);

    if (distance < minDistance) {
      minDistance = distance;
      nearestPosition = closestPoint;
      nearestEdgeId = edgeId;
      nearestFromPointId = edge.from;
      nearestToPointId = edge.to;
    }
  });

  if (!nearestPosition || !nearestEdgeId) return null;

  return {
    position: nearestPosition,
    edgeId: nearestEdgeId,
    fromPointId: nearestFromPointId!,
    toPointId: nearestToPointId!,
    distance: minDistance,
  };
}

export function addAdjacency(
  adjacencyList: Map<string, string[]>,
  edgeWeights: Map<string, EdgeWeightInfo[]>,
  nodeId: string,
  neighborId: string,
  bidirectional: boolean,
  weightInfo: EdgeWeightInfo
): void {
  const neighbors = adjacencyList.get(nodeId) || [];
  if (!neighbors.includes(neighborId)) {
    neighbors.push(neighborId);
    adjacencyList.set(nodeId, neighbors);
  }

  const key = createEdgeWeightKey(nodeId, neighborId);
  const existing = edgeWeights.get(key) || [];
  existing.push(weightInfo);
  edgeWeights.set(key, existing);

  if (bidirectional) {
    //use recursion to add the neighbor to the adjacency list
    addAdjacency(adjacencyList, edgeWeights, neighborId, nodeId, false, {
      weight: weightInfo.weight,
      path: weightInfo.path.toReversed(),
    });
  }
}

/**
 * Helper function to compute NavMesh path and add connection
 */
export function computeNavMeshPathAndConnect(
  navMeshQuery: NavMeshQuery,
  fromPoint: THREE.Vector3Like,
  toPoint: THREE.Vector3Like,
  fromId: string,
  toId: string,
  adjacencyList: Map<string, string[]>,
  edgeWeights: Map<string, EdgeWeightInfo[]>
): boolean {
  try {
    const path = navMeshQuery.computePath(fromPoint, toPoint);
    if (path.success && path.path) {
      const distance = geometry.calculatePathLength(path.path);
      addAdjacency(adjacencyList, edgeWeights, fromId, toId, true, {
        weight: distance,
        path: path.path,
      });
      return true;
    }
  } catch (error) {
    console.error(
      `Failed to compute NavMesh path from ${fromId} to ${toId}:`,
      error
    );
  }
  return false;
}
