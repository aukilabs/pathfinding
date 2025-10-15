import earcut from "earcut";
import * as THREE from "three";

export function calculateDistance(
  p1: THREE.Vector3Like,
  p2: THREE.Vector3Like
): number {
  const dx = p2.x - p1.x;
  const dy = (p2.y ?? 0) - (p1.y ?? 0);
  const dz = p2.z - p1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

export function calculatePathLength(path: THREE.Vector3Like[]): number {
  if (path.length < 2) return 0;

  let totalLength = 0;
  for (let i = 0; i < path.length - 1; i++) {
    totalLength += calculateDistance(path[i], path[i + 1]);
  }
  return totalLength;
}

export function getClosestPointOnLineSegment(
  point: THREE.Vector3Like,
  lineStart: THREE.Vector3Like,
  lineEnd: THREE.Vector3Like
): THREE.Vector3Like {
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

export function isPointInPolygon(
  point: THREE.Vector3Like,
  vertices: THREE.Vector3Like[]
): boolean {
  if (vertices.length < 3) return false;

  let inside = false;
  const x = point.x;
  const z = point.z; // Using XZ plane for 2D polygon test

  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].x;
    const zi = vertices[i].z;
    const xj = vertices[j].x;
    const zj = vertices[j].z;

    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) {
      inside = !inside;
    }
  }

  return inside;
}

export function isPointOnEdge(
  point: THREE.Vector3Like,
  edgeStart: THREE.Vector3Like,
  edgeEnd: THREE.Vector3Like,
  tolerance: number = 0.1
): boolean {
  // Check if point is on the line segment
  const closestPoint = getClosestPointOnLineSegment(point, edgeStart, edgeEnd);
  const distance = calculateDistance(point, closestPoint);

  return distance < tolerance;
}

export function pointsAreEqual(
  p1: THREE.Vector3Like,
  p2: THREE.Vector3Like
): boolean {
  const tolerance = 0.001;
  return (
    Math.abs(p1.x - p2.x) < tolerance &&
    Math.abs((p1.y ?? 0) - (p2.y ?? 0)) < tolerance &&
    Math.abs(p1.z - p2.z) < tolerance
  );
}

export function expandPolygon(
  polygon: THREE.Vector3Like[],
  expansionDistance: number
): THREE.Vector3Like[] {
  if (polygon.length < 3) return polygon;

  const expanded: THREE.Vector3Like[] = [];

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

export function triangulateArea(
  polygon: THREE.Vector3Like[]
): THREE.Vector3Like[][] | null {
  // Convert polygon to 2D for earcut (project to XZ plane)
  const vertices2D: number[] = [];
  const vertices3D: THREE.Vector3Like[] = [];

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
  const result: THREE.Vector3Like[][] = [];
  for (let i = 0; i < triangles.length; i += 3) {
    const triangle: THREE.Vector3Like[] = [];

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
  triangles: THREE.Vector3Like[][]
): THREE.Mesh | null {
  if (!triangles || triangles.length === 0) {
    console.log("Failed to triangulate area:", areaId);
    return null;
  }

  // Create geometry from triangles
  const geometry = new THREE.BufferGeometry();
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

  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3)
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
  mesh.name = areaId;
  return mesh;
}
