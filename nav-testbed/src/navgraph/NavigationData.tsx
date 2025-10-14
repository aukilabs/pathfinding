import * as THREE from "three";
import earcut from "earcut";
import * as geometryUtils from "./GeometryUtils";

export type EdgeDirection = 1 | 0 | -1 | undefined;
export type Point = { x: number; y: number; z: number };
export type Edge = {
  from: string;
  to: string;
  dir?: EdgeDirection;
};
export type Area = { points: string[] };
export type Points = Record<string, Point>;
export type Edges = Record<string, Edge>;
export type Areas = Record<string, Area>;
export type NavMap = { points: Points; edges: Edges; areas: Areas };

export class NavigationData {
  private map: NavMap;
  private legacyAreaMeshes: THREE.Mesh[];

  private areaMeshes: Record<string, THREE.Mesh> = {};

  get meshes() {
    return this.areaMeshes;
  }

  get points() {
    return this.map.points;
  }

  get edges() {
    return this.map.edges;
  }

  get areas() {
    return this.map.areas;
  }

  get legacyNavmesh() {
    return this.legacyAreaMeshes;
  }

  virtualAreas = {};

  constructor(map: NavMap, legacyNavmesh: THREE.Mesh[]) {
    this.map = map;
    this.legacyAreaMeshes = legacyNavmesh;

    for (const [areaId, area] of Object.entries(this.map.areas)) {
      const polygon = this.buildPolygonFromArea(area);
      if (!polygon) {
        console.error("failed to build polygon for area");
        continue;
      }

      const expandedPolygon = geometryUtils.expandPolygon(polygon, 0.01);
      console.log("Expanded polygon for area:", expandedPolygon);

      const triangles = this.triangulateArea(area, expandedPolygon);
      if (!triangles) {
        console.error("failed to triangulate area");
        continue;
      }
      const mesh = this.createMeshForArea(areaId, triangles);
      if (!mesh) {
        console.error("failed to create mesh for area");
        continue;
      }
      this.areaMeshes[areaId] = mesh;
    }
  }

  private buildPolygonFromArea(area: Area): THREE.Vector3Like[] | null {
    if (!this.map) return null;

    console.log("Building polygon for area:", area.points);

    // Find a starting edge and build the polygon

    const polygon: THREE.Vector3Like[] = area.points.map((pointId) => {
      return this.map.points[pointId];
    });

    console.log("Polygon for area:", polygon);

    return polygon.length > 2 ? polygon : null;
  }

  private triangulateArea(
    area: Area,
    polygon: THREE.Vector3Like[]
  ): THREE.Vector3Like[][] | null {
    if (!this.map) return null;

    if (!polygon || polygon.length < 3) {
      console.log("Invalid polygon for area:", area.points);
      return null;
    }

    console.log("Triangulating area with", polygon.length, "vertices");

    // Convert polygon to 2D for earcut (project to XZ plane)
    const vertices2D: number[] = [];
    const vertices3D: THREE.Vector3Like[] = [];

    polygon.forEach((vertex, index) => {
      vertices2D.push(vertex.x, vertex.z); // X and Z coordinates
      vertices3D.push(vertex);
    });

    console.log("2D vertices for earcut:", vertices2D);

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

    console.log(
      "Triangulated into",
      result.length,
      "triangles with counter-clockwise winding"
    );
    return result;
  }

  createMeshForArea(
    areaId: string,
    triangles: THREE.Vector3Like[][]
  ): THREE.Mesh | null {
    const area = this.map.areas[areaId];
    if (!area) {
      console.log("Area not found:", areaId);
      return null;
    }
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
}
