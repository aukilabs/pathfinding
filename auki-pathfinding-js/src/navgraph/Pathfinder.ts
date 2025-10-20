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
import * as mapUtils from "./GraphUtils";
import * as recastUtils from "./RecastUtils";
import * as pathfinding from "./PathfindingUtils";
import * as constants from "./Constants";
const { createEdgeWeightKey } = constants;

export type NavOptions = {
  maxDistance?: number;
  maxOffGraphDistance?: number; // Maximum distance to find nearest point
};

export class Pathfinder {
  private _map: NavigationGraph;
  private _config: NavOptions;
  private _adjacencyList: Map<string, string[]> = new Map();
  private _edgeWeights: Map<string, EdgeWeightInfo[]> = new Map();

  private _areaMeshes: Record<string, THREE.Mesh> = {};
  private _areaNavMeshes: Map<string, NavMesh> = new Map(); // Cache navmeshes for areas
  private _areaNavMeshQueries: Map<string, NavMeshQuery> = new Map(); // Cache navmeshes for areas

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
    return this._areaNavMeshes;
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
    return this._adjacencyList;
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
    await this.initializeAreaNavMeshes();
    await this.initializeAreaDistances();
    await this.initializeLegacyAreaConnections();
    this.isLoaded = true;
  }

  private initializeMapAreas() {
    for (const [areaId, area] of Object.entries(this._map.areas)) {
      const polygon = mapUtils.buildPolygonFromArea(areaId, this._map);
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
    this._adjacencyList.clear();
    this._edgeWeights.clear();
    this._legacyNavMesh?.destroy();
    this._legacyNavMesh = null;
    this._legacyNavMeshQuery?.destroy();
    this._legacyNavMeshQuery = null;
    this._areaNavMeshes.forEach((navMesh) => navMesh.destroy());
    this._areaNavMeshes.clear();
    this._areaNavMeshQueries.forEach((query) => query.destroy());
    this._areaNavMeshQueries.clear();
  }

  setConfig(config: NavOptions) {
    this._config = { ...this._config, ...config };
  }

  private buildAdjacencyList() {
    if (!this._map) return;

    // Initialize adjacency list for original points only
    Object.keys(this._map.points).forEach((pointId) => {
      this._adjacencyList.set(pointId, []);
    });

    // Build connections and calculate weights
    Object.entries(this._map.edges).forEach(([edgeId, edge]) => {
      const fromPoint = this.getMapPointInternal(edge.from)!;
      const toPoint = this.getMapPointInternal(edge.to)!;

      if (fromPoint && toPoint) {
        // Check if this edge belongs to any area
        const edgeAreas = mapUtils.getAreasContainingEdge(this._map, edgeId);
        const isAreaEdge = edgeAreas.length > 0;

        // Skip edges that belong to areas - they'll be handled by exit-to-exit connections
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
          this._adjacencyList.get(edge.from)!.push(edge.to);
          this._adjacencyList.get(edge.to)!.push(edge.from);

          this.addEdgeWeightConnection(edge.from, edge.to, {
            weight,
            type: "direct",
            path: [fromPoint, toPoint],
          });
          this.addEdgeWeightConnection(edge.to, edge.from, {
            weight,
            type: "direct",
            path: [toPoint, fromPoint],
          });
        } else if (edge.dir === 1) {
          // One-way edge - only add from -> to connection
          this._adjacencyList.get(edge.from)!.push(edge.to);
          this.addEdgeWeightConnection(edge.from, edge.to, {
            weight,
            type: "direct",
            path: [fromPoint, toPoint],
          });
        } else if (edge.dir === -1) {
          // One-way-reverse edge - only add to -> from connection
          this._adjacencyList.get(edge.to)!.push(edge.from);
          this.addEdgeWeightConnection(edge.to, edge.from, {
            weight,
            type: "direct",
            path: [toPoint, fromPoint],
          });
        }
      }
    });

    // Add area-based exit-to-exit connections
    Object.entries(this._map.areas).forEach(([areaId, area]) => {
      const exitPoints = mapUtils.findExitPoints(
        this._map,
        areaId,
        this._legacyNavMeshQuery
      );

      // Connect all exit points within the same area
      for (let i = 0; i < exitPoints.length; i++) {
        for (let j = 0; j < exitPoints.length; j++) {
          if (i !== j) {
            const fromId = exitPoints[i];
            const toId = exitPoints[j];

            // Add bidirectional connection
            this._adjacencyList.get(fromId)!.push(toId);
            this._adjacencyList.get(toId)!.push(fromId);

            // Weight will be set by initializeAreaDistances
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
    const fromEdgeResult = this.getNearestPositionOnEdge(from);
    const toEdgeResult = this.getNearestPositionOnEdge(to);

    // Find nearest positions on legacy NavMesh
    const fromLegacyResult = recastUtils.getNearestPositionOnLegacyNavMesh(
      this._legacyNavMeshQuery,
      from
    );
    const toLegacyResult = recastUtils.getNearestPositionOnLegacyNavMesh(
      this._legacyNavMeshQuery,
      to
    );

    // Use unified pathfinding logic for all cases
    const fromResult = pathfinding.chooseClosestResult(
      fromEdgeResult,
      fromLegacyResult,
      from
    );
    const toResult = pathfinding.chooseClosestResult(
      toEdgeResult,
      toLegacyResult,
      to
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
  private addEdgeWeightConnection(
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
   * Helper function to add a neighbor to an adjacency list
   */
  private addNeighborToAdjacencyList(
    adjacencyList: Map<string, string[]>,
    nodeId: string,
    neighborId: string
  ): void {
    const neighbors = adjacencyList.get(nodeId) || [];
    if (!neighbors.includes(neighborId)) {
      neighbors.push(neighborId);
      adjacencyList.set(nodeId, neighbors);
    }
  }

  /**
   * Helper function to add bidirectional connection between two nodes
   */
  private addBidirectionalConnection(
    adjacencyList: Map<string, string[]>,
    nodeA: string,
    nodeB: string
  ): void {
    this.addNeighborToAdjacencyList(adjacencyList, nodeA, nodeB);
    this.addNeighborToAdjacencyList(adjacencyList, nodeB, nodeA);
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
    this.addEdgeWeightConnection(fromId, toId, {
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
        this.addBidirectionalConnection(adjacencyList, fromId, toId);
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
        this._adjacencyList.get(fromId)!.push(toId);
        this._adjacencyList.get(toId)!.push(fromId);

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
          this.addEdgeWeightConnection(fromId, toId, {
            weight: navMeshDistance,
            type: "legacy",
            path: path.path,
          });
          this.addEdgeWeightConnection(toId, fromId, {
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
    tempAdjacencyList: Map<string, string[]>,
    fromPosition: THREE.Vector3Like,
    fromResult: { fromPointId: string; toPointId: string },
    edgeDir?: number,
    isAreaEdge?: boolean
  ): void {
    if (!edgeDir || isAreaEdge) {
      // Two-way edge - connect to both points
      this.connectToPoint(
        tempAdjacencyList,
        fromPosition,
        fromResult.fromPointId
      );
      this.connectToPoint(
        tempAdjacencyList,
        fromPosition,
        fromResult.toPointId
      );
    } else if (edgeDir === 1) {
      // One-way edge - only connect to fromPoint
      this.connectToPoint(
        tempAdjacencyList,
        fromPosition,
        fromResult.fromPointId
      );
    } else if (edgeDir === -1) {
      // One-way-reverse edge - only connect to toPoint
      this.connectToPoint(
        tempAdjacencyList,
        fromPosition,
        fromResult.toPointId
      );
    }
  }

  /**
   * Helper function to connect intermediate point to a specific edge point
   */
  private connectToPoint(
    tempAdjacencyList: Map<string, string[]>,
    fromPosition: THREE.Vector3Like,
    pointId: string
  ): void {
    const point = this.getMapPointInternal(pointId);
    if (point) {
      const distance = new THREE.Vector3().copy(point).distanceTo(fromPosition);
      tempAdjacencyList.get(pointId)!.push(constants.FROM_INTERMEDIATE);
      this.addEdgeWeightConnection(constants.FROM_INTERMEDIATE, pointId, {
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
    tempAdjacencyList: Map<string, string[]>,
    toPosition: THREE.Vector3Like,
    toResult: { fromPointId: string; toPointId: string },
    edgeDir?: number,
    isAreaEdge?: boolean
  ): void {
    if (!edgeDir || isAreaEdge) {
      // Two-way edge - connect to both points
      this.connectToPointTo(
        tempAdjacencyList,
        toPosition,
        toResult.fromPointId
      );
      this.connectToPointTo(tempAdjacencyList, toPosition, toResult.toPointId);
    } else if (edgeDir === 1) {
      // One-way edge - only connect to fromPoint
      this.connectToPointTo(
        tempAdjacencyList,
        toPosition,
        toResult.fromPointId
      );
    } else if (edgeDir === -1) {
      // One-way-reverse edge - only connect to toPoint
      this.connectToPointTo(tempAdjacencyList, toPosition, toResult.toPointId);
    }
  }

  /**
   * Helper function to connect intermediate point to a specific edge point for "to" side
   */
  private connectToPointTo(
    tempAdjacencyList: Map<string, string[]>,
    toPosition: THREE.Vector3Like,
    pointId: string
  ): void {
    const point = this.getMapPointInternal(pointId);
    if (point) {
      const distance = new THREE.Vector3().copy(point).distanceTo(toPosition);
      tempAdjacencyList.get(pointId)!.push(constants.TO_INTERMEDIATE);
      this.addEdgeWeightConnection(pointId, constants.TO_INTERMEDIATE, {
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
    // Create a copy of the adjacency list
    const tempAdjacencyList = new Map<string, string[]>();
    const tempPaths = new Map<string, THREE.Vector3Like[]>(); // Local temporary storage

    // Copy existing connections
    this._adjacencyList.forEach((neighbors, nodeId) => {
      tempAdjacencyList.set(nodeId, [...neighbors]);
    });

    // Determine edge types
    const fromIsLegacyEdge =
      fromResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID;
    const toIsLegacyEdge =
      toResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID;

    // Add intermediate points as temporary nodes
    // For legacy NavMesh, we'll handle connections differently
    if (fromIsLegacyEdge) {
      tempAdjacencyList.set(constants.FROM_INTERMEDIATE, []);
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

      tempAdjacencyList.set(constants.FROM_INTERMEDIATE, fromConnections);
    }

    if (toIsLegacyEdge) {
      tempAdjacencyList.set(constants.TO_INTERMEDIATE, []);
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

      tempAdjacencyList.set(constants.TO_INTERMEDIATE, toConnections);
    }

    // Special case: if both points are on legacy NavMesh, add direct connection
    if (fromIsLegacyEdge && toIsLegacyEdge) {
      const directPath = pathfinding.tryDirectLegacyNavMeshPath(
        this._legacyNavMeshQuery,
        fromResult.position,
        toResult.position
      );

      if (directPath) {
        const directDistance = geometry.calculatePathLength(directPath);
        this.addBidirectionalConnection(
          tempAdjacencyList,
          constants.FROM_INTERMEDIATE,
          constants.TO_INTERMEDIATE
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
      ? []
      : mapUtils.getAreasContainingEdge(this._map, fromResult.edgeId).length >
        0;
    const toIsAreaEdge = toIsLegacyEdge
      ? []
      : mapUtils.getAreasContainingEdge(this._map, toResult.edgeId).length > 0;

    const fromEdge = fromIsLegacyEdge
      ? null
      : this._map!.edges[fromResult.edgeId];
    const toEdge = toIsLegacyEdge ? null : this._map.edges[toResult.edgeId];

    const fromEdgeAreas = fromIsLegacyEdge
      ? []
      : mapUtils.getAreasContainingEdge(this._map, fromResult.edgeId);
    const toEdgeAreas = toIsLegacyEdge
      ? []
      : mapUtils.getAreasContainingEdge(this._map, toResult.edgeId);

    //const fromIsAreaEdge = fromEdgeAreas.length > 0;
    //const toIsAreaEdge = toEdgeAreas.length > 0;

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
                this.addEdgeWeightConnection(
                  constants.FROM_INTERMEDIATE,
                  pointId,
                  {
                    weight: pathLength,
                    type: "legacy",
                    path: path.path,
                  }
                );
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
          tempAdjacencyList.set(constants.FROM_INTERMEDIATE, connectedPoints);

          // Also add reverse connections from points to intermediate
          connectedPoints.forEach((pointId) => {
            tempAdjacencyList.get(pointId)!.push(constants.FROM_INTERMEDIATE);
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
    // Handle area edges by computing NavMesh paths to nearest exit points
    else if (fromIsAreaEdge) {
      const areaId = fromEdgeAreas[0];

      const bothInSameArea = toIsAreaEdge && toEdgeAreas[0] === areaId;

      if (!bothInSameArea) {
        const exitPoints = mapUtils.findExitPoints(
          this._map,
          areaId,
          this._legacyNavMeshQuery
        );
        const navMeshQuery = this._areaNavMeshQueries.get(areaId);

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
              tempAdjacencyList,
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
              this.addNeighborToAdjacencyList(
                tempAdjacencyList,
                constants.FROM_INTERMEDIATE,
                exitId
              );
            });
          }
        }
      }
    } else if (!fromIsLegacyEdge) {
      // Regular edge handling (only for non-legacy edges)
      const fromPosition = new THREE.Vector3().copy(fromResult.position);

      this.connectIntermediateToEdgePoints(
        tempAdjacencyList,
        fromPosition,
        fromResult,
        fromEdge?.dir,
        fromIsAreaEdge
      );
    }

    // Special case: handle mixed legacy/graph pathfinding
    if (fromIsLegacyEdge && !toIsLegacyEdge) {
      // 'from' is on legacy NavMesh, 'to' is on regular graph
      // Connect the 'to' intermediate point to its actual edge points
      if (toResult.fromPointId && toResult.toPointId) {
        tempAdjacencyList
          .get(toResult.fromPointId)!
          .push(constants.TO_INTERMEDIATE);
        tempAdjacencyList
          .get(toResult.toPointId)!
          .push(constants.TO_INTERMEDIATE);
      }
    } else if (!fromIsLegacyEdge && toIsLegacyEdge) {
      // 'from' is on regular graph, 'to' is on legacy NavMesh
      // Connect the 'from' intermediate point to its actual edge points
      if (fromResult.fromPointId && fromResult.toPointId) {
        tempAdjacencyList
          .get(fromResult.fromPointId)!
          .push(constants.FROM_INTERMEDIATE);
        tempAdjacencyList
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
            this.addBidirectionalConnection(
              tempAdjacencyList,
              constants.FROM_INTERMEDIATE,
              constants.TO_INTERMEDIATE
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

    // Special case: handle same-area direct connections
    if (fromIsAreaEdge && toIsAreaEdge && fromEdgeAreas[0] === toEdgeAreas[0]) {
      // Both 'from' and 'to' are in the same area - check for direct connection
      const areaId = fromEdgeAreas[0];
      const navMeshQuery = this._areaNavMeshQueries.get(areaId);

      if (navMeshQuery) {
        const fromV3 = new THREE.Vector3().copy(fromResult.position);
        const toV3 = new THREE.Vector3().copy(toResult.position);

        this.computeNavMeshPathAndConnect(
          navMeshQuery,
          fromV3,
          toV3,
          constants.FROM_INTERMEDIATE,
          constants.TO_INTERMEDIATE,
          tempAdjacencyList,
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
                this.addEdgeWeightConnection(
                  pointId,
                  constants.TO_INTERMEDIATE,
                  {
                    weight: pathLength,
                    type: "legacy",
                    path: path.path,
                  }
                );
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
          tempAdjacencyList.set(constants.TO_INTERMEDIATE, connectedPoints);

          // Also add reverse connections from intermediate to points
          connectedPoints.forEach((pointId) => {
            tempAdjacencyList.get(pointId)!.push(constants.TO_INTERMEDIATE);
          });
        }
      }
    }
    // Handle area edges for 'to'
    else if (toIsAreaEdge) {
      const areaId = toEdgeAreas[0];

      // Check if both points are in the same area - if so, skip exit connections
      const bothInSameArea = fromIsAreaEdge && fromEdgeAreas[0] === areaId;

      if (!bothInSameArea) {
        const exitPoints = mapUtils.findExitPoints(
          this._map,
          areaId,
          this._legacyNavMeshQuery
        );
        const navMeshQuery = this._areaNavMeshQueries.get(areaId);

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
              tempAdjacencyList,
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
              tempAdjacencyList.get(constants.TO_INTERMEDIATE) || [];
            const allToNeighbors = [...existingToNeighbors, ...connectedExits];
            tempAdjacencyList.set(constants.TO_INTERMEDIATE, allToNeighbors);

            // Also add reverse connections from intermediate to exits
            connectedExits.forEach((exitId) => {
              tempAdjacencyList.get(exitId)!.push(constants.TO_INTERMEDIATE);
            });
          }
        }
      }
    } else if (!toIsLegacyEdge) {
      // Regular edge handling (only for non-legacy edges)
      const toPosition = new THREE.Vector3().copy(toResult.position);

      this.connectIntermediateToEdgePointsTo(
        tempAdjacencyList,
        toPosition,
        toResult,
        toEdge?.dir,
        toIsAreaEdge
      );
    }

    return { tempAdjacencyList, tempPaths };
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
        const edgeWeight = mapUtils.getEdgeWeight(
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

  getNearestPositionOnEdge(position: THREE.Vector3Like): {
    position: THREE.Vector3Like;
    edgeId: string;
    fromPointId: string;
    toPointId: string;
    distance: number;
  } | null {
    if (!this._map) return null;

    let nearestPosition: THREE.Vector3Like | null = null;
    let nearestEdgeId: string | null = null;
    let nearestFromPointId: string | null = null;
    let nearestToPointId: string | null = null;
    let minDistance = Infinity;

    // Check all edges
    Object.entries(this._map.edges).forEach(([edgeId, edge]) => {
      const fromPoint = this.getMapPointInternal(edge.from)!;
      const toPoint = this.getMapPointInternal(edge.to)!;

      if (!fromPoint || !toPoint) return;

      // Find closest point on this edge
      const closestPoint = geometry.getClosestPointOnLineSegment(
        position,
        fromPoint,
        toPoint
      );
      const distance = geometry.calculateDistance(position, closestPoint);

      if (distance < minDistance) {
        minDistance = distance;
        nearestPosition = closestPoint;
        nearestEdgeId = edgeId;
        nearestFromPointId = edge.from;
        nearestToPointId = edge.to;
      }
    });

    if (!nearestPosition || !nearestEdgeId) return null;

    return {
      position: nearestPosition,
      edgeId: nearestEdgeId,
      fromPointId: nearestFromPointId!,
      toPointId: nearestToPointId!,
      distance: minDistance,
    };
  }

  async initializeAreaNavMeshes(): Promise<void> {
    this._areaNavMeshes.clear();
    this._areaNavMeshQueries.clear();
    if (!this._map) return;

    for (const areaId of Object.keys(this._areaMeshes)) {
      const mesh = this._areaMeshes[areaId];

      if (mesh) {
        try {
          const nmResult = threeToSoloNavMesh([mesh], {
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
          if (!nmResult.success || !nmResult.navMesh) {
            console.error("Failed to create nav mesh for area:", areaId);
            continue;
          }
          this._areaNavMeshes.set(areaId, nmResult.navMesh);

          const query = new NavMeshQuery(nmResult.navMesh);
          this._areaNavMeshQueries.set(areaId, query);
        } catch (error) {
          console.error("Failed to create zone for area:", areaId, error);
        }
      }
    }
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

  private async initializeAreaDistances(): Promise<void> {
    if (!this._map) return;

    for (const areaId of Object.keys(this._map.areas)) {
      const navMesh = this._areaNavMeshQueries.get(areaId);
      if (!navMesh) continue;

      const exitPoints = mapUtils.findExitPoints(
        this._map,
        areaId,
        this._legacyNavMeshQuery
      );

      // Pre-compute distances between all pairs of exit points
      for (let i = 0; i < exitPoints.length; i++) {
        for (let j = i + 1; j < exitPoints.length; j++) {
          const fromPointId = exitPoints[i];
          const toPointId = exitPoints[j];

          const fromPoint = this.getMapPointInternal(fromPointId)!;
          const toPoint = this.getMapPointInternal(toPointId)!;

          if (fromPoint && toPoint) {
            const from = new THREE.Vector3().copy(fromPoint);
            const to = new THREE.Vector3().copy(toPoint);

            const path = navMesh.computePath(from, to);
            if (path.success && path.path) {
              const distance = geometry.calculatePathLength(path.path);

              // Store both directions
              this.addEdgeWeightConnection(fromPointId, toPointId, {
                weight: distance,
                type: "area",
                path: path.path,
              });
              this.addEdgeWeightConnection(toPointId, fromPointId, {
                weight: distance,
                type: "area",
                path: path.path.toReversed(),
              });
            }
          }
        }
      }
    }
  }
}
