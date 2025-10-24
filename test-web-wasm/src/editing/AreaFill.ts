import {
  buildPolygonFromEdges,
  getClosestPointOnLineSegment,
  NavMap,
} from "auki-pathfinding";
import * as THREE from "three";

export function findSmallestUnfilledAreaContainingPoint(
  state: NavMap,
  clickPoint: THREE.Vector3
): { edges: string[] } | null {
  // Find the smallest polygon containing the click point
  const smallestPolygon = findSmallestPolygonContainingPoint(state, clickPoint);

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
    const polygonPoints = buildPolygonFromEdges(area.edges, state);
    if (!polygonPoints) {
      console.error("Failed to build polygon from edges");
      continue;
    }

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
  //console.log("Finding polygon by right hand rule");
  // 1. Find the closest edge to the click point
  const closestEdge = findClosestEdge(state, clickPoint);
  if (!closestEdge) return null;

  console.log("Closest edge:", closestEdge, clickPoint);

  // 2. Determine which endpoint to start from based on click point position
  const leftPoint = determineStartPoint(state, closestEdge, clickPoint);
  const rightPoint =
    leftPoint === closestEdge.from ? closestEdge.to : closestEdge.from;

  console.log("Left point:", leftPoint);
  console.log("Right point:", rightPoint);

  const polygon = findPolygonFromLeftRightPoint(
    closestEdge.id,
    leftPoint,
    rightPoint,
    state
  );

  // Verify the polygon contains the click point
  if (polygon && polygon.length >= 3) {
    const polygonPoints = buildPolygonFromEdges(polygon, state);
    if (!polygonPoints) {
      console.error("Failed to build polygon from edges");
      return null;
    }
    // console.log("Polygon points:", polygonPoints);
    const containsPoint = isPointInPolygon(clickPoint, polygonPoints);

    if (containsPoint) {
      //   console.log("Polygon contains click point!");
      return polygon;
    } else {
      //   console.log("Polygon does not contain click point!");
    }
  }

  return null;
}

export function findPolygonFromLeftRightPoint(
  edgeId: string,
  leftPoint: string,
  rightPoint: string,
  state: NavMap
) {
  let currentPoint = leftPoint;
  let currentEdge = edgeId;
  const polygon = [currentEdge];
  const edgeTraversalCount = new Map<string, number>();
  edgeTraversalCount.set(currentEdge, 1);
  let iterations = 0;
  const maxIterations = 50; // Prevent infinite loops

  while (iterations < maxIterations) {
    iterations++;

    // Find the leftmost edge from current point
    let nextEdge = findLeftmostEdge(
      state,
      currentPoint,
      currentEdge,
      edgeTraversalCount
    );
    // console.log("Next edge:", nextEdge);

    // Debug: show all edges connected to current point
    const connectedEdges = Object.entries(state.edges).filter(
      ([_, e]) => e.from === currentPoint || e.to === currentPoint
    );
    console.log(
      `Edges connected to ${currentPoint}:`,
      connectedEdges.map(([id, _]) => id)
    );

    // Check if the next edge leads to a dead-end BEFORE adding it to the polygon
    if (nextEdge) {
      const nextPoint =
        nextEdge.from === currentPoint ? nextEdge.to : nextEdge.from;
      const nextPointEdges = Object.values(state.edges).filter(
        (e) => e.from === nextPoint || e.to === nextPoint
      );

      // If the next point has only 1 connection, it's a dead-end
      if (nextPointEdges.length <= 1) {
        console.log(
          `Skipping dead-end edge: ${nextEdge.id} (leads to point with ${nextPointEdges.length} connections)`
        );
        nextEdge = null; // Treat as if no edge was found
      }
    }

    if (nextEdge == null) {
      //traverse the current edge in the opposite direction
      console.log("Backtracking from dead-end at:", currentPoint);
      const edge = state.edges[currentEdge];
      currentPoint = edge.from === currentPoint ? edge.to : edge.from;
      console.log("Backtracked to:", currentPoint);

      // Mark the current edge as traversed (since we're backtracking through it)
      const backtrackCount = edgeTraversalCount.get(currentEdge) || 0;
      edgeTraversalCount.set(currentEdge, backtrackCount + 1);

      continue; // Try again from the new position
    }

    // Count edge traversals
    const currentCount = edgeTraversalCount.get(nextEdge.id) || 0;

    // If we've already traversed this edge twice, skip it (dead-end detected)
    if (currentCount >= 2) {
      console.log(`Skipping dead-end edge: ${nextEdge.id}`);
      continue;
    }

    edgeTraversalCount.set(nextEdge.id, currentCount + 1);
    console.log(`Edge ${nextEdge.id} traversal count: ${currentCount + 1}`);

    // Only add edge to polygon on first traversal
    if (currentCount === 0) {
      polygon.push(nextEdge.id);
    }
    currentPoint = nextEdge.from === currentPoint ? nextEdge.to : nextEdge.from;
    currentEdge = nextEdge.id;

    // Check if we've returned to the starting point
    if (currentPoint === rightPoint) {
      console.log("Returned to starting point, polygon complete");

      // Filter out edges that were traversed multiple times (dead-end trees)
      const cleanPolygon = polygon.filter((edgeId) => {
        const traversalCount = edgeTraversalCount.get(edgeId) || 0;
        return traversalCount === 1; // Only include edges traversed exactly once
      });

      console.log("Original polygon:", polygon);
      console.log("Clean polygon:", cleanPolygon);
      return cleanPolygon;
    }
  }

  //   console.log("Left-hand rule polygon:", polygon);

  return null;
}

function findClosestEdge(
  state: NavMap,
  clickPoint: THREE.Vector3
): { id: string; from: string; to: string } | null {
  let closestEdge = null;
  let minDistance = Infinity;

  for (const [edgeId, edge] of Object.entries(state.edges)) {
    const fromPoint = state.points[edge.from];
    const toPoint = state.points[edge.to];
    if (!fromPoint || !toPoint) continue;

    // Skip edges that have dead-end endpoints
    const fromPointEdges = Object.values(state.edges).filter(
      (e) => e.from === edge.from || e.to === edge.from
    );
    const toPointEdges = Object.values(state.edges).filter(
      (e) => e.from === edge.to || e.to === edge.to
    );

    if (fromPointEdges.length <= 1 || toPointEdges.length <= 1) {
      console.log(`Skipping dead-end edge: ${edgeId}`);
      continue;
    }

    const closestPoint = getClosestPointOnLineSegment(
      clickPoint,
      fromPoint,
      toPoint
    );
    const distance = clickPoint.distanceTo(closestPoint);

    if (distance < minDistance) {
      minDistance = distance;
      closestEdge = { id: edgeId, from: edge.from, to: edge.to };
    }
  }

  return closestEdge;
}

function determineStartPoint(
  state: NavMap,
  edge: { id: string; from: string; to: string },
  clickPoint: THREE.Vector3
): string {
  const fromPoint = state.points[edge.from];
  const toPoint = state.points[edge.to];
  if (!fromPoint || !toPoint) return edge.from;

  // Calculate the direction from click point to each endpoint
  const toFromDirection = new THREE.Vector3(
    fromPoint.x - clickPoint.x,
    0,
    fromPoint.z - clickPoint.z
  ).normalize();

  // Calculate the edge direction
  const edgeDirection = new THREE.Vector3(
    toPoint.x - fromPoint.x,
    0,
    toPoint.z - fromPoint.z
  ).normalize();

  // Determine which endpoint is "left" of the edge from click point's perspective
  // We want to start from the endpoint that makes the edge go "left" relative to click point
  const fromCrossProduct =
    toFromDirection.z * edgeDirection.x - toFromDirection.x * edgeDirection.z;

  // If fromCrossProduct > 0, click point is to the right of the edge when going from->to
  // If toCrossProduct < 0, click point is to the right of the edge when going to->from
  if (fromCrossProduct > 0) {
    return edge.to; // Start from 'to' point, edge goes right
  } else {
    return edge.from; // Start from 'from' point, edge goes left
  }
}

function findLeftmostEdge(
  state: NavMap,
  fromPoint: string,
  previousEdgeId: string,
  edgeTraversalCount: Map<string, number>
): { id: string; from: string; to: string } | null {
  const fromPointData = state.points[fromPoint];
  if (!fromPointData) return null;

  const previousEdge = state.edges[previousEdgeId];
  if (!previousEdge) return null;

  // Get the direction vector of the previous edge
  const prevToPoint =
    state.points[
      fromPoint === previousEdge.from ? previousEdge.to : previousEdge.from
    ];
  const prevFromPoint =
    state.points[
      fromPoint === previousEdge.from ? previousEdge.from : previousEdge.to
    ];
  if (!prevToPoint || !prevFromPoint) return null;

  // Calculate the incoming direction (towards fromPoint)
  const incomingDirection = new THREE.Vector3(
    fromPointData.x - prevToPoint.x,
    0,
    fromPointData.z - prevToPoint.z
  ).normalize();

  let leftmostEdge = null;
  let minAngle = Infinity;

  // Find all edges connected to fromPoint
  for (const [edgeId, edge] of Object.entries(state.edges)) {
    if (edgeId === previousEdgeId) continue; // Skip the edge we came from

    // Skip edges that have been traversed more than twice (dead-end edges)
    const traversalCount = edgeTraversalCount.get(edgeId) || 0;
    if (traversalCount >= 2) continue;

    // Skip edges that lead to dead-ends (points with only 1 connection)
    const nextPoint = edge.from === fromPoint ? edge.to : edge.from;
    const nextPointEdges = Object.values(state.edges).filter(
      (e) => e.from === nextPoint || e.to === nextPoint
    );
    if (nextPointEdges.length <= 1) {
      console.log(`Skipping dead-end edge in findLeftmostEdge: ${edgeId}`);
      continue;
    }

    let outgoingDirection: THREE.Vector3;
    if (edge.from === fromPoint) {
      const toPoint = state.points[edge.to];
      if (!toPoint) continue;
      outgoingDirection = new THREE.Vector3(
        toPoint.x - fromPointData.x,
        0,
        toPoint.z - fromPointData.z
      ).normalize();
    } else if (edge.to === fromPoint) {
      const fromPointOther = state.points[edge.from];
      if (!fromPointOther) continue;
      outgoingDirection = new THREE.Vector3(
        fromPointOther.x - fromPointData.x,
        0,
        fromPointOther.z - fromPointData.z
      ).normalize();
    } else {
      continue; // Edge not connected to fromPoint
    }

    // Calculate the angle between incoming and outgoing directions
    // We want the leftmost turn (most counter-clockwise)
    const angle = Math.atan2(
      outgoingDirection.z * incomingDirection.x -
        outgoingDirection.x * incomingDirection.z,
      outgoingDirection.x * incomingDirection.x +
        outgoingDirection.z * incomingDirection.z
    );

    console.log(
      `Edge ${edgeId}: angle=${angle.toFixed(3)}, minAngle=${minAngle.toFixed(
        3
      )}`
    );

    if (angle < minAngle) {
      minAngle = angle;
      leftmostEdge = { id: edgeId, from: edge.from, to: edge.to };
      console.log(`New leftmost edge: ${edgeId}`);
    }
  }

  return leftmostEdge;
}

function isPointInPolygon(
  point: THREE.Vector3Like,
  polygon: THREE.Vector3Like[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i];
    const vj = polygon[j];

    // Check if ray from point crosses this edge
    if (
      vi.z > point.z !== vj.z > point.z &&
      point.x < ((vj.x - vi.x) * (point.z - vi.z)) / (vj.z - vi.z) + vi.x
    ) {
      inside = !inside;
    }
  }

  return inside;
}
