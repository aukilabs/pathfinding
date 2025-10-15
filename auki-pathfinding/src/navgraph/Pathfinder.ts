import { init, NavMesh, NavMeshQuery } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import * as THREE from "three";
import { Area, NavMap as NavigationGraph } from "./NavgraphTypes";
import * as geometry from "./GeometryUtils";
import * as mapUtils from "./GraphUtils";
import * as recastUtils from "./RecastUtils";
import * as pathfinding from "./PathfindingUtils";
import * as constants from "./Constants";
import earcut from "earcut";

export type NavOptions = {
  maxDistance?: number;
  maxOffGraphDistance?: number; // Maximum distance to find nearest point
};

export class Pathfinder {
  private _map: NavigationGraph;
  private _config: NavOptions;
  private _adjacencyList: Map<string, string[]> = new Map();
  private _edgeWeights: Map<string, number> = new Map();
  private _precomputedAreaPaths: Map<string, THREE.Vector3Like[]> = new Map();

  private _areaMeshes: Record<string, THREE.Mesh> = {};
  private _areaNavMeshes: Map<string, NavMesh> = new Map(); // Cache navmeshes for areas
  private _areaNavMeshQueries: Map<string, NavMeshQuery> = new Map(); // Cache navmeshes for areas

  private _legacyMeshes: THREE.Mesh[] = [];
  private _legacyNavMesh: NavMesh | null = null;
  private _legacyNavMeshQuery: NavMeshQuery | null = null;

  // Store legacy portal points separately (don't mutate original map)
  private _legacyPortalPoints: Map<string, THREE.Vector3Like> = new Map();

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

  private isLoaded = false;
  get loaded() {
    return this.isLoaded;
  }

  get adjacencyListForVisualization() {
    return this._adjacencyList;
  }

  get preComputedAreaPaths() {
    return this._precomputedAreaPaths;
  }

  get legacyPortalPoints() {
    return this._legacyPortalPoints;
  }

  // Getter that combines original points with legacy portal points
  private getMapPointOrLegacyConnection(
    pointId: string
  ): THREE.Vector3Like | null {
    // First check original map points
    if (this._map?.points[pointId]) {
      return this._map.points[pointId];
    }

    // Then check legacy portal points
    return this._legacyPortalPoints.get(pointId) || null;
  }

  // Getter for all points (original + legacy portals)
  private getAllPoints(): Record<string, THREE.Vector3Like> {
    const allPoints = { ...this._map?.points };

    // Add legacy portal points
    this._legacyPortalPoints.forEach((point, pointId) => {
      allPoints[pointId] = point;
    });

    return allPoints;
  }

  async load(map: NavigationGraph, legacyNavmesh: THREE.Mesh[]) {
    this.isLoaded = false;
    this.cleanUp();

    this._map = map;
    this._legacyMeshes = legacyNavmesh;
    await init();
    this.initializeMapAreas();
    this.buildAdjacencyList();
    await this.initializeAreaNavMeshes();
    await this.initializeAreaDistances();
    await this.initializeLegacyAreaNavMeshes();
    await this.initializeLegacyAreaConnections();
    this.isLoaded = true;
  }

  private initializeMapAreas() {
    for (const [areaId, area] of Object.entries(this._map.areas)) {
      const polygon = mapUtils.buildPolygonFromArea(area, this._map.points);
      if (!polygon) {
        console.error("failed to build polygon for area");
        continue;
      }

      const expandedPolygon = geometry.expandPolygon(polygon, 0.01);
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
    this._adjacencyList.clear();
    this._edgeWeights.clear();
    this._precomputedAreaPaths.clear();
    this._legacyPortalPoints.clear();
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
      const fromPoint = this.getMapPointOrLegacyConnection(edge.from)!;
      const toPoint = this.getMapPointOrLegacyConnection(edge.to)!;

      if (fromPoint && toPoint) {
        // Check if this edge belongs to any area
        const edgeAreas = mapUtils.getAreasContainingEdge(this._map, edgeId);
        const isAreaEdge = edgeAreas.length > 0;

        // Skip edges that belong to areas - they'll be handled by exit-to-exit connections
        if (isAreaEdge) {
          return;
        }

        // Calculate edge weight (distance)
        const weight = geometry.calculateDistance(fromPoint, toPoint);

        if (!edge.dir) {
          // Two-way edge - add bidirectional connections
          this._adjacencyList.get(edge.from)!.push(edge.to);
          this._adjacencyList.get(edge.to)!.push(edge.from);

          this._edgeWeights.set(
            constants.createEdgeWeightKey(edge.from, edge.to),
            weight
          );
          this._edgeWeights.set(
            constants.createEdgeWeightKey(edge.to, edge.from),
            weight
          );
        } else if (edge.dir === 1) {
          // One-way edge - only add from -> to connection
          this._adjacencyList.get(edge.from)!.push(edge.to);
          this._edgeWeights.set(
            constants.createEdgeWeightKey(edge.from, edge.to),
            weight
          );
        } else if (edge.dir === -1) {
          // One-way-reverse edge - only add to -> from connection
          this._adjacencyList.get(edge.to)!.push(edge.from);
          this._edgeWeights.set(
            constants.createEdgeWeightKey(edge.to, edge.from),
            weight
          );
        }
      }
    });

    // Add area-based exit-to-exit connections
    Object.entries(this._map.areas).forEach(([areaId, area]) => {
      const exitPoints = mapUtils.findExitPoints(this._map, areaId);

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

    // Special case: if both points are on the same legacy NavMesh,
    // check if direct NavMesh path is shorter than the full graph-optimized path
    if (fromLegacyResult && toLegacyResult) {
      // First, compute the full graph-optimized path
      const fromResult = pathfinding.chooseClosestResult(
        this._legacyPortalPoints,
        fromEdgeResult,
        fromLegacyResult,
        from
      );
      const toResult = pathfinding.chooseClosestResult(
        this._legacyPortalPoints,
        toEdgeResult,
        toLegacyResult,
        to
      );

      if (fromResult && toResult) {
        // Create temporary graph and find the graph-optimized path
        const { tempAdjacencyList, tempPaths } = this.createTemporaryGraph(
          fromResult,
          toResult
        );

        const graphPath = this.dijkstraWithTempGraph(
          tempAdjacencyList,
          constants.FROM_INTERMEDIATE,
          constants.TO_INTERMEDIATE
        );

        if (graphPath) {
          // Convert to world coordinates to get actual path length
          const fullGraphPath = this.convertGraphPathToWorldPath(
            graphPath,
            fromResult,
            toResult,
            from,
            to,
            tempPaths
          );
          const graphPathLength = geometry.calculatePathLength(fullGraphPath);

          // Now compare with direct NavMesh path
          const directNavMeshPath = pathfinding.tryDirectLegacyNavMeshPath(
            this._legacyNavMeshQuery,
            this._legacyPortalPoints,
            from,
            to
          );

          if (directNavMeshPath) {
            const directPathLength =
              geometry.calculatePathLength(directNavMeshPath);

            // Use direct path only if it's significantly shorter
            if (directPathLength < graphPathLength * 0.9) {
              // 10% shorter threshold
              console.log(
                `Using direct legacy NavMesh path (${directPathLength.toFixed(
                  2
                )} vs ${graphPathLength.toFixed(2)})`
              );
              return directNavMeshPath;
            } else {
              console.log(
                `Using graph-optimized path (${graphPathLength.toFixed(
                  2
                )} vs ${directPathLength.toFixed(2)})`
              );
              return fullGraphPath;
            }
          }
        }
      }
    }

    // If we get here, use the normal pathfinding logic
    const fromResult = pathfinding.chooseClosestResult(
      this._legacyPortalPoints,
      fromEdgeResult,
      fromLegacyResult,
      from
    );
    const toResult = pathfinding.chooseClosestResult(
      this._legacyPortalPoints,
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
      console.log(
        "Available nodes in temp graph:",
        Array.from(tempAdjacencyList.keys())
      );
      return null;
    }

    console.log("Graph path found:", graphPath, fromResult, toResult, from, to);

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

      if (currentNode === constants.FROM_INTERMEDIATE) {
        // Check for direct connection to TO_INTERMEDIATE
        if (nextNode === constants.TO_INTERMEDIATE) {
          const directPath = tempPaths.get(
            `${constants.FROM_INTERMEDIATE}-${constants.TO_INTERMEDIATE}`
          );
          if (directPath) {
            fullPath.push(...directPath);
            i++; // Skip TO_INTERMEDIATE
            continue;
          }
        }

        // Check if we have a precomputed path from intermediate to next node
        if (nextNode && nextNode !== constants.TO_INTERMEDIATE) {
          const precomputedPath = tempPaths.get(
            constants.createFromIntermediatePathKey(nextNode)
          ); // Use tempPaths
          if (precomputedPath) {
            fullPath.push(...precomputedPath);
            i++; // Skip next node
            continue;
          }
        }
        fullPath.push(fromResult.position);
      } else if (currentNode === constants.TO_INTERMEDIATE) {
        // Check if we have a precomputed path from previous node to intermediate
        if (i > 0) {
          const prevNode = graphPath[i - 1];
          const precomputedPath = tempPaths.get(
            constants.createToIntermediatePathKey(prevNode)
          ); // Use tempPaths
          if (precomputedPath) {
            fullPath.push(...precomputedPath);
            continue;
          }
        }
        fullPath.push(toResult.position);
      } else {
        // Check if there's a precomputed path between current and next node
        if (
          nextNode &&
          nextNode !== constants.FROM_INTERMEDIATE &&
          nextNode !== constants.TO_INTERMEDIATE
        ) {
          const precomputedPath = this._precomputedAreaPaths.get(
            `${currentNode}-${nextNode}`
          ); // Use tempPaths

          if (precomputedPath) {
            fullPath.push(...precomputedPath); // Skip first point to avoid duplication
            i++; // Skip next node since we've already processed it
            continue;
          }
        }

        // No precomputed path, just add the point
        fullPath.push(this.getMapPointOrLegacyConnection(currentNode)!);
      }
    }

    fullPath.push(to);
    return fullPath;
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

    // Add intermediate points as temporary nodes
    // For legacy NavMesh, we'll handle connections differently
    if (fromResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID) {
      tempAdjacencyList.set(constants.FROM_INTERMEDIATE, []);
    } else {
      tempAdjacencyList.set(constants.FROM_INTERMEDIATE, [
        fromResult.fromPointId,
        fromResult.toPointId,
      ]);
    }

    if (toResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID) {
      tempAdjacencyList.set(constants.TO_INTERMEDIATE, []);
    } else {
      tempAdjacencyList.set(constants.TO_INTERMEDIATE, [
        toResult.fromPointId,
        toResult.toPointId,
      ]);
    }

    // ADD THIS: Direct connection between intermediate nodes if both are on legacy NavMesh
    const fromIsLegacyEdge =
      fromResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID;
    const toIsLegacyEdge =
      toResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID;

    if (fromIsLegacyEdge && toIsLegacyEdge) {
      // Add direct connection between intermediate nodes
      tempAdjacencyList
        .get(constants.FROM_INTERMEDIATE)!
        .push(constants.TO_INTERMEDIATE);

      // Compute the direct NavMesh path and store it
      const directNavMeshPath = pathfinding.tryDirectLegacyNavMeshPath(
        this._legacyNavMeshQuery,
        this._legacyPortalPoints,
        fromResult.position,
        toResult.position
      );

      if (directNavMeshPath) {
        // Store the path for later use
        tempPaths.set(
          `${constants.FROM_INTERMEDIATE}-${constants.TO_INTERMEDIATE}`,
          directNavMeshPath
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
        // Find all virtual portal points connected to legacy NavMesh
        const connectedPortals: string[] = [];

        // Connect to all legacy portal points
        this._adjacencyList.forEach((neighbors, nodeId) => {
          if (constants.isLegacyPortal(nodeId)) {
            // Check if this portal is reachable from the from position
            try {
              const fromV3 = new THREE.Vector3().copy(fromResult.position);
              const portalV3 = new THREE.Vector3().copy(
                this.getMapPointOrLegacyConnection(nodeId)!
              );

              const path = legacyNavMeshQuery.computePath(fromV3, portalV3);
              if (path.success && path.path) {
                tempPaths.set(
                  constants.createFromIntermediatePathKey(nodeId),
                  path.path
                );
                connectedPortals.push(nodeId);
              } else {
                console.log(`Failed to connect to portal ${nodeId}:`, path);
              }
            } catch (error) {
              console.error(
                `Failed to compute path to portal ${nodeId}:`,
                error
              );
            }
          }
        });

        // Only connect to legacy portal points, not all graph points
        // This prevents direct jumps from legacy NavMesh to arbitrary graph points

        if (connectedPortals.length > 0) {
          tempAdjacencyList.set(constants.FROM_INTERMEDIATE, connectedPortals);
        } else {
          console.log(
            "No portals connected for 'from' - this will cause pathfinding to fail"
          );
        }
      } else {
        console.log("No legacy NavMesh query available");
      }
    }
    // Handle area edges by computing NavMesh paths to nearest exit points
    else if (fromIsAreaEdge) {
      const areaId = fromEdgeAreas[0];
      const exitPoints = mapUtils.findExitPoints(this._map, areaId);
      const navMeshQuery = this._areaNavMeshQueries.get(areaId);

      if (exitPoints.length > 0 && navMeshQuery) {
        const connectedExits: string[] = [];

        // Compute NavMesh path to ALL exit points
        for (const exitId of exitPoints) {
          try {
            const fromV3 = new THREE.Vector3().copy(fromResult.position);
            const toV3 = new THREE.Vector3().copy(
              this.getMapPointOrLegacyConnection(exitId)!
            );

            const path = navMeshQuery.computePath(fromV3, toV3);
            if (path.success && path.path) {
              // Store the computed path for later reconstruction
              tempPaths.set(
                constants.createFromIntermediatePathKey(exitId),
                path.path
              );

              // Add this exit to connected exits
              connectedExits.push(exitId);
            }
          } catch (error) {
            console.error(
              `Failed to compute NavMesh path to exit ${exitId}:`,
              error
            );
          }
        }

        // Connect intermediate point to ALL successful exits
        if (connectedExits.length > 0) {
          tempAdjacencyList.set(constants.FROM_INTERMEDIATE, connectedExits);
        }
      }
    } else if (!fromIsLegacyEdge) {
      // Regular edge handling (only for non-legacy edges)
      if (!fromEdge!.dir || fromIsAreaEdge) {
        tempAdjacencyList
          .get(fromResult.fromPointId)!
          .push(constants.FROM_INTERMEDIATE);
        tempAdjacencyList
          .get(fromResult.toPointId)!
          .push(constants.FROM_INTERMEDIATE);
      } else if (fromEdge!.dir === 1) {
        tempAdjacencyList
          .get(fromResult.fromPointId)!
          .push(constants.FROM_INTERMEDIATE);
      } else if (fromEdge!.dir === -1) {
        tempAdjacencyList
          .get(fromResult.toPointId)!
          .push(constants.FROM_INTERMEDIATE);
      }
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
    }

    // Handle legacy NavMesh edges for 'to'
    if (toIsLegacyEdge) {
      const legacyNavMeshQuery = this._legacyNavMeshQuery;
      if (legacyNavMeshQuery) {
        // Find all virtual portal points connected to legacy NavMesh
        const connectedPortals: string[] = [];

        // Connect to all legacy portal points
        this._adjacencyList.forEach((neighbors, nodeId) => {
          if (constants.isLegacyPortal(nodeId)) {
            // Check if this portal is reachable from the to position
            try {
              const portalV3 = new THREE.Vector3().copy(
                this.getMapPointOrLegacyConnection(nodeId)!
              );
              const toV3 = new THREE.Vector3().copy(toResult.position);

              const path = legacyNavMeshQuery.computePath(portalV3, toV3);
              if (path.success && path.path) {
                tempPaths.set(
                  constants.createToIntermediatePathKey(nodeId),
                  path.path
                );
                connectedPortals.push(nodeId);
              }
            } catch (error) {
              console.error(
                `Failed to compute path from portal ${nodeId}:`,
                error
              );
            }
          }
        });

        // Only connect to legacy portal points, not all graph points
        // This prevents direct jumps from legacy NavMesh to arbitrary graph points

        if (connectedPortals.length > 0) {
          tempAdjacencyList.set(constants.TO_INTERMEDIATE, connectedPortals);

          // Also add reverse connections from intermediate to portals
          connectedPortals.forEach((portalId) => {
            tempAdjacencyList.get(portalId)!.push(constants.TO_INTERMEDIATE);
          });
        }
      }
    }
    // Handle area edges for 'to'
    else if (toIsAreaEdge) {
      const areaId = toEdgeAreas[0];
      const exitPoints = mapUtils.findExitPoints(this._map, areaId);
      const navMeshQuery = this._areaNavMeshQueries.get(areaId);

      if (exitPoints.length > 0 && navMeshQuery) {
        const connectedExits: string[] = [];

        // Compute NavMesh path from ALL exit points
        for (const exitId of exitPoints) {
          try {
            const fromV3 = new THREE.Vector3().copy(
              this.getMapPointOrLegacyConnection(exitId)!
            );
            const toV3 = new THREE.Vector3().copy(toResult.position);

            const path = navMeshQuery.computePath(fromV3, toV3);
            if (path.success && path.path) {
              // Store the computed path for later reconstruction
              tempPaths.set(
                constants.createToIntermediatePathKey(exitId),
                path.path
              );

              // Add this exit to connected exits
              connectedExits.push(exitId);
            }
          } catch (error) {
            console.error(
              `Failed to compute NavMesh path from exit ${exitId}:`,
              error
            );
          }
        }

        // Connect ALL successful exits to intermediate point
        if (connectedExits.length > 0) {
          tempAdjacencyList.set(constants.TO_INTERMEDIATE, connectedExits);

          // Also add reverse connections from intermediate to exits
          connectedExits.forEach((exitId) => {
            tempAdjacencyList.get(exitId)!.push(constants.TO_INTERMEDIATE);
          });
        }
      }
    } else if (!toIsLegacyEdge) {
      // Regular edge handling (only for non-legacy edges)
      if (!toEdge!.dir || toIsAreaEdge) {
        tempAdjacencyList
          .get(toResult.fromPointId)!
          .push(constants.TO_INTERMEDIATE);
        tempAdjacencyList
          .get(toResult.toPointId)!
          .push(constants.TO_INTERMEDIATE);
      } else if (toEdge!.dir === 1) {
        tempAdjacencyList
          .get(toResult.fromPointId)!
          .push(constants.TO_INTERMEDIATE);
      } else if (toEdge!.dir === -1) {
        tempAdjacencyList
          .get(toResult.toPointId)!
          .push(constants.TO_INTERMEDIATE);
      }
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
      const fromPoint = this.getMapPointOrLegacyConnection(edge.from)!;
      const toPoint = this.getMapPointOrLegacyConnection(edge.to)!;

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

    console.log(`Creating legacy NavMesh from ${legacyMeshes.length} meshes`);

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

    console.log("Successfully created legacy NavMesh");

    this._legacyNavMesh = nmResult.navMesh;
    this._legacyNavMeshQuery = new NavMeshQuery(nmResult.navMesh);
  }

  private async initializeLegacyAreaConnections(): Promise<void> {
    console.log("Initializing legacy area connections...");
    if (!this._map) {
      console.log("No map available");
      return;
    }

    const lnmQuery = this._legacyNavMeshQuery;
    if (!lnmQuery) {
      console.log("No legacy NavMesh query available");
      return;
    }

    // Find all existing graph points that intersect with the legacy NavMesh
    const intersectingPoints: string[] = [];

    Object.entries(this._map.points).forEach(([pointId, point]) => {
      if (recastUtils.isPointOnLegacyNavMesh(point, lnmQuery)) {
        intersectingPoints.push(pointId);
      }
    });

    console.log(
      `Found ${intersectingPoints.length} graph points intersecting with legacy NavMesh:`,
      intersectingPoints
    );

    // Create virtual portal points and connect them to original points
    for (const pointId of intersectingPoints) {
      const point = this._map.points[pointId];
      const virtualPointId = constants.createLegacyPortalId(pointId);

      // Project point onto legacy NavMesh surface
      const projectedPoint = recastUtils.projectPointOntoLegacyNavMesh(
        point,
        lnmQuery
      );
      this._legacyPortalPoints.set(virtualPointId, projectedPoint);

      // Add edge from original point to virtual point
      this.addLegacyConnection(pointId, virtualPointId, point, projectedPoint);
    }

    // PRECOMPUTE ALL PORTAL-TO-PORTAL CONNECTIONS
    // This is the key change - treat legacy NavMesh like an area
    await this.precomputeLegacyPortalConnections(
      this._legacyPortalPoints,
      lnmQuery
    );
  }

  private async precomputeLegacyPortalConnections(
    virtualPoints: Map<string, THREE.Vector3Like>,
    navMeshQuery: NavMeshQuery
  ): Promise<void> {
    const virtualPointIds = Array.from(virtualPoints.keys());

    // Precompute distances between ALL pairs of portal points
    // This is exactly like initializeAreaDistances but for legacy portals
    for (let i = 0; i < virtualPointIds.length; i++) {
      for (let j = i + 1; j < virtualPointIds.length; j++) {
        const fromId = virtualPointIds[i];
        const toId = virtualPointIds[j];

        const fromPoint = virtualPoints.get(fromId)!;
        const toPoint = virtualPoints.get(toId)!;

        // Use NavMesh to find path between virtual points
        const fromV3 = new THREE.Vector3().copy(fromPoint);
        const toV3 = new THREE.Vector3().copy(toPoint);

        try {
          const path = navMeshQuery.computePath(fromV3, toV3);

          if (path.success && path.path) {
            // Ensure both points are initialized in adjacency list
            if (!this._adjacencyList.has(fromId)) {
              this._adjacencyList.set(fromId, []);
            }
            if (!this._adjacencyList.has(toId)) {
              this._adjacencyList.set(toId, []);
            }

            // Add bidirectional connection
            this._adjacencyList.get(fromId)!.push(toId);
            this._adjacencyList.get(toId)!.push(fromId);

            // Store precomputed path and distance
            const distance = geometry.calculatePathLength(path.path);
            this._edgeWeights.set(
              constants.createEdgeWeightKey(fromId, toId),
              distance
            );
            this._edgeWeights.set(
              constants.createEdgeWeightKey(toId, fromId),
              distance
            );

            // Store the actual path for reconstruction
            this._precomputedAreaPaths.set(
              constants.createEdgeWeightKey(fromId, toId),
              path.path
            );
            this._precomputedAreaPaths.set(
              constants.createEdgeWeightKey(toId, fromId),
              path.path.toReversed()
            );
          }
        } catch (error) {
          console.error(
            `Failed to compute path between ${fromId} and ${toId}:`,
            error
          );
        }
      }
    }
  }

  private addLegacyConnection(
    fromPointId: string,
    toPointId: string,
    fromPoint: THREE.Vector3Like,
    toPoint: THREE.Vector3Like
  ): void {
    // Add bidirectional connection
    this._adjacencyList.get(fromPointId)!.push(toPointId);

    // Initialize adjacency list for virtual point
    this._adjacencyList.set(toPointId, []);
    this._adjacencyList.get(toPointId)!.push(fromPointId);

    // Calculate and store edge weight
    const weight = geometry.calculateDistance(fromPoint, toPoint);
    this._edgeWeights.set(
      constants.createEdgeWeightKey(fromPointId, toPointId),
      weight
    );
    this._edgeWeights.set(
      constants.createEdgeWeightKey(toPointId, fromPointId),
      weight
    );
  }

  private async initializeAreaDistances(): Promise<void> {
    if (!this._map) return;

    for (const areaId of Object.keys(this._map.areas)) {
      const navMesh = this._areaNavMeshQueries.get(areaId);
      if (!navMesh) continue;

      const exitPoints = mapUtils.findExitPoints(this._map, areaId);

      // Pre-compute distances between all pairs of exit points
      for (let i = 0; i < exitPoints.length; i++) {
        for (let j = i + 1; j < exitPoints.length; j++) {
          const fromPointId = exitPoints[i];
          const toPointId = exitPoints[j];

          const fromPoint = this.getMapPointOrLegacyConnection(fromPointId)!;
          const toPoint = this.getMapPointOrLegacyConnection(toPointId)!;

          if (fromPoint && toPoint) {
            const from = new THREE.Vector3().copy(fromPoint);
            const to = new THREE.Vector3().copy(toPoint);

            const path = navMesh.computePath(from, to);
            if (path.success && path.path) {
              const distance = geometry.calculatePathLength(path.path);

              // Store both directions
              this._edgeWeights.set(
                constants.createEdgeWeightKey(fromPointId, toPointId),
                distance
              );
              this._edgeWeights.set(
                constants.createEdgeWeightKey(toPointId, fromPointId),
                distance
              );
              this._precomputedAreaPaths.set(
                constants.createEdgeWeightKey(fromPointId, toPointId),
                path.path
              );
              this._precomputedAreaPaths.set(
                constants.createEdgeWeightKey(toPointId, fromPointId),
                path.path.toReversed()
              );
            }
          }
        }
      }
    }
  }
}
