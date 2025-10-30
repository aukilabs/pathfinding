import earcut from "earcut";

import { NavMap, NavmeshGeometry, V3 } from "./NavgraphTypes";

export function calculateDistance(p1: V3, p2: V3): number {
  const dx = p2.x - p1.x;
  const dy = (p2.y ?? 0) - (p1.y ?? 0);
  const dz = p2.z - p1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function calculatePathLength(path: V3[]): number {
  if (path.length < 2) return 0;

  let totalLength = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalLength += calculateDistance(path[i], path[i + 1]);
  }
  return totalLength;
}

export function getClosestPointOnLineSegment(
  point: V3,
  lineStart: V3,
  lineEnd: V3
): V3 {
  const dx = lineEnd.x - lineStart.x;
  const dy = (lineEnd.y ?? 0) - (lineStart.y ?? 0);
  const dz = lineEnd.z - lineStart.z;

  const lengthSq = dx * dx + dy * dy + dz * dz;
  if (lengthSq === 0) return lineStart; // Line segment is a point

  // Calculate projection parameter t
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - lineStart.x) * dx +
        ((point.y ?? 0) - (lineStart.y ?? 0)) * dy +
        (point.z - lineStart.z) * dz) /
        lengthSq
    )
  );

  return {
    x: lineStart.x + t * dx,
    y: lineStart.y + t * dy,
    z: lineStart.z + t * dz,
  };
}

export function expandPolygon(polygon: V3[], expansionDistance: number): V3[] {
  if (polygon.length < 3) return polygon;

  const expanded: V3[] = [];

  for (let i = 0; i < polygon.length; i++) {
    const prev = polygon[(i - 1 + polygon.length) % polygon.length];
    const curr = polygon[i];
    const next = polygon[(i + 1) % polygon.length];

    // Calculate edge vectors
    const edge1 = {
      x: curr.x - prev.x,
      y: (curr.y ?? 0) - (prev.y ?? 0),
      z: curr.z - prev.z,
    };

    const edge2 = {
      x: next.x - curr.x,
      y: (next.y ?? 0) - (curr.y ?? 0),
      z: next.z - curr.z,
    };

    // Normalize edge vectors
    const len1 = Math.sqrt(
      edge1.x * edge1.x + edge1.y * edge1.y + edge1.z * edge1.z
    );
    const len2 = Math.sqrt(
      edge2.x * edge2.x + edge2.y * edge2.y + edge2.z * edge2.z
    );

    if (len1 === 0 || len2 === 0) {
      expanded.push(curr);
      continue;
    }

    const norm1 = {
      x: edge1.x / len1,
      y: edge1.y / len1,
      z: edge1.z / len1,
    };

    const norm2 = {
      x: edge2.x / len2,
      y: edge2.y / len2,
      z: edge2.z / len2,
    };

    // Calculate outward normal for each edge
    const normal1 = {
      x: -norm1.z,
      y: 0,
      z: norm1.x,
    };

    const normal2 = {
      x: -norm2.z,
      y: 0,
      z: norm2.x,
    };

    // Calculate bisector direction (average of the two normals)
    const bisector = {
      x: normal1.x + normal2.x,
      y: normal1.y + normal2.y,
      z: normal1.z + normal2.z,
    };

    // Normalize bisector
    const bisectorLen = Math.sqrt(
      bisector.x * bisector.x +
        bisector.y * bisector.y +
        bisector.z * bisector.z
    );

    if (bisectorLen === 0) {
      expanded.push(curr);
      continue;
    }

    const normalizedBisector = {
      x: bisector.x / bisectorLen,
      y: bisector.y / bisectorLen,
      z: bisector.z / bisectorLen,
    };

    // Calculate expansion distance based on angle between edges
    const dot = norm1.x * norm2.x + norm1.z * norm2.z;
    const angle = Math.acos(Math.max(-1, Math.min(1, dot)));

    // Clamp the angle to avoid division by very small numbers
    const clampedAngle = Math.max(0.01, Math.min(Math.PI - 0.01, angle));
    const expansionFactor = 1 / Math.sin(clampedAngle / 2);

    // Cap the expansion factor to prevent extreme values
    const cappedExpansionFactor = Math.min(expansionFactor, 1);

    // Apply expansion
    const expandedPoint = {
      x:
        curr.x +
        normalizedBisector.x * expansionDistance * cappedExpansionFactor,
      y: curr.y,
      z:
        curr.z +
        normalizedBisector.z * expansionDistance * cappedExpansionFactor,
    };

    expanded.push(expandedPoint);
  }

  return expanded;
}

export function triangulateArea(polygon: V3[]): V3[][] | null {
  // Convert polygon to 2D for earcut (project to XZ plane)
  const vertices2D: number[] = [];
  const vertices3D: V3[] = [];

  polygon.forEach((vertex, index) => {
    vertices2D.push(vertex.x, vertex.z); // X and Z coordinates
    vertices3D.push(vertex);
  });

  // Triangulate using earcut
  const triangles = earcut(vertices2D);

  if (!triangles || triangles.length === 0) {
    console.log("Earcut failed or returned empty result");
    return null;
  }

  // Convert back to 3D triangles and ensure counter-clockwise winding order
  const result: V3[][] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const triangle: V3[] = [];

    // For counter-clockwise winding order (facing upward), we need to reverse the order
    // earcut returns clockwise triangles, so we reverse them
    for (let j = 2; j >= 0; j--) {
      const vertexIndex = triangles[i + j];
      triangle.push(vertices3D[vertexIndex]);
    }

    result.push(triangle);
  }

  return result;
}

export function createMeshFromTriangles(
  areaId: string,
  triangles: V3[][]
): NavmeshGeometry | null {
  if (!triangles || triangles.length === 0) {
    console.log("Failed to triangulate area:", areaId);
    return null;
  }

  const vertices: number[] = [];
  const indices: number[] = [];

  triangles.forEach((triangle, triangleIndex) => {
    triangle.forEach((vertex) => {
      vertices.push(vertex.x, vertex.y ?? 0, vertex.z);
    });
    // Add indices for this triangle
    const baseIndex = triangleIndex * 3;
    indices.push(baseIndex, baseIndex + 1, baseIndex + 2);
  });

  return {
    positions: new Float32Array(vertices),
    indices: new Uint32Array(indices),
  };
}

export function buildPolygonFromEdges(
  edgeIds: string[],
  map: NavMap
): V3[] | null {
  if (!map) return null;

  // Build ordered polygon from area edges
  const edgeMap = new Map<string, { from: string; to: string }>();
  edgeIds.forEach((edgeId) => {
    const edge = map.edges[edgeId];
    if (edge) {
      edgeMap.set(edgeId, edge);
    }
  });

  // Find a starting edge and build the polygon
  const polygon: V3[] = [];
  const visited = new Set<string>();

  const firstEdgeId = edgeIds[0];
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
    currentEdgeId = edgeIds.find((eid) => {
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

export function isPointInPolygon(point: V3, polygon: V3[]): boolean {
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
