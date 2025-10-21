import { init, NavMesh, NavMeshQuery } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import * as THREE from "three";
import {
  Area,
  Edge,
  NavMap,
  EdgeWeightInfo,
  PathResult,
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
  private _map: NavMap;
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

  async load(map: NavMap, legacyNavmesh: THREE.Mesh[]) {
    this.isLoaded = false;
    this.cleanUp();

    this._map = map;
    this._legacyMeshes = legacyNavmesh;
    await init();
    this.initializeMapAreas();
    this.buildAreaGroups();
    this.initializeLegacyAreaNavMeshes();
    this.buildEdgeConnections();
    this.initializeAreaGroupNavMeshes();
    this.initializeAreaGroupDistances();
    this.initializeLegacyAreaConnections();
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
   * Check if an edge belongs to any areaGroup
   */
  private getAreaGroupsContainingEdge(edgeId: string): string[] {
    const areaIds = graphUtils.getAreasContainingEdge(this._map, edgeId);
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

  private buildEdgeConnections() {
    if (!this._map) return;

    // Build connections and calculate weights
    Object.entries(this._map.edges).forEach(([edgeId, edge]) => {
      const fromPoint = this.getMapPointInternal(edge.from)!;
      const toPoint = this.getMapPointInternal(edge.to)!;

      if (!fromPoint || !toPoint) {
        return;
      }

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

      const doTo = edge.dir === undefined || edge.dir === 0 || edge.dir === 1;
      const doFrom =
        edge.dir === undefined || edge.dir === 0 || edge.dir === -1;

      if (doTo) {
        // One-way edge - only add from -> to connection
        addAdjacency(
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

  findPath(
    from: THREE.Vector3Like,
    to: THREE.Vector3Like
  ): THREE.Vector3Like[] | null {
    if (!this._map) {
      return null;
    }

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

    // Use unified pathfinding logic for all cases
    const fromResult = pathfinding.chooseClosestResult(
      fromEdgeResult,
      fromLegacyResult,
      fromAreaResult ? { areaGroupId: fromAreaResult, position: from } : null
    );
    const toResult = pathfinding.chooseClosestResult(
      toEdgeResult,
      toLegacyResult,
      toAreaResult ? { areaGroupId: toAreaResult, position: to } : null
    );

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
    const tempGraphResults = this.createTempGraph(fromResult, toResult);
    const { tempAdjacencies, tempEdgeWeights } = tempGraphResults;

    let graphPath = this.dijkstraWithTempGraph(
      tempAdjacencies,
      tempEdgeWeights,
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

      tempEdgeWeights
    );
  }

  private convertGraphPathToWorldPath(
    graphPath: string[],
    fromResult: any,
    toResult: any,
    from: THREE.Vector3Like,
    to: THREE.Vector3Like,
    tempEdgeWeights: Map<string, EdgeWeightInfo[]>
  ): THREE.Vector3Like[] {
    const fullPath: THREE.Vector3Like[] = [from];

    for (let i = 0; i < graphPath.length - 1; i++) {
      const currentNode = graphPath[i];
      const nextNode = graphPath[i + 1];

      if (nextNode) {
        // Create path key using the same pattern for all nodes
        const pathKey = createEdgeWeightKey(currentNode, nextNode);
        const staticConnections = this._edgeWeights.get(pathKey);
        const tempConnections = tempEdgeWeights.get(pathKey);

        let chosenStaticConnection: EdgeWeightInfo | null = null;
        let chosenTempConnection: EdgeWeightInfo | null = null;
        if (staticConnections && staticConnections.length > 0) {
          chosenStaticConnection = staticConnections.reduce((min, conn) =>
            conn.weight < min.weight ? conn : min
          );
        }
        if (tempConnections && tempConnections.length > 0) {
          chosenTempConnection = tempConnections.reduce((min, conn) =>
            conn.weight < min.weight ? conn : min
          );
        }
        let chosenConnection: EdgeWeightInfo | null = null;
        if (chosenStaticConnection && chosenTempConnection) {
          chosenConnection =
            chosenStaticConnection.weight < chosenTempConnection.weight
              ? chosenStaticConnection
              : chosenTempConnection;
        } else if (chosenStaticConnection) {
          chosenConnection = chosenStaticConnection;
        } else if (chosenTempConnection) {
          chosenConnection = chosenTempConnection;
        }
        if (chosenConnection) {
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
   * Helper function to compute NavMesh path and add connection
   */
  private computeNavMeshPathAndConnect(
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

  private addIntermediateNodeToTempGraph(
    tempAdjacencies: Map<string, string[]>,
    tempEdgeWeights: Map<string, EdgeWeightInfo[]>,
    nodeId: string,
    node: PathResult
  ): void {
    const isLegacyEdge = node.type === "legacy";
    const isAreaGroupEdge = node.type === "areaGroup";

    if (isLegacyEdge) {
    } else if (isAreaGroupEdge) {
      const areaGroupId = node.areaGroupId;

      this.addPointToAllExitPoints(
        tempAdjacencies,
        tempEdgeWeights,
        nodeId,
        node.position,
        areaGroupId
      );
    } else {
      // Regular edge handling
      const edgeId = node.edgeId;
      const fromEdge = this.getMapEdge(edgeId);
      if (!fromEdge) return;
      const dir = fromEdge.dir;
      const doTo = dir === undefined || dir === 0 || dir === 1;
      const doFrom = dir === undefined || dir === 0 || dir === -1;

      if (doTo) {
        // Bidirectional or undefined - add both directions
        addAdjacency(
          tempAdjacencies,
          tempEdgeWeights,
          nodeId,
          node.toPointId,
          true,
          {
            weight: node.distance,
            path: [node.position, this.getMapPointInternal(node.toPointId)!],
          }
        );
      }
      if (doFrom) {
        addAdjacency(
          tempAdjacencies,
          tempEdgeWeights,
          nodeId,
          node.fromPointId,
          true,
          {
            weight: node.distance,
            path: [node.position, this.getMapPointInternal(node.fromPointId)!],
          }
        );
      }
    }

    const fromEdgeAreaGroups = this.getAreaGroupsContainingEdge(
      node.type === "edge" ? node.edgeId : ""
    );
    const fromIsAreaEdge = fromEdgeAreaGroups.length > 0;

    if (isLegacyEdge) {
      const legacyNavMeshQuery = this._legacyNavMeshQuery;
      if (legacyNavMeshQuery) {
        // Find all graph points that intersect with the legacy NavMesh
        Object.entries(this._map.points).forEach(([pointId, point]) => {
          if (recastUtils.isPointOnLegacyNavMesh(point, legacyNavMeshQuery)) {
            // Connect to all graph points that intersect with legacy NavMesh
            this.computeNavMeshPathAndConnect(
              legacyNavMeshQuery,
              node.position,
              point,
              nodeId,
              pointId,
              tempAdjacencies,
              tempEdgeWeights
            );
          }
        });
      }
    } else if (fromIsAreaEdge) {
      const areaGroupId = fromEdgeAreaGroups[0];

      this.addPointToAllExitPoints(
        tempAdjacencies,
        tempEdgeWeights,
        nodeId,
        node.position,
        areaGroupId
      );
    }
  }

  private createTempGraph(
    fromResult: PathResult,
    toResult: PathResult
  ): {
    tempAdjacencies: Map<string, string[]>;
    tempEdgeWeights: Map<string, EdgeWeightInfo[]>;
  } {
    // Create a copy of the adjacency list
    const tempAdjacencies = new Map<string, string[]>();
    const tempEdgeWeights = new Map<string, EdgeWeightInfo[]>();

    this.addIntermediateNodeToTempGraph(
      tempAdjacencies,
      tempEdgeWeights,
      constants.FROM_INTERMEDIATE,
      fromResult
    );

    this.addIntermediateNodeToTempGraph(
      tempAdjacencies,
      tempEdgeWeights,
      constants.TO_INTERMEDIATE,
      toResult
    );

    // Determine edge types using union type discrimination
    const fromIsLegacyEdge = fromResult.type === "legacy";
    const toIsLegacyEdge = toResult.type === "legacy";
    const fromIsAreaGroupEdge = fromResult.type === "areaGroup";
    const toIsAreaGroupEdge = toResult.type === "areaGroup";

    // Extract edge information for non-legacy, non-areaGroup results
    const fromEdgeId = fromResult.type === "edge" ? fromResult.edgeId : "";
    const toEdgeId = toResult.type === "edge" ? toResult.edgeId : "";

    const fromEdgeAreaGroups = fromIsLegacyEdge
      ? []
      : this.getAreaGroupsContainingEdge(fromEdgeId);
    const toEdgeAreaGroups = toIsLegacyEdge
      ? []
      : this.getAreaGroupsContainingEdge(toEdgeId);

    // Add connections from existing nodes to intermediate points
    const fromIsAreaEdge = fromIsLegacyEdge
      ? false
      : fromEdgeAreaGroups.length > 0;
    const toIsAreaEdge = toIsLegacyEdge ? false : toEdgeAreaGroups.length > 0;

    // Determine the appropriate NavMesh query for direct connections
    let directNavMeshQuery: NavMeshQuery | null = null;

    // Special case: if both points are in the same areaGroup, add direct connection
    if (
      fromIsAreaGroupEdge &&
      toIsAreaGroupEdge &&
      fromResult.type === "areaGroup" &&
      toResult.type === "areaGroup" &&
      fromResult.areaGroupId === toResult.areaGroupId
    ) {
      const areaGroupId = fromResult.areaGroupId;
      directNavMeshQuery =
        this._areaGroupNavMeshQueries.get(areaGroupId) || null;
    }
    // Mixed case: from off-mesh, to in areaGroup, but same areaGroup
    else if (
      fromResult.type === "edge" &&
      toResult.type === "areaGroup" &&
      fromEdgeAreaGroups.includes(toResult.areaGroupId)
    ) {
      const areaGroupId = toResult.areaGroupId;
      directNavMeshQuery =
        this._areaGroupNavMeshQueries.get(areaGroupId) || null;
    }
    // Mixed case: to off-mesh, from in areaGroup, but same areaGroup
    else if (
      toResult.type === "edge" &&
      fromResult.type === "areaGroup" &&
      toEdgeAreaGroups.includes(fromResult.areaGroupId)
    ) {
      const areaGroupId = fromResult.areaGroupId;
      directNavMeshQuery =
        this._areaGroupNavMeshQueries.get(areaGroupId) || null;
    }
    // Both 'from' and 'to' are on legacy NavMesh
    else if (fromIsLegacyEdge && toIsLegacyEdge) {
      directNavMeshQuery = this._legacyNavMeshQuery;
    }
    // Both 'from' and 'to' are in the same areaGroup (regular edge case)
    else if (
      fromIsAreaEdge &&
      toIsAreaEdge &&
      fromEdgeAreaGroups[0] === toEdgeAreaGroups[0]
    ) {
      const areaGroupId = fromEdgeAreaGroups[0];
      directNavMeshQuery =
        this._areaGroupNavMeshQueries.get(areaGroupId) || null;
    }

    // Execute direct connection if we found a suitable NavMesh query
    if (directNavMeshQuery) {
      this.computeNavMeshPathAndConnect(
        directNavMeshQuery,
        fromResult.position,
        toResult.position,
        constants.FROM_INTERMEDIATE,
        constants.TO_INTERMEDIATE,
        tempAdjacencies,
        tempEdgeWeights
      );
    }

    return {
      tempAdjacencies,
      tempEdgeWeights,
    };
  }

  private addPointToAllExitPoints(
    tempAdjacencies: Map<string, string[]>,
    tempEdgeWeights: Map<string, EdgeWeightInfo[]>,
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
              this.computeNavMeshPathAndConnect(
                navMeshQuery,
                position,
                exitPosition,
                tempPointId,
                pointId,
                tempAdjacencies,
                tempEdgeWeights
              );
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
    tempEdgeWeights: Map<string, EdgeWeightInfo[]>,
    from: string,
    to: string
  ): string[] | null {
    const distances = new Map<string, number>();
    const previous = new Map<string, string | null>();
    const visited = new Set<string>();
    const queue = new Map<string, number>();

    this._adjacencies.forEach((_, nodeId) => {
      distances.set(nodeId, Infinity);
      previous.set(nodeId, null);
    });

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
      const tempNeighbors = tempGraph.get(current) || [];
      const staticNeighbors = this._adjacencies.get(current) || [];
      const neighbors = [...new Set([...tempNeighbors, ...staticNeighbors])];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;

        const staticEdgeWeight = graphUtils.getEdgeWeight(
          this._edgeWeights,
          current,
          neighbor
        );

        const tempEdgeWeight = graphUtils.getEdgeWeight(
          tempEdgeWeights,
          current,
          neighbor
        );

        const edgeWeight = Math.min(staticEdgeWeight, tempEdgeWeight);

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

  private initializeLegacyAreaNavMeshes() {
    if (!this._map) return;

    const legacyMeshes = this._legacyMeshes;
    if (legacyMeshes.length === 0) {
      console.log(
        "No legacy navmeshes found, skipping legacy NavMesh creation"
      );
      return;
    }

    let nmResult;
    try {
      nmResult = threeToSoloNavMesh(
        legacyMeshes,
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

  private initializeLegacyAreaConnections() {
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
    for (let i = 0; i < intersectingPoints.length; i++) {
      for (let j = i + 1; j < intersectingPoints.length; j++) {
        const fromId = intersectingPoints[i];
        const toId = intersectingPoints[j];

        const fromPoint = this._map.points[fromId];
        const toPoint = this._map.points[toId];

        this.computeNavMeshPathAndConnect(
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

  private initializeAreaGroupNavMeshes() {
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
        const nmResult = threeToSoloNavMesh(
          areaMeshes,
          constants.DEFAULT_NAVMESH_PARAMS
        );
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

  private initializeAreaGroupDistances() {
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

      // Pre-compute distances between all pairs of exit points in this areaGroup
      for (let i = 0; i < allExitPoints.length; i++) {
        for (let j = i + 1; j < allExitPoints.length; j++) {
          const fromPointId = allExitPoints[i];
          const toPointId = allExitPoints[j];

          const fromPoint = this.getMapPointInternal(fromPointId)!;
          const toPoint = this.getMapPointInternal(toPointId)!;

          if (fromPoint && toPoint) {
            this.computeNavMeshPathAndConnect(
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
}
