import { init, NavMesh, NavMeshQuery } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import * as THREE from "three";
import {
  Area,
  Edge,
  NavMap as NavigationGraph,
  EdgeWeightInfo,
} from "./NavgraphTypes";
import * as geometry from "./GeometryUtils";
import * as graphUtils from "./GraphUtils";
import * as recastUtils from "./RecastUtils";
import * as pathfinding from "./PathfindingUtils";
import * as constants from "./Constants";
const { createEdgeWeightKey } = constants;
const { addAdjacency } = graphUtils;

export type NavOptions = {
  maxDistance?: number;
  maxOffGraphDistance?: number; // Maximum distance to find nearest point
};

export class Pathfinder {
  private _map: NavigationGraph;
  private _config: NavOptions;
  private _adjacencies: Map<string, string[]> = new Map();
  private _edgeWeights: Map<string, EdgeWeightInfo[]> = new Map();

  private _areaMeshes: Record<string, THREE.Mesh> = {};

  // AreaGroup system for grouping adjacent areas
  private _areaGroups: Map<string, string[]> = new Map(); // areaGroupId -> areaIds[]
  private _areaGroupNavMeshes: Map<string, NavMesh> = new Map(); // Cache navmeshes for areaGroups
  private _areaGroupNavMeshQueries: Map<string, NavMeshQuery> = new Map(); // Cache navmeshes for areaGroups

  private _legacyMeshes: THREE.Mesh[] = [];
  private _legacyNavMesh: NavMesh | null = null;
  private _legacyNavMeshQuery: NavMeshQuery | null = null;

  constructor(config: NavOptions = {}) {
    this._config = {
      ...config,
    };
    this._map = {
      points: {},
      edges: {},
      areas: {},
    };
  }

  get navmeshes() {
    return this._areaGroupNavMeshes;
  }

  get areaMeshes() {
    return this._areaMeshes;
  }

  get edgeWeights() {
    return this._edgeWeights;
  }

  private isLoaded = false;
  get loaded() {
    return this.isLoaded;
  }

  get adjacencyListForVisualization() {
    return this._adjacencies;
  }

  // Convenience getters for users
  getMapPoint(pointId: string): THREE.Vector3Like | null {
    return this._map.points[pointId] || null;
  }

  getMapEdge(edgeId: string): Edge | null {
    return this._map.edges[edgeId] || null;
  }

  getMapArea(areaId: string): Area | null {
    return this._map.areas[areaId] || null;
  }

  get allPoints(): Record<string, THREE.Vector3Like> {
    return { ...this._map.points };
  }

  get allEdges(): Record<string, Edge> {
    return { ...this._map.edges };
  }

  get allAreas(): Record<string, Area> {
    return { ...this._map.areas };
  }

  get legacyMeshes(): THREE.Mesh[] {
    return [...this._legacyMeshes];
  }

  private getMapPointInternal(pointId: string): THREE.Vector3Like | null {
    return this._map?.points[pointId] || null;
  }

  async load(map: NavigationGraph, legacyNavmesh: THREE.Mesh[]) {
    this.isLoaded = false;
    this.cleanUp();

    this._map = map;
    this._legacyMeshes = legacyNavmesh;
    await init();
    this.initializeMapAreas();
    await this.initializeLegacyAreaNavMeshes();
    this.buildAdjacencyList();
    await this.initializeAreaGroupNavMeshes();
    await this.initializeAreaGroupDistances();
    await this.initializeLegacyAreaConnections();
    this.isLoaded = true;
  }

  private initializeMapAreas() {
    for (const [areaId, area] of Object.entries(this._map.areas)) {
      const polygon = graphUtils.buildPolygonFromArea(areaId, this._map);
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
      this._areaMeshes[areaId] = mesh;
    }
  }

  private clearTemporaryWeights() {
    // Remove all temporary weights (FROM_INTERMEDIATE and TO_INTERMEDIATE connections)
    const keysToRemove: string[] = [];
    this._edgeWeights.forEach((connections, key) => {
      // Check if any connection involves intermediate points
      const hasIntermediate = connections.some(
        (conn) =>
          key.includes(constants.FROM_INTERMEDIATE) ||
          key.includes(constants.TO_INTERMEDIATE)
      );
      if (hasIntermediate) {
        keysToRemove.push(key);
      }
    });

    keysToRemove.forEach((key) => this._edgeWeights.delete(key));
  }

  private cleanUp() {
    this._adjacencies.clear();
    this._edgeWeights.clear();
    this._legacyNavMesh?.destroy();
    this._legacyNavMesh = null;
    this._legacyNavMeshQuery?.destroy();
    this._legacyNavMeshQuery = null;
    this._areaGroupNavMeshes.forEach((navMesh) => navMesh.destroy());
    this._areaGroupNavMeshes.clear();
    this._areaGroupNavMeshQueries.forEach((query) => query.destroy());
    this._areaGroupNavMeshQueries.clear();
  }

  setConfig(config: NavOptions) {
    this._config = { ...this._config, ...config };
  }

  /**
   * Find areas that share edges (are adjacent) and group them together
   */
  private buildAreaGroups(): void {
    this._areaGroups.clear();

    if (!this._map) return;

    const areaIds = Object.keys(this._map.areas);
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

  /**
   * Get the areaGroup that contains the given area
   */
  private getAreaGroupForArea(areaId: string): string | null {
    for (const [groupId, areaIds] of this._areaGroups) {
      if (areaIds.includes(areaId)) {
        return groupId;
      }
    }
    return null;
  }

  /**
   * Get all areaGroups that contain any of the given areas
   */
  private getAreaGroupsForAreas(areaIds: string[]): string[] {
    const groupIds = new Set<string>();
    for (const areaId of areaIds) {
      const groupId = this.getAreaGroupForArea(areaId);
      if (groupId) {
        groupIds.add(groupId);
      }
    }
    return Array.from(groupIds);
  }

  /**
   * Check if an edge belongs to any areaGroup
   */
  private getAreaGroupsContainingEdge(edgeId: string): string[] {
    const areaIds = graphUtils.getAreasContainingEdge(this._map, edgeId);
    return this.getAreaGroupsForAreas(areaIds);
  }

  /**
   * Find areas that share at least one edge with the given area
   */
  private findAdjacentAreas(areaId: string): string[] {
    if (!this._map) return [];

    const area = this._map.areas[areaId];
    if (!area) return [];

    const adjacentAreas = new Set<string>();

    // Check each edge in this area
    for (const edgeId of area.edges) {
      const edge = this._map.edges[edgeId];
      if (!edge) continue;

      // Find all areas that contain this edge
      const areasContainingEdge = graphUtils.getAreasContainingEdge(
        this._map,
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

  private buildAdjacencyList() {
    if (!this._map) return;

    // Build area groups first
    this.buildAreaGroups();

    // Initialize adjacency list for original points only
    Object.keys(this._map.points).forEach((pointId) => {
      this._adjacencies.set(pointId, []);
    });

    // Build connections and calculate weights
    Object.entries(this._map.edges).forEach(([edgeId, edge]) => {
      const fromPoint = this.getMapPointInternal(edge.from)!;
      const toPoint = this.getMapPointInternal(edge.to)!;

      if (fromPoint && toPoint) {
        // Check if this edge belongs to any areaGroup
        const edgeAreaGroups = this.getAreaGroupsContainingEdge(edgeId);
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

        if (!edge.dir) {
          // Two-way edge - add bidirectional connections
          addAdjacency(this._adjacencies, edge.from, edge.to, true);

          this.addEdgeWeight(edge.from, edge.to, {
            weight,
            type: "direct",
            path: [fromPoint, toPoint],
          });
          this.addEdgeWeight(edge.to, edge.from, {
            weight,
            type: "direct",
            path: [toPoint, fromPoint],
          });
        } else if (edge.dir === 1) {
          // One-way edge - only add from -> to connection
          addAdjacency(this._adjacencies, edge.from, edge.to, false);
          this.addEdgeWeight(edge.from, edge.to, {
            weight,
            type: "direct",
            path: [fromPoint, toPoint],
          });
        } else if (edge.dir === -1) {
          // One-way-reverse edge - only add to -> from connection
          addAdjacency(this._adjacencies, edge.to, edge.from, false);
          this.addEdgeWeight(edge.to, edge.from, {
            weight,
            type: "direct",
            path: [toPoint, fromPoint],
          });
        }
      }
    });

    // Add areaGroup-based exit-to-exit connections
    this._areaGroups.forEach((areaIds, groupId) => {
      // Get true exit points for this areaGroup
      const allExitPoints = graphUtils.findExitPointsForGroup(
        this._map,
        groupId,
        areaIds,
        this._legacyNavMeshQuery
      );

      const exitPointsArray = Array.from(allExitPoints);

      // Connect all exit points within the same areaGroup
      for (let i = 0; i < exitPointsArray.length; i++) {
        for (let j = 0; j < exitPointsArray.length; j++) {
          if (i !== j) {
            const fromId = exitPointsArray[i];
            const toId = exitPointsArray[j];

            // Add bidirectional connection
            addAdjacency(this._adjacencies, fromId, toId, true);
          }
        }
      }
    });
  }

  findPath(
    from: THREE.Vector3Like,
    to: THREE.Vector3Like
  ): THREE.Vector3Like[] | null {
    if (!this._map) {
      return null;
    }

    // Clear temporary weights from previous pathfinding calls
    this.clearTemporaryWeights();

    // Find nearest positions on traditional edges
    const fromEdgeResult = graphUtils.getNearestPositionOnEdge(this._map, from);
    const toEdgeResult = graphUtils.getNearestPositionOnEdge(this._map, to);

    // Find nearest positions on legacy NavMesh
    const fromLegacyResult = recastUtils.getNearestPositionOnNavMesh(
      this._legacyNavMeshQuery,
      from
    );
    const toLegacyResult = recastUtils.getNearestPositionOnNavMesh(
      this._legacyNavMeshQuery,
      to
    );

    const fromAreaResult = recastUtils.getNavmeshUnderPoint(
      from,
      this._areaGroupNavMeshQueries
    );
    const toAreaResult = recastUtils.getNavmeshUnderPoint(
      to,
      this._areaGroupNavMeshQueries
    );

    console.log("AreaGroup detection:", {
      fromAreaResult,
      toAreaResult,
      fromPosition: from,
      toPosition: to,
    });

    // Use unified pathfinding logic for all cases
    const fromResult = pathfinding.chooseClosestResult(
      fromEdgeResult,
      fromLegacyResult,
      fromAreaResult
        ? {
            areaGroupId: fromAreaResult,
            position: from,
          }
        : null
    );
    const toResult = pathfinding.chooseClosestResult(
      toEdgeResult,
      toLegacyResult,
      toAreaResult
        ? {
            areaGroupId: toAreaResult,
            position: to,
          }
        : null
    );

    console.log("chooseClosestResult results:", {
      fromResult: fromResult?.edgeId,
      toResult: toResult?.edgeId,
      fromIsAreaGroup:
        fromResult?.edgeId === constants.WITHIN_AREA_GROUP_EDGE_ID,
      toIsAreaGroup: toResult?.edgeId === constants.WITHIN_AREA_GROUP_EDGE_ID,
    });

    if (!fromResult || !toResult) {
      return null;
    }

    // Check if points are within threshold
    if (
      fromResult.distance > (this._config.maxOffGraphDistance ?? Infinity) ||
      toResult.distance > (this._config.maxOffGraphDistance ?? Infinity)
    ) {
      console.log("Points are too far from navigation surface");
      return null;
    }

    // Find the optimal path using Dijkstra with pre-computed area distances
    const { tempAdjacencyList, tempPaths } = this.createTemporaryGraph(
      fromResult,
      toResult
    );

    let graphPath = this.dijkstraWithTempGraph(
      tempAdjacencyList,
      constants.FROM_INTERMEDIATE,
      constants.TO_INTERMEDIATE
    );

    if (!graphPath) {
      console.log("No path found between intermediate points");

      return null;
    }

    // Convert to world coordinates
    return this.convertGraphPathToWorldPath(
      graphPath,
      fromResult,
      toResult,
      from,
      to,
      tempPaths
    );
  }

  private convertGraphPathToWorldPath(
    graphPath: string[],
    fromResult: any,
    toResult: any,
    from: THREE.Vector3Like,
    to: THREE.Vector3Like,
    tempPaths: Map<string, THREE.Vector3Like[]> // Add tempPaths parameter
  ): THREE.Vector3Like[] {
    const fullPath: THREE.Vector3Like[] = [from];

    for (let i = 0; i < graphPath.length; i++) {
      const currentNode = graphPath[i];
      const nextNode = graphPath[i + 1];

      // Try to find a precomputed path for this transition
      let pathKey: string | undefined;

      if (nextNode) {
        // Create path key using the same pattern for all nodes
        pathKey = `${currentNode}-${nextNode}`;
      }

      // Check tempPaths first (for intermediate node paths)
      if (pathKey) {
        const precomputedPath = tempPaths.get(pathKey);
        if (precomputedPath) {
          fullPath.push(...precomputedPath);
          continue;
        }
      }

      // Check edge weights for regular node-to-node connections
      if (
        pathKey &&
        !constants.isIntermediateNode(currentNode) &&
        !constants.isIntermediateNode(nextNode!)
      ) {
        const connections = this._edgeWeights.get(pathKey);
        if (connections && connections.length > 0) {
          const chosenConnection = connections.reduce((min, conn) =>
            conn.weight < min.weight ? conn : min
          );
          fullPath.push(...chosenConnection.path);
          continue;
        }
      }

      // Fallback: add single point based on node type
      if (currentNode === constants.FROM_INTERMEDIATE) {
        fullPath.push(fromResult.position);
      } else if (currentNode === constants.TO_INTERMEDIATE) {
        fullPath.push(toResult.position);
      } else {
        fullPath.push(this.getMapPointInternal(currentNode)!);
      }
    }

    fullPath.push(to);
    return fullPath;
  }

  /**
   * Helper function to add a connection to the edge weights list
   */
  private addEdgeWeight(
    fromId: string,
    toId: string,
    weightInfo: EdgeWeightInfo
  ): void {
    const key = createEdgeWeightKey(fromId, toId);
    const existing = this._edgeWeights.get(key) || [];
    existing.push(weightInfo);
    this._edgeWeights.set(key, existing);
  }

  /**
   * Helper function to set edge weight and store path
   */
  private setEdgeWeightAndPath(
    fromId: string,
    toId: string,
    distance: number,
    path: THREE.Vector3Like[],
    tempPaths: Map<string, THREE.Vector3Like[]>,
    pathKey: string
  ): void {
    this.addEdgeWeight(fromId, toId, {
      weight: distance,
      type: "legacy",
      path: path,
    });
    tempPaths.set(pathKey, path);
  }

  /**
   * Helper function to compute NavMesh path and add connection
   */
  private computeNavMeshPathAndConnect(
    navMeshQuery: NavMeshQuery,
    fromPoint: THREE.Vector3Like,
    toPoint: THREE.Vector3Like,
    fromId: string,
    toId: string,
    adjacencyList: Map<string, string[]>,
    tempPaths: Map<string, THREE.Vector3Like[]>,
    pathKey: string
  ): boolean {
    try {
      const path = navMeshQuery.computePath(fromPoint, toPoint);
      if (path.success && path.path) {
        const distance = geometry.calculatePathLength(path.path);
        addAdjacency(adjacencyList, fromId, toId, true);
        this.setEdgeWeightAndPath(
          fromId,
          toId,
          distance,
          path.path,
          tempPaths,
          pathKey
        );
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

  /**
   * Helper function to compute NavMesh path for precomputed area distances
   */
  private computePrecomputedNavMeshPath(
    navMeshQuery: NavMeshQuery,
    fromPoint: THREE.Vector3Like,
    toPoint: THREE.Vector3Like,
    fromId: string,
    toId: string
  ): boolean {
    try {
      const path = navMeshQuery.computePath(fromPoint, toPoint);
      if (path.success && path.path) {
        const navMeshDistance = geometry.calculatePathLength(path.path);

        // Check if there's already a graph edge between these points
        const existingWeightKey = createEdgeWeightKey(fromId, toId);
        const invertedKey = createEdgeWeightKey(toId, fromId);
        const existingConnections =
          this._edgeWeights.get(existingWeightKey) || [];
        const invertedConnections = this._edgeWeights.get(invertedKey) || [];

        // Always add connection to adjacency list
        addAdjacency(this._adjacencies, fromId, toId, true);

        // Check if there's already a legacy connection in either direction
        const hasLegacyConnection =
          existingConnections.some((conn) => conn.type === "legacy") ||
          invertedConnections.some((conn) => conn.type === "legacy");

        // Only add legacy connection if it doesn't exist or if this one is shorter
        const existingLegacyConnection =
          existingConnections.find((c) => c.type === "legacy") ||
          invertedConnections.find((c) => c.type === "legacy");
        if (
          !hasLegacyConnection ||
          (existingLegacyConnection &&
            navMeshDistance < existingLegacyConnection.weight)
        ) {
          this.addEdgeWeight(fromId, toId, {
            weight: navMeshDistance,
            type: "legacy",
            path: path.path,
          });
          this.addEdgeWeight(toId, fromId, {
            weight: navMeshDistance,
            type: "legacy",
            path: path.path.toReversed(),
          });
        }
        return true;
      }
    } catch (error) {
      console.error(
        `Failed to compute path between ${fromId} and ${toId}:`,
        error
      );
    }
    return false;
  }

  /**
   * Helper function to connect intermediate point to edge points based on edge direction
   */
  private connectIntermediateToEdgePoints(
    tempAdjacencies: Map<string, string[]>,
    fromPosition: THREE.Vector3Like,
    fromResult: { fromPointId: string; toPointId: string },
    edgeDir?: number,
    isAreaEdge?: boolean
  ): void {
    if (!edgeDir || isAreaEdge) {
      // Two-way edge - connect to both points
      this.connectToPoint(
        tempAdjacencies,
        fromPosition,
        fromResult.fromPointId
      );
      this.connectToPoint(tempAdjacencies, fromPosition, fromResult.toPointId);
    } else if (edgeDir === 1) {
      // One-way edge - only connect to fromPoint
      this.connectToPoint(
        tempAdjacencies,
        fromPosition,
        fromResult.fromPointId
      );
    } else if (edgeDir === -1) {
      // One-way-reverse edge - only connect to toPoint
      this.connectToPoint(tempAdjacencies, fromPosition, fromResult.toPointId);
    }
  }

  /**
   * Helper function to connect intermediate point to a specific edge point
   */
  private connectToPoint(
    tempAdjacencies: Map<string, string[]>,
    fromPosition: THREE.Vector3Like,
    pointId: string
  ): void {
    const point = this.getMapPointInternal(pointId);
    if (point) {
      const distance = new THREE.Vector3().copy(point).distanceTo(fromPosition);
      addAdjacency(
        tempAdjacencies,
        pointId,
        constants.FROM_INTERMEDIATE,
        false
      );
      this.addEdgeWeight(constants.FROM_INTERMEDIATE, pointId, {
        weight: distance,
        type: "legacy",
        path: [fromPosition, point],
      });
    }
  }

  /**
   * Helper function to connect intermediate point to edge points for "to" side
   */
  private connectIntermediateToEdgePointsTo(
    tempAdjacencies: Map<string, string[]>,
    toPosition: THREE.Vector3Like,
    toResult: { fromPointId: string; toPointId: string },
    edgeDir?: number,
    isAreaEdge?: boolean
  ): void {
    if (!edgeDir || isAreaEdge) {
      // Two-way edge - connect to both points
      this.connectToPointTo(tempAdjacencies, toPosition, toResult.fromPointId);
      this.connectToPointTo(tempAdjacencies, toPosition, toResult.toPointId);
    } else if (edgeDir === 1) {
      // One-way edge - only connect to fromPoint
      this.connectToPointTo(tempAdjacencies, toPosition, toResult.fromPointId);
    } else if (edgeDir === -1) {
      // One-way-reverse edge - only connect to toPoint
      this.connectToPointTo(tempAdjacencies, toPosition, toResult.toPointId);
    }
  }

  /**
   * Helper function to connect intermediate point to a specific edge point for "to" side
   */
  private connectToPointTo(
    tempAdjacencies: Map<string, string[]>,
    toPosition: THREE.Vector3Like,
    pointId: string
  ): void {
    const point = this.getMapPointInternal(pointId);
    if (point) {
      const distance = new THREE.Vector3().copy(point).distanceTo(toPosition);
      addAdjacency(tempAdjacencies, pointId, constants.TO_INTERMEDIATE, false);
      this.addEdgeWeight(pointId, constants.TO_INTERMEDIATE, {
        weight: distance,
        type: "legacy",
        path: [point, toPosition],
      });
    }
  }

  private createTemporaryGraph(
    fromResult: {
      position: THREE.Vector3Like;
      edgeId: string;
      fromPointId: string;
      toPointId: string;
      distance: number;
    },
    toResult: {
      position: THREE.Vector3Like;
      edgeId: string;
      fromPointId: string;
      toPointId: string;
      distance: number;
    }
  ): {
    tempAdjacencyList: Map<string, string[]>;
    tempPaths: Map<string, THREE.Vector3Like[]>;
  } {
    // Check for mixed case: one point off-mesh, other in areaGroup, but edge belongs to same areaGroup
    // Case 1: from is off-mesh (regular edge), to is in areaGroup
    if (
      fromResult.edgeId !== constants.WITHIN_AREA_GROUP_EDGE_ID &&
      toResult.edgeId === constants.WITHIN_AREA_GROUP_EDGE_ID
    ) {
      const toAreaGroupId = toResult.fromPointId;
      const fromEdgeAreaGroups = this.getAreaGroupsContainingEdge(
        fromResult.edgeId
      );

      if (fromEdgeAreaGroups.includes(toAreaGroupId)) {
        console.log(
          "Mixed case detected: from off-mesh, to in areaGroup, same areaGroup"
        );
        // Convert fromResult to areaGroup result
        fromResult.edgeId = constants.WITHIN_AREA_GROUP_EDGE_ID;
        fromResult.fromPointId = toAreaGroupId;
        fromResult.toPointId = toAreaGroupId;
        // Keep original position for direct pathfinding
      }
    }

    // Case 2: to is off-mesh (regular edge), from is in areaGroup
    if (
      toResult.edgeId !== constants.WITHIN_AREA_GROUP_EDGE_ID &&
      fromResult.edgeId === constants.WITHIN_AREA_GROUP_EDGE_ID
    ) {
      const fromAreaGroupId = fromResult.fromPointId;
      const toEdgeAreaGroups = this.getAreaGroupsContainingEdge(
        toResult.edgeId
      );

      if (toEdgeAreaGroups.includes(fromAreaGroupId)) {
        console.log(
          "Mixed case detected: to off-mesh, from in areaGroup, same areaGroup"
        );
        // Convert toResult to areaGroup result
        toResult.edgeId = constants.WITHIN_AREA_GROUP_EDGE_ID;
        toResult.fromPointId = fromAreaGroupId;
        toResult.toPointId = fromAreaGroupId;
        // Keep original position for direct pathfinding
      }
    }

    // Create a copy of the adjacency list
    const tempAdjacencies = new Map<string, string[]>();
    const tempPaths = new Map<string, THREE.Vector3Like[]>(); // Local temporary storage

    // Copy existing connections
    this._adjacencies.forEach((neighbors, nodeId) => {
      tempAdjacencies.set(nodeId, [...neighbors]);
    });

    // Determine edge types
    const fromIsLegacyEdge =
      fromResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID;
    const toIsLegacyEdge =
      toResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID;
    const fromIsAreaGroupEdge =
      fromResult.edgeId === constants.WITHIN_AREA_GROUP_EDGE_ID;
    const toIsAreaGroupEdge =
      toResult.edgeId === constants.WITHIN_AREA_GROUP_EDGE_ID;

    // Add intermediate points as temporary nodes
    if (fromIsLegacyEdge) {
      tempAdjacencies.set(constants.FROM_INTERMEDIATE, []);
    } else if (fromIsAreaGroupEdge) {
      // Point is within areaGroup - connect to all exit points in that areaGroup
      tempAdjacencies.set(constants.FROM_INTERMEDIATE, []);
      const areaGroupId = fromResult.fromPointId; // This is the areaGroupId from chooseClosestResult

      this.addPointToAllExitPoints(
        tempAdjacencies,
        tempPaths,
        constants.FROM_INTERMEDIATE,
        fromResult.position,
        areaGroupId
      );
    } else {
      // Respect edge direction for FROM_INTERMEDIATE connections
      const fromEdge = this.getMapEdge(fromResult.edgeId);
      const fromConnections = [];

      if (fromEdge?.dir === undefined || fromEdge?.dir === 0) {
        // Bidirectional or undefined - add both directions
        fromConnections.push(fromResult.toPointId);
        fromConnections.push(fromResult.fromPointId);
      } else if (fromEdge?.dir === 1) {
        // Forward only - only add toPointId
        fromConnections.push(fromResult.toPointId);
      } else if (fromEdge?.dir === -1) {
        // Backward only - only add fromPointId
        fromConnections.push(fromResult.fromPointId);
      }

      tempAdjacencies.set(constants.FROM_INTERMEDIATE, fromConnections);
    }

    if (toIsLegacyEdge) {
      tempAdjacencies.set(constants.TO_INTERMEDIATE, []);
    } else if (toIsAreaGroupEdge) {
      // Point is within areaGroup - connect to all exit points in that areaGroup
      tempAdjacencies.set(constants.TO_INTERMEDIATE, []);

      this.addPointToAllExitPoints(
        tempAdjacencies,
        tempPaths,
        constants.TO_INTERMEDIATE,
        toResult.position,
        toResult.fromPointId
      );
    } else {
      // Respect edge direction for TO_INTERMEDIATE connections
      const toEdge = this.getMapEdge(toResult.edgeId);
      const toConnections = [];

      if (toEdge?.dir === undefined || toEdge?.dir === 0) {
        // Bidirectional or undefined - add both directions
        toConnections.push(toResult.fromPointId);
      } else if (toEdge?.dir === -1) {
        // Backward only - only add fromPointId
        toConnections.push(toResult.fromPointId);
      } else if (toEdge?.dir === 1) {
        // Forward only - only add toPointId
        toConnections.push(toResult.toPointId);
      }

      tempAdjacencies.set(constants.TO_INTERMEDIATE, toConnections);
    }

    // Special case: if both points are in the same areaGroup, add direct connection
    if (
      fromIsAreaGroupEdge &&
      toIsAreaGroupEdge &&
      fromResult.fromPointId === toResult.fromPointId
    ) {
      console.log("Same areaGroup detected:", {
        areaGroupId: fromResult.fromPointId,
        fromPosition: fromResult.position,
        toPosition: toResult.position,
      });

      const areaGroupId = fromResult.fromPointId;
      const navMeshQuery = this._areaGroupNavMeshQueries.get(areaGroupId);

      if (navMeshQuery) {
        try {
          const fromV3 = new THREE.Vector3().copy(fromResult.position);
          const toV3 = new THREE.Vector3().copy(toResult.position);

          let path = navMeshQuery.computePath(fromV3, toV3);
          console.log("Direct areaGroup path result:", {
            success: path.success,
            pathLength: path.path?.length,
            hasPath: !!path.path,
            fromPosition: fromV3,
            toPosition: toV3,
            error: path.error,
          });

          // If path failed, try finding nearest points on NavMesh first
          if (!path.success) {
            console.log("Path failed, trying nearest points on NavMesh");
            const fromNearest = navMeshQuery.findClosestPoint(fromV3, {
              halfExtents: new THREE.Vector3(5, 5, 5),
            });
            const toNearest = navMeshQuery.findClosestPoint(toV3, {
              halfExtents: new THREE.Vector3(5, 5, 5),
            });

            const fromDistance = fromV3.distanceTo(
              new THREE.Vector3().copy(fromNearest.point)
            );
            const toDistance = toV3.distanceTo(
              new THREE.Vector3().copy(toNearest.point)
            );
            console.log(
              "Path failed, trying nearest points on NavMesh",
              fromNearest,
              toNearest,
              fromV3,
              toV3,
              fromDistance,
              toDistance
            );

            if (
              fromNearest.success &&
              fromNearest.point &&
              toNearest.success &&
              toNearest.point
            ) {
              console.log("Found nearest points, retrying path");
              path = navMeshQuery.computePath(
                fromNearest.point,
                toNearest.point
              );
              console.log("Retry result:", {
                success: path.success,
                pathLength: path.path?.length,
                hasPath: !!path.path,
              });
            }
          }

          if (path.success && path.path) {
            const directDistance = geometry.calculatePathLength(path.path);
            console.log(
              "Adding direct connection with distance:",
              directDistance
            );

            addAdjacency(
              tempAdjacencies,
              constants.FROM_INTERMEDIATE,
              constants.TO_INTERMEDIATE,
              true
            );
            this.setEdgeWeightAndPath(
              constants.FROM_INTERMEDIATE,
              constants.TO_INTERMEDIATE,
              directDistance,
              path.path,
              tempPaths,
              constants.createDirectPathKey()
            );
          }
        } catch (error) {
          console.error("Failed to compute direct areaGroup path:", error);
        }
      } else {
        console.log("No NavMesh query found for areaGroup:", areaGroupId);
      }
    }
    // Special case: if both points are on legacy NavMesh, add direct connection
    else if (fromIsLegacyEdge && toIsLegacyEdge) {
      const directPath = pathfinding.tryDirectLegacyNavMeshPath(
        this._legacyNavMeshQuery,
        fromResult.position,
        toResult.position
      );

      if (directPath) {
        const directDistance = geometry.calculatePathLength(directPath);
        addAdjacency(
          tempAdjacencies,
          constants.FROM_INTERMEDIATE,
          constants.TO_INTERMEDIATE,
          true
        );
        this.setEdgeWeightAndPath(
          constants.FROM_INTERMEDIATE,
          constants.TO_INTERMEDIATE,
          directDistance,
          directPath,
          tempPaths,
          constants.createDirectPathKey()
        );
      }
    }

    // Add connections from existing nodes to intermediate points
    const fromIsAreaEdge = fromIsLegacyEdge
      ? false
      : this.getAreaGroupsContainingEdge(fromResult.edgeId).length > 0;
    const toIsAreaEdge = toIsLegacyEdge
      ? false
      : this.getAreaGroupsContainingEdge(toResult.edgeId).length > 0;

    const fromEdge = fromIsLegacyEdge
      ? null
      : this._map!.edges[fromResult.edgeId];
    const toEdge = toIsLegacyEdge ? null : this._map.edges[toResult.edgeId];

    const fromEdgeAreaGroups = fromIsLegacyEdge
      ? []
      : this.getAreaGroupsContainingEdge(fromResult.edgeId);
    const toEdgeAreaGroups = toIsLegacyEdge
      ? []
      : this.getAreaGroupsContainingEdge(toResult.edgeId);

    // Handle legacy NavMesh edges
    if (fromIsLegacyEdge) {
      const legacyNavMeshQuery = this._legacyNavMeshQuery;
      if (legacyNavMeshQuery) {
        // Find all graph points that intersect with the legacy NavMesh
        const connectedPoints: string[] = [];

        // Connect to all graph points that intersect with legacy NavMesh
        Object.entries(this._map.points).forEach(([pointId, point]) => {
          if (recastUtils.isPointOnLegacyNavMesh(point, legacyNavMeshQuery)) {
            // Check if this point is reachable from the from position
            try {
              const fromV3 = new THREE.Vector3().copy(fromResult.position);
              const pointV3 = new THREE.Vector3().copy(point);

              const path = legacyNavMeshQuery.computePath(fromV3, pointV3);
              if (path.success && path.path) {
                const pathLength = geometry.calculatePathLength(path.path);
                tempPaths.set(
                  constants.createFromIntermediatePathKey(pointId),
                  path.path
                );
                // Store the actual path length for Dijkstra
                const storedKey = createEdgeWeightKey(
                  constants.FROM_INTERMEDIATE,
                  pointId
                );
                this.addEdgeWeight(constants.FROM_INTERMEDIATE, pointId, {
                  weight: pathLength,
                  type: "legacy",
                  path: path.path,
                });
                connectedPoints.push(pointId);
              }
            } catch (error) {
              console.error(
                `Failed to compute path to point ${pointId}:`,
                error
              );
            }
          }
        });

        if (connectedPoints.length > 0) {
          tempAdjacencies.set(constants.FROM_INTERMEDIATE, connectedPoints);

          // Also add reverse connections from points to intermediate
          connectedPoints.forEach((pointId) => {
            tempAdjacencies.get(pointId)!.push(constants.FROM_INTERMEDIATE);
          });
        } else {
          console.log(
            "No graph points connected for 'from' - this will cause pathfinding to fail"
          );
        }
      } else {
        console.log("No legacy NavMesh query available");
      }
    }
    // Handle areaGroup edges by computing NavMesh paths to nearest exit points
    else if (fromIsAreaEdge) {
      const areaGroupId = fromEdgeAreaGroups[0];

      const bothInSameAreaGroup =
        toIsAreaEdge && toEdgeAreaGroups[0] === areaGroupId;

      if (!bothInSameAreaGroup) {
        // Get true exit points for this areaGroup
        const allExitPoints = graphUtils.findExitPointsForGroup(
          this._map,
          areaGroupId,
          this._areaGroups.get(areaGroupId) || [],
          this._legacyNavMeshQuery
        );

        const exitPoints = Array.from(allExitPoints);
        const navMeshQuery = this._areaGroupNavMeshQueries.get(areaGroupId);

        if (exitPoints.length > 0 && navMeshQuery) {
          const connectedExits: string[] = [];

          // Compute NavMesh path to ALL exit points
          for (const exitId of exitPoints) {
            const fromV3 = new THREE.Vector3().copy(fromResult.position);
            const toV3 = new THREE.Vector3().copy(
              this.getMapPointInternal(exitId)!
            );

            const success = this.computeNavMeshPathAndConnect(
              navMeshQuery,
              fromV3,
              toV3,
              constants.FROM_INTERMEDIATE,
              exitId,
              tempAdjacencies,
              tempPaths,
              constants.createFromIntermediatePathKey(exitId)
            );

            if (success) {
              connectedExits.push(exitId);
            }
          }

          // Connect intermediate point to ALL successful exits
          if (connectedExits.length > 0) {
            connectedExits.forEach((exitId) => {
              addAdjacency(
                tempAdjacencies,
                constants.FROM_INTERMEDIATE,
                exitId,
                false
              );
            });
          }
        }
      }
    } else if (!fromIsLegacyEdge) {
      // Regular edge handling (only for non-legacy edges)
      const fromPosition = new THREE.Vector3().copy(fromResult.position);

      this.connectIntermediateToEdgePoints(
        tempAdjacencies,
        fromPosition,
        fromResult,
        fromEdge?.dir,
        fromIsAreaEdge
      );
    }

    // Special case: handle mixed legacy/graph pathfinding
    if (fromIsLegacyEdge && !toIsLegacyEdge && !toIsAreaGroupEdge) {
      // 'from' is on legacy NavMesh, 'to' is on regular graph
      // Connect the 'to' intermediate point to its actual edge points
      if (toResult.fromPointId && toResult.toPointId) {
        tempAdjacencies
          .get(toResult.fromPointId)!
          .push(constants.TO_INTERMEDIATE);
        tempAdjacencies
          .get(toResult.toPointId)!
          .push(constants.TO_INTERMEDIATE);
      }
    } else if (!fromIsLegacyEdge && toIsLegacyEdge && !fromIsAreaGroupEdge) {
      // 'from' is on regular graph, 'to' is on legacy NavMesh
      // Connect the 'from' intermediate point to its actual edge points
      if (fromResult.fromPointId && fromResult.toPointId) {
        tempAdjacencies
          .get(fromResult.fromPointId)!
          .push(constants.FROM_INTERMEDIATE);
        tempAdjacencies
          .get(fromResult.toPointId)!
          .push(constants.FROM_INTERMEDIATE);
      }
    } else if (fromIsLegacyEdge && toIsLegacyEdge) {
      // Both 'from' and 'to' are on legacy NavMesh
      // Add direct connection between intermediate points
      const legacyNavMeshQuery = this._legacyNavMeshQuery;
      if (legacyNavMeshQuery) {
        try {
          const fromV3 = new THREE.Vector3().copy(fromResult.position);
          const toV3 = new THREE.Vector3().copy(toResult.position);

          const path = legacyNavMeshQuery.computePath(fromV3, toV3);

          if (path.success && path.path) {
            const pathLength = geometry.calculatePathLength(path.path);
            addAdjacency(
              tempAdjacencies,
              constants.FROM_INTERMEDIATE,
              constants.TO_INTERMEDIATE,
              true
            );
            this.setEdgeWeightAndPath(
              constants.FROM_INTERMEDIATE,
              constants.TO_INTERMEDIATE,
              pathLength,
              path.path,
              tempPaths,
              constants.createDirectPathKey()
            );
          }
        } catch (error) {
          console.error("Failed to compute direct legacy NavMesh path:", error);
        }
      }
    }

    // Special case: handle same-areaGroup direct connections
    if (
      fromIsAreaEdge &&
      toIsAreaEdge &&
      fromEdgeAreaGroups[0] === toEdgeAreaGroups[0]
    ) {
      // Both 'from' and 'to' are in the same areaGroup - check for direct connection
      const areaGroupId = fromEdgeAreaGroups[0];
      const navMeshQuery = this._areaGroupNavMeshQueries.get(areaGroupId);

      if (navMeshQuery) {
        const fromV3 = new THREE.Vector3().copy(fromResult.position);
        const toV3 = new THREE.Vector3().copy(toResult.position);

        this.computeNavMeshPathAndConnect(
          navMeshQuery,
          fromV3,
          toV3,
          constants.FROM_INTERMEDIATE,
          constants.TO_INTERMEDIATE,
          tempAdjacencies,
          tempPaths,
          constants.createDirectPathKey()
        );
      }
    }

    // Handle legacy NavMesh edges for 'to'
    if (toIsLegacyEdge) {
      const legacyNavMeshQuery = this._legacyNavMeshQuery;
      if (legacyNavMeshQuery) {
        // Find all graph points that intersect with the legacy NavMesh
        const connectedPoints: string[] = [];

        // Connect to all graph points that intersect with legacy NavMesh
        Object.entries(this._map.points).forEach(([pointId, point]) => {
          if (recastUtils.isPointOnLegacyNavMesh(point, legacyNavMeshQuery)) {
            // Check if this point is reachable from the to position
            try {
              const pointV3 = new THREE.Vector3().copy(point);
              const toV3 = new THREE.Vector3().copy(toResult.position);

              const path = legacyNavMeshQuery.computePath(pointV3, toV3);
              if (path.success && path.path) {
                const pathLength = geometry.calculatePathLength(path.path);
                tempPaths.set(
                  constants.createToIntermediatePathKey(pointId),
                  path.path
                );
                // Store the actual path length for Dijkstra
                const storedKey = createEdgeWeightKey(
                  pointId,
                  constants.TO_INTERMEDIATE
                );
                this.addEdgeWeight(pointId, constants.TO_INTERMEDIATE, {
                  weight: pathLength,
                  type: "legacy",
                  path: path.path,
                });
                connectedPoints.push(pointId);
              }
            } catch (error) {
              console.error(
                `Failed to compute path from point ${pointId}:`,
                error
              );
            }
          }
        });

        if (connectedPoints.length > 0) {
          tempAdjacencies.set(constants.TO_INTERMEDIATE, connectedPoints);

          // Also add reverse connections from intermediate to points
          connectedPoints.forEach((pointId) => {
            tempAdjacencies.get(pointId)!.push(constants.TO_INTERMEDIATE);
          });
        }
      }
    }
    // Handle areaGroup edges for 'to'
    else if (toIsAreaEdge) {
      const areaGroupId = toEdgeAreaGroups[0];

      // Check if both points are in the same areaGroup - if so, skip exit connections
      const bothInSameAreaGroup =
        fromIsAreaEdge && fromEdgeAreaGroups[0] === areaGroupId;

      if (!bothInSameAreaGroup) {
        // Get true exit points for this areaGroup
        const allExitPoints = graphUtils.findExitPointsForGroup(
          this._map,
          areaGroupId,
          this._areaGroups.get(areaGroupId) || [],
          this._legacyNavMeshQuery
        );

        const exitPoints = Array.from(allExitPoints);
        const navMeshQuery = this._areaGroupNavMeshQueries.get(areaGroupId);

        if (exitPoints.length > 0 && navMeshQuery) {
          const connectedExits: string[] = [];

          // Compute NavMesh path from ALL exit points
          for (const exitId of exitPoints) {
            const fromV3 = new THREE.Vector3().copy(
              this.getMapPointInternal(exitId)!
            );
            const toV3 = new THREE.Vector3().copy(toResult.position);

            const success = this.computeNavMeshPathAndConnect(
              navMeshQuery,
              fromV3,
              toV3,
              exitId,
              constants.TO_INTERMEDIATE,
              tempAdjacencies,
              tempPaths,
              constants.createToIntermediatePathKey(exitId)
            );

            if (success) {
              connectedExits.push(exitId);
            }
          }

          // Connect ALL successful exits to intermediate point
          if (connectedExits.length > 0) {
            const existingToNeighbors =
              tempAdjacencies.get(constants.TO_INTERMEDIATE) || [];
            const allToNeighbors = [...existingToNeighbors, ...connectedExits];
            tempAdjacencies.set(constants.TO_INTERMEDIATE, allToNeighbors);

            // Also add reverse connections from intermediate to exits
            connectedExits.forEach((exitId) => {
              tempAdjacencies.get(exitId)!.push(constants.TO_INTERMEDIATE);
            });
          }
        }
      }
    } else if (!toIsLegacyEdge) {
      // Regular edge handling (only for non-legacy edges)
      const toPosition = new THREE.Vector3().copy(toResult.position);

      this.connectIntermediateToEdgePointsTo(
        tempAdjacencies,
        toPosition,
        toResult,
        toEdge?.dir,
        toIsAreaEdge
      );
    }

    return { tempAdjacencyList: tempAdjacencies, tempPaths };
  }

  private addPointToAllExitPoints(
    tempAdjacencies: Map<string, string[]>,
    tempPaths: Map<string, THREE.Vector3Like[]>,
    tempPointId: string,
    position: THREE.Vector3Like,
    areaGroupId: string
  ): void {
    if (areaGroupId) {
      const navMeshQuery = this._areaGroupNavMeshQueries.get(areaGroupId);
      // Get true exit points for this areaGroup
      const exitPoints = graphUtils.findExitPointsForGroup(
        this._map,
        areaGroupId,
        this._areaGroups.get(areaGroupId) || [],
        this._legacyNavMeshQuery
      );

      if (navMeshQuery) {
        exitPoints.forEach((pointId) => {
          const exitPosition = this.getMapPointInternal(pointId);
          if (exitPosition) {
            try {
              const fromV3 = new THREE.Vector3().copy(position);
              const exitV3 = new THREE.Vector3().copy(exitPosition);

              const path = navMeshQuery.computePath(fromV3, exitV3);
              if (path.success && path.path) {
                addAdjacency(tempAdjacencies, tempPointId, pointId, true);
                const distance = geometry.calculatePathLength(path.path);
                this.setEdgeWeightAndPath(
                  tempPointId,
                  pointId,
                  distance,
                  path.path,
                  tempPaths,
                  constants.createEdgeWeightKey(tempPointId, pointId)
                );
                this.setEdgeWeightAndPath(
                  pointId,
                  tempPointId,
                  distance,
                  path.path.toReversed(),
                  tempPaths,
                  constants.createEdgeWeightKey(pointId, tempPointId)
                );
              }
            } catch (error) {
              console.error(
                `Failed to compute path to exit point ${pointId}:`,
                error
              );
            }
          }
        });
      }
    }
  }

  private dijkstraWithTempGraph(
    tempGraph: Map<string, string[]>,
    from: string,
    to: string
  ): string[] | null {
    const distances = new Map<string, number>();
    const previous = new Map<string, string | null>();
    const visited = new Set<string>();
    const queue = new Map<string, number>();

    // Initialize with all nodes from temp graph
    tempGraph.forEach((_, nodeId) => {
      distances.set(nodeId, Infinity);
      previous.set(nodeId, null);
    });
    distances.set(from, 0);
    queue.set(from, 0);

    while (queue.size > 0) {
      // Find node with minimum distance
      let current = "";
      let minDist = Infinity;
      queue.forEach((dist, node) => {
        if (dist < minDist) {
          minDist = dist;
          current = node;
        }
      });

      if (current === to) break;
      if (minDist === Infinity) break;

      queue.delete(current);
      visited.add(current);

      // Check neighbors
      const neighbors = tempGraph.get(current) || [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;

        const edgeWeightKey = createEdgeWeightKey(current, neighbor);
        const edgeWeight = graphUtils.getEdgeWeight(
          this._edgeWeights,
          current,
          neighbor
        );
        const newDist = distances.get(current)! + edgeWeight;

        if (newDist < (distances.get(neighbor) || Infinity)) {
          distances.set(neighbor, newDist);
          previous.set(neighbor, current);
          queue.set(neighbor, newDist);
        }
      }
    }

    return pathfinding.reconstructPath(previous, from, to);
  }

  private async initializeLegacyAreaNavMeshes(): Promise<void> {
    if (!this._map) return;

    await init();

    const legacyMeshes = this._legacyMeshes;
    if (legacyMeshes.length === 0) {
      console.log(
        "No legacy navmeshes found, skipping legacy NavMesh creation"
      );
      return;
    }

    let nmResult;
    try {
      nmResult = threeToSoloNavMesh(legacyMeshes, {
        walkableRadius: 0,
        cs: 0.05,
        ch: 0.05,
        maxSimplificationError: 0.5,
        minRegionArea: 0,
        mergeRegionArea: 0,
        detailSampleDist: 2,
        detailSampleMaxError: 0.5,
        maxEdgeLen: 30,
      });
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

  private async initializeLegacyAreaConnections(): Promise<void> {
    if (!this._map) {
      return;
    }

    const lnmQuery = this._legacyNavMeshQuery;
    if (!lnmQuery) {
      return;
    }

    // Find all existing graph points that intersect with the legacy NavMesh
    const intersectingPoints: string[] = [];

    Object.entries(this._map.points).forEach(([pointId, point]) => {
      if (recastUtils.isPointOnLegacyNavMesh(point, lnmQuery)) {
        intersectingPoints.push(pointId);
      }
    });

    // Add direct NavMesh connections between all pairs of intersecting points
    // This treats the legacy NavMesh like an area with precomputed internal connections
    await this.addDirectLegacyNavMeshConnections(intersectingPoints, lnmQuery);
  }

  private async addDirectLegacyNavMeshConnections(
    intersectingPoints: string[],
    navMeshQuery: NavMeshQuery
  ): Promise<void> {
    // Add direct NavMesh connections between all pairs of intersecting points
    for (let i = 0; i < intersectingPoints.length; i++) {
      for (let j = i + 1; j < intersectingPoints.length; j++) {
        const fromId = intersectingPoints[i];
        const toId = intersectingPoints[j];

        const fromPoint = this._map.points[fromId];
        const toPoint = this._map.points[toId];

        // Use NavMesh to find path between points
        const fromV3 = new THREE.Vector3().copy(fromPoint);
        const toV3 = new THREE.Vector3().copy(toPoint);

        this.computePrecomputedNavMeshPath(
          navMeshQuery,
          fromV3,
          toV3,
          fromId,
          toId
        );
      }
    }
  }

  private async initializeAreaGroupNavMeshes(): Promise<void> {
    if (!this._map) return;

    for (const [groupId, areaIds] of this._areaGroups) {
      // Collect all area meshes in this group
      const areaMeshes: THREE.Mesh[] = [];

      for (const areaId of areaIds) {
        const areaMesh = this._areaMeshes[areaId];
        if (areaMesh) {
          areaMeshes.push(areaMesh);
        }
      }

      if (areaMeshes.length === 0) continue;

      try {
        const nmResult = threeToSoloNavMesh(areaMeshes, {
          ...constants.DEFAULT_NAVMESH_PARAMS,
        });
        if (nmResult.navMesh) {
          this._areaGroupNavMeshes.set(groupId, nmResult.navMesh);

          const navMeshQuery = new NavMeshQuery(nmResult.navMesh);
          this._areaGroupNavMeshQueries.set(groupId, navMeshQuery);
        }
      } catch (error) {
        console.error(
          `Failed to build NavMesh for areaGroup ${groupId}:`,
          error
        );
      }
    }
  }

  private async initializeAreaGroupDistances(): Promise<void> {
    if (!this._map) return;

    for (const [groupId, areaIds] of this._areaGroups) {
      const navMesh = this._areaGroupNavMeshQueries.get(groupId);
      if (!navMesh) continue;

      // Get true exit points for this areaGroup
      const allExitPoints = graphUtils.findExitPointsForGroup(
        this._map,
        groupId,
        areaIds,
        this._legacyNavMeshQuery
      );

      const exitPointsArray = Array.from(allExitPoints);

      // Pre-compute distances between all pairs of exit points in this areaGroup
      for (let i = 0; i < exitPointsArray.length; i++) {
        for (let j = i + 1; j < exitPointsArray.length; j++) {
          const fromPointId = exitPointsArray[i];
          const toPointId = exitPointsArray[j];

          const fromPoint = this.getMapPointInternal(fromPointId)!;
          const toPoint = this.getMapPointInternal(toPointId)!;

          if (fromPoint && toPoint) {
            const from = new THREE.Vector3().copy(fromPoint);
            const to = new THREE.Vector3().copy(toPoint);

            const path = navMesh.computePath(from, to);
            if (path.success && path.path) {
              const distance = geometry.calculatePathLength(path.path);

              // Store both directions
              this.addEdgeWeight(fromPointId, toPointId, {
                weight: distance,
                type: "areaGroup",
                path: path.path,
              });
              this.addEdgeWeight(toPointId, fromPointId, {
                weight: distance,
                type: "areaGroup",
                path: path.path.toReversed(),
              });
            }
          }
        }
      }
    }
  }
}
