import {
  NavMap,
  Edge,
  Point,
  Area,
  buildPolygonFromEdges,
} from "auki-pathfinding";
import { getClosestPointOnLineSegment } from "auki-pathfinding";
import * as THREE from "three";
import {
  EDGE_DRAWING_CONSTANTS,
  AreaSplitBehavior,
} from "./EdgeDrawingConstants";

// Types for edge drawing operations
export type EdgeIntersection = {
  edgeId: string;
  intersectionPoint: THREE.Vector3;
  splitSegments: Edge[];
};

export type EdgeWithId = Edge & { id: string };

export type AreaSplit = {
  areaId: string;
  newArea1: Area;
  newArea2: Area;
};

export type DrawingPreview = {
  snapTarget: string | null;
  snapType: "point" | "edge" | null;
  snapPosition: THREE.Vector3 | null;
  intersections: EdgeIntersection[];
  areaSplits: AreaSplit[];
  previewPoints: THREE.Vector3[];
};

export type EdgeCreationResult = {
  edgeId: string;
  edge: Edge;
  newPoints: { id: string; point: Point }[];
  splitEdges: { originalEdgeId: string; newEdges: EdgeWithId[] }[];
  areaSplitBehavior: AreaSplitBehavior;
};

// Core helper functions
export function findNearbyPoint(
  state: NavMap,
  position: THREE.Vector3,
  maxDistance: number = EDGE_DRAWING_CONSTANTS.POINT_SNAP_DISTANCE
): string | null {
  let closestPointId: string | null = null;
  let minDistance = maxDistance;

  for (const [pointId, point] of Object.entries(state.points)) {
    const distance = Math.sqrt(
      Math.pow(point.x - position.x, 2) + Math.pow(point.z - position.z, 2)
    );
    if (distance < minDistance) {
      minDistance = distance;
      closestPointId = pointId;
    }
  }

  return closestPointId;
}

export function findNearbyEdge(
  state: NavMap,
  position: THREE.Vector3,
  maxDistance: number = EDGE_DRAWING_CONSTANTS.EDGE_SNAP_DISTANCE
): { edgeId: string; snapPoint: THREE.Vector3 } | null {
  let closestEdgeId: string | null = null;
  let closestSnapPoint: THREE.Vector3 | null = null;
  let minDistance = maxDistance;

  for (const [edgeId, edge] of Object.entries(state.edges)) {
    const fromPoint = state.points[edge.from];
    const toPoint = state.points[edge.to];
    if (!fromPoint || !toPoint) continue;

    const snapPoint = getClosestPointOnLineSegment(
      position,
      fromPoint,
      toPoint
    );
    const distance = position.distanceTo(snapPoint);

    if (distance < minDistance) {
      minDistance = distance;
      closestEdgeId = edgeId;
      closestSnapPoint = new THREE.Vector3(
        snapPoint.x,
        snapPoint.y ?? 0,
        snapPoint.z
      );
    }
  }

  return closestEdgeId && closestSnapPoint
    ? { edgeId: closestEdgeId, snapPoint: closestSnapPoint }
    : null;
}

export function detectEdgeIntersections(
  state: NavMap,
  from: THREE.Vector3,
  to: THREE.Vector3,
  excludeFromPoint?: string,
  excludeToPoint?: string
): EdgeIntersection[] {
  const intersections: EdgeIntersection[] = [];

  for (const [edgeId, edge] of Object.entries(state.edges)) {
    // Skip edges connected to the snapped points to avoid false intersections
    if (
      excludeFromPoint &&
      (edge.from === excludeFromPoint || edge.to === excludeFromPoint)
    ) {
      continue;
    }
    if (
      excludeToPoint &&
      (edge.from === excludeToPoint || edge.to === excludeToPoint)
    ) {
      continue;
    }
    const edgeFrom = state.points[edge.from];
    const edgeTo = state.points[edge.to];
    if (!edgeFrom || !edgeTo) continue;

    const intersection = getLineIntersection(
      from,
      to,
      new THREE.Vector3(edgeFrom.x, edgeFrom.y ?? 0, edgeFrom.z),
      new THREE.Vector3(edgeTo.x, edgeTo.y ?? 0, edgeTo.z)
    );

    if (intersection) {
      // Create split segments
      const splitSegments = [
        { from: edge.from, to: `p_intersection_${edgeId}_1` },
        { from: `p_intersection_${edgeId}_1`, to: edge.to },
      ];

      intersections.push({
        edgeId,
        intersectionPoint: intersection,
        splitSegments,
      });
    }
  }

  return intersections;
}

export function detectAreaSplits(
  state: NavMap,
  from: THREE.Vector3,
  to: THREE.Vector3
): AreaSplit[] {
  const splits: AreaSplit[] = [];

  // Find edges that the new edge intersects with
  const intersections = detectEdgeIntersections(state, from, to);
  const intersectedEdgeIds = intersections.map((i) => i.edgeId);

  // Check each area to see if it contains multiple intersected edges
  for (const [areaId, area] of Object.entries(state.areas)) {
    if (!area.edges || area.edges.length < 3) continue;

    // Count how many edges of this area are being intersected
    const intersectedAreaEdges = area.edges.filter((edgeId) =>
      intersectedEdgeIds.includes(edgeId)
    );

    // If we're intersecting 2 or more edges of the same area, it's a split
    if (intersectedAreaEdges.length >= 2) {
      // Add to splits for preview highlighting
      splits.push({
        areaId,
        newArea1: { edges: [] }, // Placeholder - not used for preview
        newArea2: { edges: [] }, // Placeholder - not used for preview
      });
    }
  }

  return splits;
}

export function getDrawingPreview(
  state: NavMap,
  firstPoint: THREE.Vector3,
  currentPosition: THREE.Vector3
): DrawingPreview {
  // Check point snap first
  const nearbyPoint = findNearbyPoint(state, currentPosition);
  if (nearbyPoint) {
    const point = state.points[nearbyPoint];
    return {
      snapTarget: nearbyPoint,
      snapType: "point",
      snapPosition: new THREE.Vector3(point.x, point.y ?? 0, point.z),
      intersections: [],
      areaSplits: [],
      previewPoints: [
        firstPoint,
        new THREE.Vector3(point.x, point.y ?? 0, point.z),
      ],
    };
  }

  // Check edge snap second
  const nearbyEdge = findNearbyEdge(state, currentPosition);
  if (nearbyEdge) {
    const intersections = detectEdgeIntersections(
      state,
      firstPoint,
      nearbyEdge.snapPoint
    );
    const areaSplits = detectAreaSplits(
      state,
      firstPoint,
      nearbyEdge.snapPoint
    );

    return {
      snapTarget: nearbyEdge.edgeId,
      snapType: "edge",
      snapPosition: nearbyEdge.snapPoint,
      intersections,
      areaSplits,
      previewPoints: [firstPoint, nearbyEdge.snapPoint],
    };
  }

  // Free drawing
  const intersections = detectEdgeIntersections(
    state,
    firstPoint,
    currentPosition
  );
  const areaSplits = detectAreaSplits(state, firstPoint, currentPosition);

  return {
    snapTarget: null,
    snapType: null,
    snapPosition: null,
    intersections,
    areaSplits,
    previewPoints: [firstPoint, currentPosition],
  };
}

export function createEdgeWithIntersections(
  state: NavMap,
  from: THREE.Vector3,
  to: THREE.Vector3,
  areaSplitBehavior: AreaSplitBehavior = "split_areas"
): EdgeCreationResult {
  const edgeId = `e${Date.now()}`;
  const newPoints: { id: string; point: Point }[] = [];
  const splitEdges: { originalEdgeId: string; newEdges: EdgeWithId[] }[] = [];

  // Check if we need to create new points
  const nearbyPointFrom = findNearbyPoint(state, from);
  const nearbyPointTo = findNearbyPoint(state, to);

  // Check if we're snapping to edges (for forced intersection detection)
  const nearbyEdgeFrom = findNearbyEdge(state, from);
  const nearbyEdgeTo = findNearbyEdge(state, to);

  let fromPointId: string;
  let toPointId: string;

  // Handle intersections first - use the actual point positions for intersection detection
  const fromPointPos = nearbyPointFrom
    ? new THREE.Vector3(
        state.points[nearbyPointFrom].x,
        state.points[nearbyPointFrom].y ?? 0,
        state.points[nearbyPointFrom].z
      )
    : from;
  const toPointPos = nearbyPointTo
    ? new THREE.Vector3(
        state.points[nearbyPointTo].x,
        state.points[nearbyPointTo].y ?? 0,
        state.points[nearbyPointTo].z
      )
    : to;

  // Get geometric intersections
  const intersections = detectEdgeIntersections(
    state,
    fromPointPos,
    toPointPos,
    nearbyPointFrom || undefined,
    nearbyPointTo || undefined
  );

  // Add forced intersections for edges we're snapping to
  const forcedIntersections: EdgeIntersection[] = [];

  // Get set of edges already detected by geometric intersection
  const geometricallyDetectedEdges = new Set(
    intersections.map((i) => i.edgeId)
  );

  if (nearbyEdgeFrom && !nearbyPointFrom) {
    // We're snapping to an edge from the start point
    forcedIntersections.push({
      edgeId: nearbyEdgeFrom.edgeId,
      intersectionPoint: nearbyEdgeFrom.snapPoint,
      splitSegments: [
        {
          from: state.edges[nearbyEdgeFrom.edgeId].from,
          to: `p_intersection_${nearbyEdgeFrom.edgeId}_1`,
        },
        {
          from: `p_intersection_${nearbyEdgeFrom.edgeId}_1`,
          to: state.edges[nearbyEdgeFrom.edgeId].to,
        },
      ],
    });
  }

  if (nearbyEdgeTo && !nearbyPointTo) {
    // We're snapping to an edge at the end point
    forcedIntersections.push({
      edgeId: nearbyEdgeTo.edgeId,
      intersectionPoint: nearbyEdgeTo.snapPoint,
      splitSegments: [
        {
          from: state.edges[nearbyEdgeTo.edgeId].from,
          to: `p_intersection_${nearbyEdgeTo.edgeId}_1`,
        },
        {
          from: `p_intersection_${nearbyEdgeTo.edgeId}_1`,
          to: state.edges[nearbyEdgeTo.edgeId].to,
        },
      ],
    });
  }

  // Combine geometric and forced intersections, removing duplicates
  const allIntersections = [...intersections];

  // Add forced intersections only if not already detected geometrically
  for (const forcedIntersection of forcedIntersections) {
    if (!geometricallyDetectedEdges.has(forcedIntersection.edgeId)) {
      allIntersections.push(forcedIntersection);
    }
  }

  const intersectionPoints: { id: string; point: Point }[] = [];

  for (const intersection of allIntersections) {
    // Add intersection point
    const intersectionPointId = `p_intersection_${intersection.edgeId}_1`;
    intersectionPoints.push({
      id: intersectionPointId,
      point: {
        x: intersection.intersectionPoint.x,
        y: 0,
        z: intersection.intersectionPoint.z,
      },
    });

    // Create split edges for the intersected edge
    const newEdges = intersection.splitSegments.map((segment, index) => ({
      id: `e_split_${intersection.edgeId}_${index}`,
      from:
        segment.from === intersection.edgeId
          ? intersectionPointId
          : segment.from,
      to: segment.to === intersection.edgeId ? intersectionPointId : segment.to,
    }));

    splitEdges.push({
      originalEdgeId: intersection.edgeId,
      newEdges,
    });
  }

  // Determine the final point IDs - use intersection points if we snapped to edges
  if (nearbyPointFrom) {
    fromPointId = nearbyPointFrom;
  } else if (nearbyEdgeFrom && !nearbyPointFrom) {
    // We snapped to an edge from the start, use the intersection point
    fromPointId = `p_intersection_${nearbyEdgeFrom.edgeId}_1`;
  } else {
    // Free drawing, create new point
    fromPointId = `p${Date.now()}_1`;
    newPoints.push({
      id: fromPointId,
      point: { x: from.x, y: 0, z: from.z },
    });
  }

  if (nearbyPointTo) {
    toPointId = nearbyPointTo;
  } else if (nearbyEdgeTo && !nearbyPointTo) {
    // We snapped to an edge, use the intersection point
    toPointId = `p_intersection_${nearbyEdgeTo.edgeId}_1`;
  } else {
    // Free drawing, create new point
    toPointId = `p${Date.now()}_2`;
    newPoints.push({
      id: toPointId,
      point: { x: to.x, y: 0, z: to.z },
    });
  }

  // Add intersection points to newPoints
  newPoints.push(...intersectionPoints);

  // Create the main edge - if there are intersections, split it too
  let edge: Edge;
  if (allIntersections.length === 0) {
    // No intersections, create single edge
    edge = { from: fromPointId, to: toPointId };
    return {
      edgeId,
      edge,
      newPoints,
      splitEdges,
      areaSplitBehavior,
    };
  } else {
    // Has intersections, split the main edge
    const mainEdgeSegments: EdgeWithId[] = [];
    let currentFrom = fromPointId;

    // Sort intersections by distance from start point
    const sortedIntersections = allIntersections.sort((a, b) => {
      const distA = from.distanceTo(a.intersectionPoint);
      const distB = from.distanceTo(b.intersectionPoint);
      return distA - distB;
    });

    for (const intersection of sortedIntersections) {
      const intersectionPointId = `p_intersection_${intersection.edgeId}_1`;

      // Create segment from current point to intersection (only if they're different)
      if (currentFrom !== intersectionPointId) {
        mainEdgeSegments.push({
          id: `e_main_${edgeId}_${mainEdgeSegments.length}`,
          from: currentFrom,
          to: intersectionPointId,
        });
      }

      currentFrom = intersectionPointId;
    }

    // Create final segment from last intersection to end point (only if they're different)
    if (currentFrom !== toPointId) {
      mainEdgeSegments.push({
        id: `e_main_${edgeId}_${mainEdgeSegments.length}`,
        from: currentFrom,
        to: toPointId,
      });
    }

    // Add main edge segments to splitEdges (treating the main edge as "split")
    splitEdges.push({
      originalEdgeId: edgeId, // This will be the main edge ID
      newEdges: mainEdgeSegments,
    });

    edge = mainEdgeSegments[0]; // Return first segment as the "main" edge
    return {
      edgeId,
      edge,
      newPoints,
      splitEdges,
      areaSplitBehavior,
    };
  }
}

// Helper functions for geometric calculations
function getLineIntersection(
  p1: THREE.Vector3,
  p2: THREE.Vector3,
  p3: THREE.Vector3,
  p4: THREE.Vector3
): THREE.Vector3 | null {
  // Line intersection algorithm
  const denom = (p1.x - p2.x) * (p3.z - p4.z) - (p1.z - p2.z) * (p3.x - p4.x);
  if (Math.abs(denom) < EDGE_DRAWING_CONSTANTS.INTERSECTION_TOLERANCE) {
    return null; // Lines are parallel
  }

  const t =
    ((p1.x - p3.x) * (p3.z - p4.z) - (p1.z - p3.z) * (p3.x - p4.x)) / denom;
  const u =
    -((p1.x - p2.x) * (p1.z - p3.z) - (p1.z - p2.z) * (p1.x - p3.x)) / denom;

  // Check if intersection is within both line segments
  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return new THREE.Vector3(
      p1.x + t * (p2.x - p1.x),
      0,
      p1.z + t * (p2.z - p1.z)
    );
  }

  return null;
}

function isPointInPolygon(
  point: THREE.Vector3Like,
  polygon: THREE.Vector3Like[]
): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const vi = polygon[i];
    const vj = polygon[j];

    if (
      vi.z > point.z !== vj.z > point.z &&
      point.x < ((vj.x - vi.x) * (point.z - vi.z)) / (vj.z - vi.z) + vi.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

// Remove the duplicate function since we're importing it from auki-pathfinding
