import { getClosestPointOnLineSegment, NavMap } from "auki-pathfinding";
import * as THREE from "three";

export function findSmallestUnfilledAreaContainingPoint(
  state: NavMap,
  clickPoint: THREE.Vector3
): { edges: string[] } | null {
  // Find the smallest polygon containing the click point
  const smallestPolygon = findSmallestPolygonContainingPoint(state, clickPoint);

  console.log(
    "Smallest polygon containing point:",
    clickPoint,
    "is",
    smallestPolygon
  );
  if (smallestPolygon && smallestPolygon.length >= 3) {
    // Check if this loop is already an area
    const isExistingArea = Object.values(state.areas).some(
      (area) =>
        area.edges &&
        area.edges.length === smallestPolygon.length &&
        area.edges.every((edgeId) => smallestPolygon.includes(edgeId))
    );

    if (!isExistingArea) {
      return {
        edges: smallestPolygon,
      };
    }
  }

  return null;
}

export function findExistingAreaContainingPoint(
  state: NavMap,
  clickPoint: THREE.Vector3
): { id: string; area: { edges: string[] } } | null {
  // Iterate through each existing area
  for (const [areaId, area] of Object.entries(state.areas)) {
    if (!area.edges || area.edges.length < 3) continue;

    // Construct polygon from area edges
    const polygonPoints = getPolygonPointsFromEdges(state, area.edges);

    // Test if click point is inside this polygon
    if (
      polygonPoints.length >= 3 &&
      isPointInPolygon(clickPoint, polygonPoints)
    ) {
      return {
        id: areaId,
        area: area,
      };
    }
  }

  return null;
}

export function findSmallestPolygonContainingPoint(
  state: NavMap,
  clickPoint: THREE.Vector3
): string[] | null {
  // First, find any polygon that contains the point
  const initialPolygon = findPolygonContainingPoint(state, clickPoint);
  console.log(
    "any polygon containing point:",
    clickPoint,
    "is",
    initialPolygon
  );
  if (!initialPolygon) {
    return null;
  }

  // Then iteratively shrink it by removing edges that cut across it
  return shrinkPolygonToMinimal(state, initialPolygon, clickPoint);
}

export function findPolygonContainingPoint(
  state: NavMap,
  clickPoint: THREE.Vector3
): string[] | null {
  let closestEdge: string | null = null;
  let distance = Infinity;
  for (const [edgeId, edge] of Object.entries(state.edges)) {
    const fromPoint = state.points[edge.from];
    const toPoint = state.points[edge.to];
    if (fromPoint && toPoint) {
      const closestPoint = getClosestPointOnLineSegment(
        clickPoint,
        fromPoint,
        toPoint
      );
      const d = clickPoint.distanceTo(closestPoint);
      if (d < distance) {
        distance = d;
        closestEdge = edgeId;
      }
    }
  }

  if (!closestEdge) return null;

  const polygon = findAnyPolygonAlongEdgeContainingPoint(
    state,
    closestEdge,
    clickPoint
  );
  console.log("Polygon containing edge:", closestEdge, "is", polygon);
  return polygon ?? null;
}

function shrinkPolygonToMinimal(
  state: NavMap,
  polygon: string[],
  clickPoint: THREE.Vector3
): string[] {
  console.log("Shrinking polygon:", polygon, "to minimal");
  let currentPolygon = [...polygon];
  let changed = true;
  let iterations = 0;
  const maxIterations = 10; // Prevent infinite loops

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;

    // Find edges that cut across the current polygon
    const cuttingEdges = findEdgesCuttingPolygon(state, currentPolygon);

    console.log("Cutting edges:", cuttingEdges);

    for (const cuttingEdgeChain of cuttingEdges) {
      // Skip invalid cutting chains
      if (cuttingEdgeChain.length === 0) continue;

      // Skip chains with duplicate edges
      const uniqueEdges = [...new Set(cuttingEdgeChain)];
      if (uniqueEdges.length !== cuttingEdgeChain.length) {
        console.log(
          "Skipping cutting chain with duplicate edges:",
          cuttingEdgeChain
        );
        continue;
      }

      // Split the polygon using this cutting edge chain
      const splitPolygons = splitPolygonWithEdge(
        state,
        currentPolygon,
        cuttingEdgeChain
      );

      console.log("Split polygons:", splitPolygons);

      // Find which split polygon contains the click point
      for (const splitPolygon of splitPolygons) {
        if (splitPolygon.length >= 3) {
          const polygonPoints = getPolygonPointsFromEdges(state, splitPolygon);

          // Check if this split polygon contains the point
          if (
            polygonPoints.length >= 3 &&
            isPointInPolygon(clickPoint, polygonPoints)
          ) {
            currentPolygon = splitPolygon;
            changed = true;
            console.log("Using smaller polygon:", splitPolygon);
            break; // Start over with the new polygon
          }
        }
      }

      if (changed) break; // Exit outer loop if we found a smaller polygon
    }
  }

  if (iterations >= maxIterations) {
    console.log("Reached maximum iterations, stopping polygon shrinking");
  }

  return currentPolygon;
}

function getPolygonPointsFromEdges(
  state: NavMap,
  edgeIds: string[]
): THREE.Vector3[] {
  const polygonPoints: THREE.Vector3[] = [];
  const visitedPoints = new Set<string>();

  for (const edgeId of edgeIds) {
    const edge = state.edges[edgeId];
    if (edge) {
      const fromPoint = state.points[edge.from];
      const toPoint = state.points[edge.to];

      if (fromPoint && !visitedPoints.has(edge.from)) {
        polygonPoints.push(
          new THREE.Vector3(fromPoint.x, fromPoint.y ?? 0, fromPoint.z)
        );
        visitedPoints.add(edge.from);
      }
      if (toPoint && !visitedPoints.has(edge.to)) {
        polygonPoints.push(
          new THREE.Vector3(toPoint.x, toPoint.y ?? 0, toPoint.z)
        );
        visitedPoints.add(edge.to);
      }
    }
  }

  return polygonPoints;
}

function splitPolygonWithEdge(
  state: NavMap,
  polygonEdges: string[],
  cuttingEdgeChain: string[]
): string[][] {
  if (cuttingEdgeChain.length === 0) return [polygonEdges];

  // Get the start and end points of the cutting edge chain
  const firstEdge = state.edges[cuttingEdgeChain[0]];
  const lastEdge = state.edges[cuttingEdgeChain[cuttingEdgeChain.length - 1]];

  if (!firstEdge || !lastEdge) return [polygonEdges];

  const cuttingFrom = firstEdge.from;
  const cuttingTo = lastEdge.to;

  console.log(
    "Splitting polygon with edge chain",
    cuttingEdgeChain,
    "from",
    cuttingFrom,
    "to",
    cuttingTo
  );

  // Find the indices of the cutting edge chain endpoints in the polygon
  let fromIndex = -1;
  let toIndex = -1;

  for (let i = 0; i < polygonEdges.length; i++) {
    const edge = state.edges[polygonEdges[i]];
    if (!edge) continue;

    // Check if this edge connects to the cutting edge chain endpoints
    if (edge.from === cuttingFrom || edge.to === cuttingFrom) {
      fromIndex = i;
    }
    if (edge.from === cuttingTo || edge.to === cuttingTo) {
      toIndex = i;
    }
  }

  if (fromIndex === -1 || toIndex === -1) {
    console.log("Cutting edge chain endpoints not found in polygon");
    return [polygonEdges];
  }

  // Ensure fromIndex comes before toIndex
  if (fromIndex > toIndex) {
    [fromIndex, toIndex] = [toIndex, fromIndex];
  }

  // Create two polygons by splitting the edge sequence
  const polygon1 = polygonEdges.slice(fromIndex, toIndex + 1);
  const polygon2 = [
    ...polygonEdges.slice(toIndex),
    ...polygonEdges.slice(0, fromIndex + 1),
  ];

  // Add the cutting edge chain to both polygons
  const result = [];
  if (polygon1.length >= 2) {
    result.push([...polygon1, ...cuttingEdgeChain]);
  }
  if (polygon2.length >= 2) {
    result.push([...polygon2, ...cuttingEdgeChain]);
  }

  console.log("Split result:", result);
  return result;
}

function findAnyPolygonAlongEdgeContainingPoint(
  state: NavMap,
  startEdgeId: string,
  clickPoint: THREE.Vector3
): string[] | null {
  const edge = state.edges[startEdgeId];
  if (!edge) return null;

  const fromPoint = edge.from;
  const toPoint = edge.to;

  const dfs = (
    currentPoint: string,
    edgePath: string[],
    pointPath: string[],
    visited: Set<string>
  ): string[] | null => {
    // Check if we've formed a closed loop
    if (currentPoint === fromPoint && pointPath.length > 2) {
      console.log(
        "Found closed loop with",
        edgePath.length,
        "edges:",
        edgePath
      );

      const polygon = [...edgePath];

      // Check if this polygon contains the click point
      const polygonPoints = getPolygonPointsFromEdges(state, polygon);
      if (
        polygonPoints.length >= 3 &&
        isPointInPolygon(clickPoint, polygonPoints)
      ) {
        console.log("Polygon contains click point! Returning it.");
        return polygon; // Return immediately - we're done!
      } else {
        console.log("Polygon does not contain click point. Continuing search.");
        return null; // Continue searching
      }
    }

    if (visited.has(currentPoint)) {
      return null; // Already visited, no loop
    }

    visited.add(currentPoint);

    // Find connected edges
    const connectedEdges = Object.entries(state.edges).filter(
      ([edgeId, edge]) =>
        (edge.from === currentPoint || edge.to === currentPoint) &&
        !edgePath.includes(edgeId)
    );

    for (const [edgeId, edge] of connectedEdges) {
      const nextPoint = edge.from === currentPoint ? edge.to : edge.from;

      edgePath.push(edgeId);
      pointPath.push(nextPoint);

      const result = dfs(nextPoint, edgePath, pointPath, visited);
      if (result) {
        return result; // Found what we're looking for, return it!
      }

      edgePath.pop();
      pointPath.pop();
    }

    visited.delete(currentPoint);
    return null;
  };

  // Start the search
  const edgePath = [startEdgeId];
  const pointPath = [fromPoint, toPoint];
  const visited = new Set<string>([fromPoint]);

  return dfs(toPoint, edgePath, pointPath, visited);
}

// Find edges that cut across a polygon (edges not part of the polygon boundary)
function findEdgesCuttingPolygon(
  state: NavMap,
  polygonEdges: string[]
): string[][] {
  const cuttingEdges: string[][] = [];

  // Get all points in the polygon
  const polygonPoints = new Set<string>();
  for (const edgeId of polygonEdges) {
    const edge = state.edges[edgeId];
    if (edge) {
      polygonPoints.add(edge.from);
      polygonPoints.add(edge.to);
    }
  }

  console.log("Polygon points:", polygonPoints);

  // Find single edges that cut across the polygon
  for (const [edgeId, edge] of Object.entries(state.edges)) {
    if (
      !polygonEdges.includes(edgeId) &&
      polygonPoints.has(edge.from) &&
      polygonPoints.has(edge.to)
    ) {
      cuttingEdges.push([edgeId]);
    }
  }

  // Find edge chains that cut across the polygon
  const cuttingChains = findEdgeChainsCuttingPolygon(
    state,
    polygonEdges,
    polygonPoints
  );
  cuttingEdges.push(...cuttingChains);

  return cuttingEdges;
}

function findEdgeChainsCuttingPolygon(
  state: NavMap,
  polygonEdges: string[],
  polygonPoints: Set<string>
): string[][] {
  const cuttingChains: string[][] = [];

  // For each pair of polygon points, see if there's a path between them
  // that doesn't use polygon edges
  for (const pointA of polygonPoints) {
    for (const pointB of polygonPoints) {
      if (pointA === pointB) continue;

      // Find shortest path between these points that avoids polygon edges
      const path = findShortestPathAvoidingEdges(
        state,
        pointA,
        pointB,
        polygonEdges
      );

      if (path && path.length > 1) {
        // This is a cutting chain
        cuttingChains.push(path);
      }
    }
  }

  return cuttingChains;
}

function findShortestPathAvoidingEdges(
  state: NavMap,
  fromPoint: string,
  toPoint: string,
  avoidEdges: string[]
): string[] | null {
  // Use BFS to find shortest path
  const queue: { point: string; path: string[] }[] = [
    { point: fromPoint, path: [] },
  ];
  const visited = new Set<string>([fromPoint]);

  while (queue.length > 0) {
    const { point, path } = queue.shift()!;

    if (point === toPoint) {
      // Validate the path - no duplicate edges
      const uniqueEdges = [...new Set(path)];
      if (uniqueEdges.length !== path.length) {
        console.log("Found path with duplicate edges, skipping:", path);
        continue;
      }
      return path;
    }

    // Find all edges connected to this point
    for (const [edgeId, edge] of Object.entries(state.edges)) {
      if (avoidEdges.includes(edgeId)) continue; // Skip polygon edges
      if (path.includes(edgeId)) continue; // Avoid cycles in path

      const nextPoint = edge.from === point ? edge.to : edge.from;
      if (visited.has(nextPoint)) continue;

      visited.add(nextPoint);
      queue.push({ point: nextPoint, path: [...path, edgeId] });
    }
  }

  return null;
}

function isPointInPolygon(
  point: THREE.Vector3,
  polygon: THREE.Vector3[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    if (
      polygon[i].z > point.z !== polygon[j].z > point.z &&
      point.x <
        ((polygon[j].x - polygon[i].x) * (point.z - polygon[i].z)) /
          (polygon[j].z - polygon[i].z) +
          polygon[i].x
    ) {
      inside = !inside;
    }
  }
  return inside;
}
