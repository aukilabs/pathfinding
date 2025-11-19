import { NavMesh, NavMeshQuery } from "@recast-navigation/core";
import { EdgeWeightInfo, PathResult, ReadOnlyNavMap } from "./NavgraphTypes";
import {
  Edge,
  NavMap,
  MeshGeometry,
  Point,
  V3,
  geometry,
} from "@auki/navgraph";
import * as constants from "./Constants";
import * as recastUtils from "./RecastUtils";
import * as graphUtils from "./GraphUtils";
import * as pathfinding from "./PathfindingUtils";
import {
  generateSoloNavMesh,
  mergePositionsAndIndices,
} from "@recast-navigation/generators";
const { addAdjacency, computeNavMeshPathAndConnect } = graphUtils;
const { findClosestPoint, getNavmeshUnderPoint } = recastUtils;
const { convertAreaGroupToPathResult } = pathfinding;

export class FloorData {
  //source data
  private _graph: NavMap;

  //caches for graph areas
  private _areaMeshes: Map<string, MeshGeometry> = new Map();
  private _areaGroups: Map<string, string[]> = new Map(); // areaGroupId -> areaIds[]
  private _areaGroupNavMeshes: Map<string, NavMesh> = new Map(); // Cache navmeshes for areaGroups
  private _areaGroupNMQueries: Map<string, NavMeshQuery> = new Map(); // Cache navmeshes for areaGroups

  //navmesh geometry
  private _legacyMeshes: MeshGeometry[] = [];
  private _legacyNavMesh: NavMesh | null = null;
  private _legacyNavMeshQuery: NavMeshQuery | null = null;

  //pathfinding graph connections
  private _adjacencies: Map<string, string[]> = new Map();
  private _edgeWeights: Map<string, EdgeWeightInfo[]> = new Map();

  get graph(): ReadOnlyNavMap {
    return this._graph;
  }

  get adjacencies(): ReadonlyMap<string, string[]> {
    return this._adjacencies;
  }
  get edgeWeights(): ReadonlyMap<string, EdgeWeightInfo[]> {
    return this._edgeWeights;
  }

  get areaGroupNavmeshes(): ReadonlyMap<string, NavMesh> {
    return this._areaGroupNavMeshes;
  }

  getAreaGroupAreas(areaGroupId: string): string[] {
    return this._areaGroups.get(areaGroupId) || [];
  }

  getPoints(): Readonly<Record<string, Point>> {
    return this._graph.points;
  }

  getAreaMeshes(): ReadonlyMap<string, MeshGeometry> {
    return this._areaMeshes;
  }

  getLegacyMeshes(): readonly MeshGeometry[] {
    return this._legacyMeshes;
  }

  getLegacyNavMeshQuery(): NavMeshQuery | null {
    return this._legacyNavMeshQuery;
  }

  getGraphEdge(edgeId: string): Edge | null {
    return this._graph.edges[edgeId] || null;
  }
  getGraphPoint(pointId: string): Point | null {
    return this._graph.points[pointId] || null;
  }

  getAreaGroupNavMesh(areaGroupId: string): NavMesh | null {
    return this._areaGroupNavMeshes.get(areaGroupId) || null;
  }

  getAreaGroupNMQuery(areaGroupId: string): NavMeshQuery | null {
    return this._areaGroupNMQueries.get(areaGroupId) || null;
  }

  constructor(graph: NavMap, navmeshGeometry: MeshGeometry[]) {
    this._graph = graph;
    this._legacyMeshes = navmeshGeometry;

    this.initializeMapAreas();
    this.buildAreaGroups();
    this.initializeLegacyAreaNavMeshes();
    this.buildEdgeConnections();
    this.initializeAreaGroupNavMeshes();
    this.initializeAreaGroupDistances();
    this.initializeLegacyAreaConnections();
  }

  private initializeMapAreas() {
    for (const [areaId, area] of Object.entries(this._graph.areas)) {
      const polygon = geometry.buildPolygonFromEdges(area.edges, this._graph);
      if (!polygon) {
        console.error("failed to build polygon for area");
        continue;
      }

      const expandedPolygon = geometry.expandPolygon(
        polygon,
        constants.DEFAULT_POLYGON_EXPANSION_DISTANCE
      );
      const triangles = geometry.triangulateArea(expandedPolygon);
      if (!triangles) {
        console.error("failed to triangulate area");
        continue;
      }
      const mesh = geometry.createMeshFromTriangles(areaId, triangles);
      if (!mesh) {
        console.error("failed to create mesh for area");
        continue;
      }
      this._areaMeshes.set(areaId, mesh);
    }
  }

  destroy() {
    this._graph = { areas: {}, edges: {}, points: {} };
    this._adjacencies.clear();
    this._edgeWeights.clear();
    this._legacyNavMesh?.destroy();
    this._legacyNavMesh = null;
    this._legacyNavMeshQuery?.destroy();
    this._legacyNavMeshQuery = null;
    this._areaMeshes.clear();
    this._areaGroupNavMeshes.forEach((navMesh) => navMesh.destroy());
    this._areaGroupNavMeshes.clear();
    this._areaGroupNMQueries.forEach((query) => query.destroy());
    this._areaGroupNMQueries.clear();
  }

  /**
   * Find areas that share at least one edge with the given area
   */
  private findAdjacentAreas(areaId: string): string[] {
    if (!this._graph) return [];

    const area = this._graph.areas[areaId];
    if (!area) return [];

    const adjacentAreas = new Set<string>();

    // Check each edge in this area
    for (const edgeId of area.edges) {
      const edge = this._graph.edges[edgeId];
      if (!edge) continue;

      // Find all areas that contain this edge
      const areasContainingEdge = graphUtils.getAreasContainingEdge(
        this._graph,
        edgeId
      );

      // Add all areas except the current one
      for (const otherAreaId of areasContainingEdge) {
        if (otherAreaId !== areaId) {
          adjacentAreas.add(otherAreaId);
        }
      }
    }

    return Array.from(adjacentAreas);
  }

  /**
   * Find areas that share edges (are adjacent) and group them together
   */
  private buildAreaGroups(): void {
    this._areaGroups.clear();

    if (!this._graph) return;

    const areaIds = Object.keys(this._graph.areas);
    const visited = new Set<string>();
    let groupId = 0;

    for (const areaId of areaIds) {
      if (visited.has(areaId)) continue;

      // Start a new group with this area
      const currentGroup: string[] = [areaId];
      visited.add(areaId);

      // Find all areas that share edges with any area in this group
      let foundNewAreas = true;
      while (foundNewAreas) {
        foundNewAreas = false;

        for (const groupAreaId of currentGroup) {
          const adjacentAreas = this.findAdjacentAreas(groupAreaId);

          for (const adjacentAreaId of adjacentAreas) {
            if (!visited.has(adjacentAreaId)) {
              currentGroup.push(adjacentAreaId);
              visited.add(adjacentAreaId);
              foundNewAreas = true;
            }
          }
        }
      }

      // Store this group
      const groupKey = `group_${groupId++}`;
      this._areaGroups.set(groupKey, currentGroup);
    }
  }
  private initializeLegacyAreaNavMeshes() {
    if (!this._graph) return;

    const legacyMeshes = this._legacyMeshes;
    if (legacyMeshes.length === 0) {
      return;
    }

    let nmResult;
    try {
      const [positions, indices] = mergePositionsAndIndices(legacyMeshes);
      nmResult = generateSoloNavMesh(
        positions,
        indices,
        constants.DEFAULT_NAVMESH_PARAMS
      );
    } catch (error) {
      console.error("Error creating legacy NavMesh:", error);
      return;
    }

    if (!nmResult.success || !nmResult.navMesh) {
      console.error("Failed to create nav mesh for legacy areas:", nmResult);
      return;
    }

    this._legacyNavMesh = nmResult.navMesh;
    this._legacyNavMeshQuery = new NavMeshQuery(nmResult.navMesh);
  }

  private initializeAreaGroupNavMeshes() {
    if (!this._graph) return;

    for (const [groupId, areaIds] of this._areaGroups) {
      // Collect all area meshes in this group
      const areaMeshes: MeshGeometry[] = [];

      for (const areaId of areaIds) {
        const areaMesh = this._areaMeshes.get(areaId);
        if (areaMesh) {
          areaMeshes.push(areaMesh);
        }
      }

      if (areaMeshes.length === 0) continue;

      try {
        const [positions, indices] = mergePositionsAndIndices(areaMeshes);
        const nmResult = generateSoloNavMesh(
          positions,
          indices,
          constants.DEFAULT_NAVMESH_PARAMS
        );
        if (nmResult.navMesh) {
          this._areaGroupNavMeshes.set(groupId, nmResult.navMesh);

          const navMeshQuery = new NavMeshQuery(nmResult.navMesh);
          this._areaGroupNMQueries.set(groupId, navMeshQuery);
        }
      } catch (error) {
        console.error(
          `Failed to build NavMesh for areaGroup ${groupId}:`,
          error
        );
      }
    }
  }

  private buildEdgeConnections() {
    if (!this._graph) return;

    // Build connections and calculate weights
    Object.entries(this._graph.edges).forEach(([edgeId, edge]) => {
      const fromPoint = this._graph.points[edge.from];
      const toPoint = this._graph.points[edge.to];

      if (!fromPoint || !toPoint) {
        return;
      }

      // Check if this edge belongs to any areaGroup
      const edgeAreaGroups = this.getGroupsWithEdge(edgeId);
      const isAreaEdge = edgeAreaGroups.length > 0;

      // Skip edges that belong to areaGroups - they'll be handled by exit-to-exit connections
      if (isAreaEdge) {
        return;
      }

      // Calculate edge weight (distance)
      let weight = geometry.calculateDistance(fromPoint, toPoint);

      // Apply weight multiplier if specified
      const weightMultiplier = edge.weightMultiplier;
      if (weightMultiplier !== undefined) {
        weight *= weightMultiplier;
      }

      const doTo = edge.dir === undefined || edge.dir === 0 || edge.dir === 1;
      const doFrom =
        edge.dir === undefined || edge.dir === 0 || edge.dir === -1;

      if (doTo) {
        // One-way edge - only add from -> to connection
        graphUtils.addAdjacency(
          this._adjacencies,
          this._edgeWeights,
          edge.from,
          edge.to,
          false,
          {
            weight,
            path: [fromPoint, toPoint],
          }
        );
      }
      if (doFrom) {
        // One-way-reverse edge - only add to -> from connection
        addAdjacency(
          this._adjacencies,
          this._edgeWeights,
          edge.to,
          edge.from,
          false,
          {
            weight,
            path: [toPoint, fromPoint],
          }
        );
      }
    });
  }

  private initializeAreaGroupDistances() {
    if (!this._graph) return;

    for (const [groupId, areaIds] of this._areaGroups) {
      const navMesh = this._areaGroupNMQueries.get(groupId);
      if (!navMesh) continue;

      // Get true exit points for this areaGroup
      const allExitPoints = graphUtils.findExitPointsForGroup(
        this._graph,
        groupId,
        areaIds,
        this._legacyNavMeshQuery
      );

      // Pre-compute distances between all pairs of exit points in this areaGroup
      for (let i = 0; i < allExitPoints.length; i++) {
        for (let j = i + 1; j < allExitPoints.length; j++) {
          const fromPointId = allExitPoints[i];
          const toPointId = allExitPoints[j];

          const fromPoint = this._graph.points[fromPointId];
          const toPoint = this._graph.points[toPointId];

          if (fromPoint && toPoint) {
            computeNavMeshPathAndConnect(
              navMesh,
              fromPoint,
              toPoint,
              fromPointId,
              toPointId,
              this._adjacencies,
              this._edgeWeights
            );
          }
        }
      }
    }
  }

  private initializeLegacyAreaConnections() {
    if (!this._graph) {
      return;
    }

    const lnmQuery = this._legacyNavMeshQuery;
    if (!lnmQuery) {
      return;
    }

    // Find all existing graph points that intersect with the legacy NavMesh
    const intersectingPoints: string[] = [];

    Object.entries(this._graph.points).forEach(([pointId, point]) => {
      if (recastUtils.isPointOnLegacyNavMesh(point, lnmQuery)) {
        intersectingPoints.push(pointId);
      }
    });

    // Add direct NavMesh connections between all pairs of intersecting points
    for (let i = 0; i < intersectingPoints.length; i++) {
      for (let j = i + 1; j < intersectingPoints.length; j++) {
        const fromId = intersectingPoints[i];
        const toId = intersectingPoints[j];

        const fromPoint = this._graph.points[fromId];
        const toPoint = this._graph.points[toId];

        computeNavMeshPathAndConnect(
          lnmQuery,
          fromPoint,
          toPoint,
          fromId,
          toId,
          this._adjacencies,
          this._edgeWeights
        );
      }
    }
  }

  /**
   * Get the areaGroup that contains the given area
   */
  //TODO: can be made into pure util
  getAreaGroupForArea(areaId: string): string | null {
    for (const [groupId, areaIds] of this._areaGroups) {
      if (areaIds.includes(areaId)) {
        return groupId;
      }
    }
    return null;
  }

  /**
   * Check if an edge belongs to any areaGroup
   */
  //TODO: can be made into pure util
  getGroupsWithEdge(edgeId: string): string[] {
    const areaIds = graphUtils.getAreasContainingEdge(this._graph, edgeId);
    const groupIds = new Set<string>();
    for (const areaId of areaIds) {
      const groupId = this.getAreaGroupForArea(areaId);
      if (groupId) {
        groupIds.add(groupId);
      }
    }
    return Array.from(groupIds);
  }

  getPathResult(position: V3): PathResult | null {
    const areaId = getNavmeshUnderPoint(position, this._areaGroupNMQueries);
    if (areaId) return convertAreaGroupToPathResult(areaId, position);
    const edge = graphUtils.getNearestPositionOnEdge(this._graph, position);
    const legacy = findClosestPoint(this._legacyNavMeshQuery, position);
    return pathfinding.chooseClosestResult(edge, legacy);
  }
}
