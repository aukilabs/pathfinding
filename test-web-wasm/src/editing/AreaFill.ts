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
  console.log("================================================");
  const splitTest = splitPolygonWithEdge(
    state,
    ["e58", "e59", "e50", "e45"],
    ["e57"]
  );

  console.log("================================================");

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

function findPointIdByPosition(
  state: NavMap,
  position: THREE.Vector3
): string | null {
  for (const [pointId, point] of Object.entries(state.points)) {
    if (
      Math.abs(point.x - position.x) < 0.001 &&
      Math.abs(point.z - position.z) < 0.001
    ) {
      return pointId;
    }
  }
  return null;
}

function pointsToEdges(state: NavMap, points: THREE.Vector3[]): string[] {
  const edges: string[] = [];

  for (let i = 0; i < points.length - 1; i++) {
    const currentPoint = points[i];
    const nextPoint = points[i + 1];

    const currentId = findPointIdByPosition(state, currentPoint);
    const nextId = findPointIdByPosition(state, nextPoint);

    if (currentId && nextId) {
      // Find the edge between these two points
      for (const [edgeId, edge] of Object.entries(state.edges)) {
        if (
          (edge.from === currentId && edge.to === nextId) ||
          (edge.from === nextId && edge.to === currentId)
        ) {
          edges.push(edgeId);
          break;
        }
      }
    }
  }

  return edges;
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

  // Convert polygon edges to points
  const polygonPoints = getPolygonPointsFromEdges(state, polygonEdges);
  console.log(
    "Polygon points:",
    polygonPoints.map((p) => `${p.x},${p.z}`)
  );

  // Find the indices of the cutting points in the polygon
  let fromIndex = -1;
  let toIndex = -1;

  for (let i = 0; i < polygonPoints.length; i++) {
    const point = polygonPoints[i];
    const pointId = findPointIdByPosition(state, point);

    if (pointId === cuttingFrom) {
      fromIndex = i;
    }
    if (pointId === cuttingTo) {
      toIndex = i;
    }
  }

  console.log("Found point indices:", fromIndex, toIndex);

  if (fromIndex === -1 || toIndex === -1) {
    console.log("Cutting edge chain endpoints not found in polygon");
    return [polygonEdges];
  }

  // Split the polygon points at the cutting points
  let polygon1Points: THREE.Vector3[];
  let polygon2Points: THREE.Vector3[];

  if (fromIndex < toIndex) {
    // Normal case: fromIndex comes before toIndex
    polygon1Points = polygonPoints.slice(fromIndex, toIndex + 1);
    polygon2Points = [
      ...polygonPoints.slice(toIndex),
      ...polygonPoints.slice(0, fromIndex + 1),
    ];
  } else {
    // Wrapped case: toIndex comes before fromIndex
    polygon1Points = [...polygonPoints.slice(toIndex, fromIndex + 1)];
    polygon2Points = [
      ...polygonPoints.slice(fromIndex),
      ...polygonPoints.slice(0, toIndex + 1),
    ];
  }

  console.log(
    "Polygon 1 points:",
    polygon1Points.map((p) => `${p.x},${p.z}`)
  );
  console.log(
    "Polygon 2 points:",
    polygon2Points.map((p) => `${p.x},${p.z}`)
  );

  // Convert points back to edges
  const result = [];
  if (polygon1Points.length >= 3) {
    const polygon1Edges = pointsToEdges(state, polygon1Points);
    console.log("Polygon 1 edges:", polygon1Edges);

    // Check if cutting edge chain needs to be reversed for this polygon
    const polygon1LastPoint = polygon1Points[polygon1Points.length - 1];
    const polygon1LastPointId = findPointIdByPosition(state, polygon1LastPoint);
    const cuttingEdgeStart = state.edges[cuttingEdgeChain[0]];

    let cuttingChainForPolygon1 = cuttingEdgeChain;
    if (cuttingEdgeStart && polygon1LastPointId !== cuttingEdgeStart.from) {
      // Need to reverse the cutting edge chain
      cuttingChainForPolygon1 = [...cuttingEdgeChain].reverse();
    }

    result.push([...polygon1Edges, ...cuttingChainForPolygon1]);
  }
  if (polygon2Points.length >= 3) {
    const polygon2Edges = pointsToEdges(state, polygon2Points);
    console.log("Polygon 2 edges:", polygon2Edges);

    // Check if cutting edge chain needs to be reversed for this polygon
    const polygon2LastPoint = polygon2Points[polygon2Points.length - 1];
    const polygon2LastPointId = findPointIdByPosition(state, polygon2LastPoint);
    const cuttingEdgeStart = state.edges[cuttingEdgeChain[0]];

    let cuttingChainForPolygon2 = cuttingEdgeChain;
    if (cuttingEdgeStart && polygon2LastPointId !== cuttingEdgeStart.from) {
      // Need to reverse the cutting edge chain
      cuttingChainForPolygon2 = [...cuttingEdgeChain].reverse();
    }

    result.push([...polygon2Edges, ...cuttingChainForPolygon2]);
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

  // Only look for paths between non-adjacent polygon points
  // Adjacent points would just go around the edge
  const polygonPointArray = Array.from(polygonPoints);

  for (let i = 0; i < polygonPointArray.length; i++) {
    for (let j = i + 2; j < polygonPointArray.length; j++) {
      const pointA = polygonPointArray[i];
      const pointB = polygonPointArray[j];

      // Skip if these points are adjacent in the polygon
      if (arePointsAdjacentInPolygon(state, pointA, pointB, polygonEdges)) {
        continue;
      }

      console.log("Finding shortest path from", pointA, "to", pointB);
      // Find shortest path between these non-adjacent points
      const path = findShortestPathAvoidingEdges(
        state,
        pointA,
        pointB,
        polygonEdges
      );

      if (path && path.length > 1) {
        console.log("Path found from", pointA, "to", pointB, ":", path);

        // Verify the path actually connects the points
        const firstEdge = state.edges[path[0]];
        const lastEdge = state.edges[path[path.length - 1]];
        console.log("First edge:", firstEdge, "Last edge:", lastEdge);

        if (!firstEdge || !lastEdge) {
          console.log("Invalid path - missing edges");
          continue;
        }

        if (
          (firstEdge.from == pointA || firstEdge.to == pointB) &&
          (lastEdge.from == pointB || lastEdge.to == pointB)
        ) {
          if (edgeChainCutsThroughPolygon(state, path, polygonEdges)) {
            cuttingChains.push(path);
          }
        } else {
          console.log("Path doesn't connect the requested points!");
        }
      }
    }
  }
  return cuttingChains;
}

function arePointsAdjacentInPolygon(
  state: NavMap,
  pointA: string,
  pointB: string,
  polygonEdges: string[]
): boolean {
  // Check if there's a direct edge between these points in the polygon
  return polygonEdges.some((edgeId) => {
    const edge = state.edges[edgeId];
    return (
      edge &&
      ((edge.from === pointA && edge.to === pointB) ||
        (edge.from === pointB && edge.to === pointA))
    );
  });
}

function edgeChainCutsThroughPolygon(
  state: NavMap,
  edgeChain: string[],
  polygonEdges: string[]
): boolean {
  if (edgeChain.length === 0) return false;

  // Get polygon points for point-in-polygon testing
  const polygonPoints = getPolygonPointsFromEdges(state, polygonEdges);
  if (polygonPoints.length < 3) return false;

  // Check if any point of the edge chain is outside the polygon
  for (let i = 0; i < edgeChain.length; i++) {
    const edge = state.edges[edgeChain[i]];
    if (!edge) continue;

    // Test the midpoint of this edge
    const fromPoint = state.points[edge.from];
    const toPoint = state.points[edge.to];

    if (!fromPoint || !toPoint) continue;

    // Calculate midpoint
    const midpoint = new THREE.Vector3(
      (fromPoint.x + toPoint.x) / 2,
      (fromPoint.y + toPoint.y) / 2,
      (fromPoint.z + toPoint.z) / 2
    );

    // If midpoint is outside polygon, this chain goes around
    if (!isPointInPolygon(midpoint, polygonPoints)) {
      console.log(
        "Edge chain goes around polygon (midpoint outside):",
        edgeChain
      );
      return false;
    }
  }

  console.log(
    "Edge chain cuts through polygon (all midpoints inside):",
    edgeChain
  );
  return true;
}

function findShortestPathAvoidingEdges(
  state: NavMap,
  fromPoint: string,
  toPoint: string,
  avoidEdges: string[]
): string[] | null {
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
        continue;
      }
      return path;
    }

    // Construct neighbors first - only edges actually connected to this point
    const neighbors = Object.entries(state.edges).filter(
      ([edgeId, edge]) =>
        (edge.from === point || edge.to === point) &&
        !avoidEdges.includes(edgeId) &&
        !path.includes(edgeId)
    );

    // Now only process the actual neighbors
    for (const [edgeId, edge] of neighbors) {
      const nextPoint = edge.from === point ? edge.to : edge.from;

      if (visited.has(nextPoint)) {
        continue;
      }

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
