import { init, NavMesh, NavMeshQuery } from "recast-navigation";
import { threeToSoloNavMesh } from "@recast-navigation/three";
import * as THREE from "three";
import { NavigationData } from "./NavigationData";
import * as geometry from "./GeometryUtils";
import * as mapUtils from "./GraphUtils";
import * as recastUtils from "./RecastUtils";
import * as pathfinding from "./PathfindingUtils";
import * as constants from "./Constants";

export type NavOptions = {
  maxDistance?: number;
  maxOffGraphDistance?: number; // Maximum distance to find nearest point
};

export class Pathfinder {
  private map: NavigationData;
  private config: NavOptions;
  private adjacencyList: Map<string, string[]> = new Map();
  private edgeWeights: Map<string, number> = new Map();
  private precomputedAreaPaths: Map<string, THREE.Vector3Like[]> = new Map();

  private areaNavMeshes: Map<string, NavMesh> = new Map(); // Cache navmeshes for areas
  private areaNavMeshQueries: Map<string, NavMeshQuery> = new Map(); // Cache navmeshes for areas

  private legacyNavMesh: NavMesh | null = null;
  private legacyNavMeshQuery: NavMeshQuery | null = null;

  // Store legacy portal points separately (don't mutate original map)
  private legacyPortalPoints: Map<string, THREE.Vector3Like> = new Map();

  constructor(config: NavOptions = {}) {
    this.config = {
      ...config,
    };
    this.map = new NavigationData(
      {
        points: {},
        edges: {},
        areas: {},
      },
      []
    );
  }

  get navmeshes() {
    return this.areaNavMeshes;
  }

  private isLoaded = false;
  get loaded() {
    return this.isLoaded;
  }

  get adjacencyListForVisualization() {
    return this.adjacencyList;
  }

  get preComputedAreaPaths() {
    return this.precomputedAreaPaths;
  }

  // Getter that combines original points with legacy portal points
  private getMapPointOrLegacyConnection(
    pointId: string
  ): THREE.Vector3Like | null {
    // First check original map points
    if (this.map?.points[pointId]) {
      return this.map.points[pointId];
    }

    // Then check legacy portal points
    return this.legacyPortalPoints.get(pointId) || null;
  }

  // Getter for all points (original + legacy portals)
  private getAllPoints(): Record<string, THREE.Vector3Like> {
    const allPoints = { ...this.map?.points };

    // Add legacy portal points
    this.legacyPortalPoints.forEach((point, pointId) => {
      allPoints[pointId] = point;
    });

    return allPoints;
  }

  async load(map: NavigationData) {
    this.isLoaded = false;
    this.cleanUp();

    this.map = map;

    this.buildAdjacencyList();
    await this.initializeAreaNavMeshes();
    await this.initializeAreaDistances();
    await this.initializeLegacyAreaNavMeshes();
    await this.initializeLegacyAreaConnections();
    this.isLoaded = true;
  }

  private cleanUp() {
    this.adjacencyList.clear();
    this.edgeWeights.clear();
    this.precomputedAreaPaths.clear();
    this.legacyPortalPoints.clear();
    this.legacyNavMesh = null;
    this.legacyNavMeshQuery = null;
    this.areaNavMeshes.clear();
    this.areaNavMeshQueries.clear();
  }

  setConfig(config: NavOptions) {
    this.config = { ...this.config, ...config };
  }

  private buildAdjacencyList() {
    if (!this.map) return;

    // Initialize adjacency list for original points only
    Object.keys(this.map.points).forEach((pointId) => {
      this.adjacencyList.set(pointId, []);
    });

    // Build connections and calculate weights
    Object.entries(this.map.edges).forEach(([edgeId, edge]) => {
      const fromPoint = this.getMapPointOrLegacyConnection(edge.from)!;
      const toPoint = this.getMapPointOrLegacyConnection(edge.to)!;

      if (fromPoint && toPoint) {
        // Check if this edge belongs to any area
        const edgeAreas = mapUtils.getAreasContainingEdge(this.map, edgeId);
        const isAreaEdge = edgeAreas.length > 0;

        // Skip edges that belong to areas - they'll be handled by exit-to-exit connections
        if (isAreaEdge) {
          return;
        }

        // Calculate edge weight (distance)
        const weight = geometry.calculateDistance(fromPoint, toPoint);

        if (!edge.dir) {
          // Two-way edge - add bidirectional connections
          this.adjacencyList.get(edge.from)!.push(edge.to);
          this.adjacencyList.get(edge.to)!.push(edge.from);

          this.edgeWeights.set(
            constants.createEdgeWeightKey(edge.from, edge.to),
            weight
          );
          this.edgeWeights.set(
            constants.createEdgeWeightKey(edge.to, edge.from),
            weight
          );
        } else if (edge.dir === 1) {
          // One-way edge - only add from -> to connection
          this.adjacencyList.get(edge.from)!.push(edge.to);
          this.edgeWeights.set(
            constants.createEdgeWeightKey(edge.from, edge.to),
            weight
          );
        } else if (edge.dir === -1) {
          // One-way-reverse edge - only add to -> from connection
          this.adjacencyList.get(edge.to)!.push(edge.from);
          this.edgeWeights.set(
            constants.createEdgeWeightKey(edge.to, edge.from),
            weight
          );
        }
      }
    });

    // Add area-based exit-to-exit connections
    Object.entries(this.map.areas).forEach(([areaId, area]) => {
      const exitPoints = mapUtils.findExitPoints(this.map, areaId);

      // Connect all exit points within the same area
      for (let i = 0; i < exitPoints.length; i++) {
        for (let j = 0; j < exitPoints.length; j++) {
          if (i !== j) {
            const fromId = exitPoints[i];
            const toId = exitPoints[j];

            // Add bidirectional connection
            this.adjacencyList.get(fromId)!.push(toId);
            this.adjacencyList.get(toId)!.push(fromId);

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
    if (!this.map) {
      return null;
    }

    // Find nearest positions on traditional edges
    const fromEdgeResult = this.getNearestPositionOnEdge(from);
    const toEdgeResult = this.getNearestPositionOnEdge(to);

    // Find nearest positions on legacy NavMesh
    const fromLegacyResult = recastUtils.getNearestPositionOnLegacyNavMesh(
      this.legacyNavMeshQuery,
      from
    );
    const toLegacyResult = recastUtils.getNearestPositionOnLegacyNavMesh(
      this.legacyNavMeshQuery,
      to
    );

    // Special case: if both points are on the same legacy NavMesh,
    // check if direct NavMesh path is shorter than portal-based path
    if (fromLegacyResult && toLegacyResult) {
      const directNavMeshPath = pathfinding.tryDirectLegacyNavMeshPath(
        this.legacyNavMeshQuery,
        this.legacyPortalPoints,
        from,
        to
      );
      if (directNavMeshPath) {
        console.log(
          "Using direct legacy NavMesh path (shorter than portal route)"
        );
        return directNavMeshPath;
      }
    }

    // Choose the closest option for each endpoint
    const fromResult = pathfinding.chooseClosestResult(
      this.legacyPortalPoints,
      fromEdgeResult,
      fromLegacyResult,
      from
    );
    const toResult = pathfinding.chooseClosestResult(
      this.legacyPortalPoints,
      toEdgeResult,
      toLegacyResult,
      to
    );

    if (!fromResult || !toResult) {
      return null;
    }

    // Check if points are within threshold
    if (
      fromResult.distance > (this.config.maxOffGraphDistance ?? Infinity) ||
      toResult.distance > (this.config.maxOffGraphDistance ?? Infinity)
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
          const precomputedPath = this.precomputedAreaPaths.get(
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
    this.adjacencyList.forEach((neighbors, nodeId) => {
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

    // Add connections from existing nodes to intermediate points
    const fromIsLegacyEdge =
      fromResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID;
    const toIsLegacyEdge =
      toResult.edgeId === constants.LEGACY_NAVMESH_SURFACE_EDGE_ID;

    const fromEdge = fromIsLegacyEdge
      ? null
      : this.map!.edges[fromResult.edgeId];
    const toEdge = toIsLegacyEdge ? null : this.map.edges[toResult.edgeId];

    const fromEdgeAreas = fromIsLegacyEdge
      ? []
      : mapUtils.getAreasContainingEdge(this.map, fromResult.edgeId);
    const toEdgeAreas = toIsLegacyEdge
      ? []
      : mapUtils.getAreasContainingEdge(this.map, toResult.edgeId);

    const fromIsAreaEdge = fromEdgeAreas.length > 0;
    const toIsAreaEdge = toEdgeAreas.length > 0;

    // Handle legacy NavMesh edges
    if (fromIsLegacyEdge) {
      console.log("Handling legacy NavMesh edge for 'from'");
      const legacyNavMeshQuery = this.legacyNavMeshQuery;
      if (legacyNavMeshQuery) {
        // Find all virtual portal points connected to legacy NavMesh
        const connectedPortals: string[] = [];

        // Connect to all legacy portal points
        this.adjacencyList.forEach((neighbors, nodeId) => {
          if (constants.isLegacyPortal(nodeId)) {
            // Check if this portal is reachable from the from position
            try {
              const fromV3 = new THREE.Vector3().copy(fromResult.position);
              const portalV3 = new THREE.Vector3().copy(
                this.getMapPointOrLegacyConnection(nodeId)!
              );

              const path = legacyNavMeshQuery.computePath(fromV3, portalV3);
              if (path.success && path.path) {
                console.log(`Successfully connected to portal ${nodeId}`);
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

        console.log(`Connected portals for 'from':`, connectedPortals);

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
      const exitPoints = mapUtils.findExitPoints(this.map, areaId);
      const navMeshQuery = this.areaNavMeshQueries.get(areaId);

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
      const legacyNavMeshQuery = this.legacyNavMeshQuery;
      if (legacyNavMeshQuery) {
        // Find all virtual portal points connected to legacy NavMesh
        const connectedPortals: string[] = [];

        // Connect to all legacy portal points
        this.adjacencyList.forEach((neighbors, nodeId) => {
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
      const exitPoints = mapUtils.findExitPoints(this.map, areaId);
      const navMeshQuery = this.areaNavMeshQueries.get(areaId);

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
          this.edgeWeights,
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
    if (!this.map) return null;

    let nearestPosition: THREE.Vector3Like | null = null;
    let nearestEdgeId: string | null = null;
    let nearestFromPointId: string | null = null;
    let nearestToPointId: string | null = null;
    let minDistance = Infinity;

    // Check all edges
    Object.entries(this.map.edges).forEach(([edgeId, edge]) => {
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
    this.areaNavMeshes.clear();
    this.areaNavMeshQueries.clear();
    if (!this.map) return;

    await init();

    for (const areaId of Object.keys(this.map.meshes)) {
      const mesh = this.map.meshes[areaId];

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
          this.areaNavMeshes.set(areaId, nmResult.navMesh);

          const query = new NavMeshQuery(nmResult.navMesh);
          this.areaNavMeshQueries.set(areaId, query);
        } catch (error) {
          console.error("Failed to create zone for area:", areaId, error);
        }
      }
    }
  }

  private async initializeLegacyAreaNavMeshes(): Promise<void> {
    if (!this.map) return;

    await init();

    const legacyMeshes = this.map.legacyNavmesh;
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

    this.legacyNavMesh = nmResult.navMesh;
    this.legacyNavMeshQuery = new NavMeshQuery(nmResult.navMesh);
  }

  private async initializeLegacyAreaConnections(): Promise<void> {
    console.log("Initializing legacy area connections...");
    if (!this.map) {
      console.log("No map available");
      return;
    }

    const lnmQuery = this.legacyNavMeshQuery;
    if (!lnmQuery) {
      console.log("No legacy NavMesh query available");
      return;
    }

    console.log(
      "Legacy NavMesh query found, checking for intersecting points..."
    );

    // Find all existing graph points that intersect with the legacy NavMesh
    const intersectingPoints: string[] = [];

    Object.entries(this.map.points).forEach(([pointId, point]) => {
      console.log(`Checking point ${pointId} at`, point);
      if (recastUtils.isPointOnLegacyNavMesh(point, lnmQuery)) {
        console.log(`Point ${pointId} intersects with legacy NavMesh`);
        intersectingPoints.push(pointId);
      }
    });

    console.log(
      `Found ${intersectingPoints.length} graph points intersecting with legacy NavMesh:`,
      intersectingPoints
    );

    // Create virtual connection points on the legacy NavMesh surface
    const virtualPoints: Map<string, THREE.Vector3Like> = new Map();

    for (const pointId of intersectingPoints) {
      const point = this.map.points[pointId];
      const virtualPointId = constants.createLegacyPortalId(pointId);

      // Project point onto legacy NavMesh surface
      const projectedPoint = recastUtils.projectPointOntoLegacyNavMesh(
        point,
        lnmQuery
      );
      this.legacyPortalPoints.set(virtualPointId, projectedPoint);

      // Add edge from original point to virtual point
      this.addLegacyConnection(pointId, virtualPointId, point, projectedPoint);
    }

    // Connect virtual points within the legacy NavMesh
    await this.connectVirtualPointsWithinLegacyNavMesh(
      this.legacyPortalPoints,
      lnmQuery
    );
  }

  private addLegacyConnection(
    fromPointId: string,
    toPointId: string,
    fromPoint: THREE.Vector3Like,
    toPoint: THREE.Vector3Like
  ): void {
    console.log(
      "Adding legacy connection:",
      fromPointId,
      toPointId,
      fromPoint,
      toPoint
    );
    // Add bidirectional connection
    this.adjacencyList.get(fromPointId)!.push(toPointId);

    // Initialize adjacency list for virtual point
    this.adjacencyList.set(toPointId, []);
    this.adjacencyList.get(toPointId)!.push(fromPointId);

    // Calculate and store edge weight
    const weight = geometry.calculateDistance(fromPoint, toPoint);
    this.edgeWeights.set(
      constants.createEdgeWeightKey(fromPointId, toPointId),
      weight
    );
    this.edgeWeights.set(
      constants.createEdgeWeightKey(toPointId, fromPointId),
      weight
    );
  }

  private async connectVirtualPointsWithinLegacyNavMesh(
    virtualPoints: Map<string, THREE.Vector3Like>,
    navMeshQuery: NavMeshQuery
  ): Promise<void> {
    const virtualPointIds = Array.from(virtualPoints.keys());

    // Connect all virtual points within the legacy NavMesh using NavMesh pathfinding
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
            // Add bidirectional connection
            this.adjacencyList.get(fromId)!.push(toId);
            this.adjacencyList.get(toId)!.push(fromId);

            // Store precomputed path and distance
            const distance = geometry.calculatePathLength(path.path);
            this.edgeWeights.set(
              constants.createEdgeWeightKey(fromId, toId),
              distance
            );
            this.edgeWeights.set(
              constants.createEdgeWeightKey(toId, fromId),
              distance
            );

            this.precomputedAreaPaths.set(
              constants.createEdgeWeightKey(fromId, toId),
              path.path
            );
            this.precomputedAreaPaths.set(
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

  private async initializeAreaDistances(): Promise<void> {
    if (!this.map) return;

    for (const [areaId, area] of Object.entries(this.map.areas)) {
      const navMesh = this.areaNavMeshQueries.get(areaId);
      if (!navMesh) continue;

      const exitPoints = mapUtils.findExitPoints(this.map, areaId);

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
              this.edgeWeights.set(
                constants.createEdgeWeightKey(fromPointId, toPointId),
                distance
              );
              this.edgeWeights.set(
                constants.createEdgeWeightKey(toPointId, fromPointId),
                distance
              );
              this.precomputedAreaPaths.set(
                constants.createEdgeWeightKey(fromPointId, toPointId),
                path.path
              );
              this.precomputedAreaPaths.set(
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
