import { init, NavMeshQuery } from "@recast-navigation/core";
import {
  EdgeWeightInfo,
  PathResult,
  InterFloorLink,
  PathPoint,
  V3,
} from "./NavgraphTypes";
import * as geometry from "./GeometryUtils";
import * as graphUtils from "./GraphUtils";
import * as recastUtils from "./RecastUtils";
import * as pathfinding from "./PathfindingUtils";
import * as constants from "./Constants";
import { FloorData } from "./FloorData";
const { createEdgeWeightKey } = constants;
const { addAdjacency, computeNavMeshPathAndConnect } = graphUtils;

export type NavOptions = {
  maxDistance?: number;
  maxOffGraphDistance?: number; // Maximum distance to find nearest point
};

export class Pathfinder {
  private _maps: Map<string, FloorData>;
  private _config: NavOptions;
  private _links: InterFloorLink[];

  private _isLoaded = false;
  get loaded() {
    return this._isLoaded;
  }

  constructor(config: NavOptions = {}) {
    this._config = {
      ...config,
    };
    this._maps = new Map();
    this._links = [];
  }

  initializeRecast() {
    //initialize recast
    return init();
  }

  loadMultifloor(data: {
    data: Record<string, FloorData>;
    links: InterFloorLink[];
  }) {
    this._isLoaded = false;
    this.cleanUp();

    for (const [floorId, floorData] of Object.entries(data.data)) {
      this._maps.set(floorId, floorData);
    }

    this._links = [...data.links];

    this._isLoaded = true;
  }

  load(data: FloorData) {
    return this.loadMultifloor({
      data: {
        ["default-floor"]: data,
      },
      links: [],
    });
  }

  private cleanUp() {
    this._maps.clear();
  }

  setConfig(config: NavOptions) {
    this._config = { ...this._config, ...config };
  }

  findPath(
    from: V3,
    to: V3,
    fromFloorId: string = "default-floor",
    toFloorId: string = "default-floor"
  ): PathPoint[] | null {
    const fromFloor = this._maps.get(fromFloorId);
    const toFloor = this._maps.get(toFloorId);
    if (!fromFloor || !toFloor) {
      return null;
    }
    const fromResult = fromFloor.getPathResult(from);
    const toResult = toFloor.getPathResult(to);
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
    const tempGraphResults = this.createTempGraphs(
      fromResult,
      toResult,
      fromFloor,
      toFloor,
      fromFloorId,
      toFloorId
    );

    // Merge temp graphs with static graphs for optimal performance
    const mergedGraphs = this.mergeTempWithStatic(
      fromFloorId,
      toFloorId,
      tempGraphResults
    );

    let graphPath = this.dijkstraWithMergedGraph(
      mergedGraphs.mergedAdjacencies,
      mergedGraphs.mergedEdgeWeights,
      pathfinding.getFloorItemKey(fromFloorId, constants.FROM_INTERMEDIATE),
      pathfinding.getFloorItemKey(toFloorId, constants.TO_INTERMEDIATE)
    );

    if (!graphPath) {
      console.log("No path found between intermediate points");
      return null;
    }

    // Convert to world coordinates
    return this.convertToFinalPath(
      graphPath,
      from,
      to,
      mergedGraphs.mergedEdgeWeights,
      fromFloorId,
      toFloorId
    );
  }

  private convertToFinalPath(
    graphPath: string[],
    from: V3,
    to: V3,
    tempEdgeWeights: Map<string, EdgeWeightInfo[]>,
    fromFloorId: string,
    toFloorId: string
  ): PathPoint[] {
    const fullPath: PathPoint[] = [
      {
        point: from,
        fromPointId: "from",
        toPointId: "from_intermediate",
        floorId: fromFloorId,
      },
    ];

    for (let i = 0; i < graphPath.length - 1; i++) {
      const currentNode = graphPath[i];
      const nextNode = graphPath[i + 1];
      const { floorId: currentFloorId, itemId: currentNodeId } =
        pathfinding.getFloorAndItemFromKey(currentNode);
      const { floorId: nextFloorId, itemId: nextNodeId } =
        pathfinding.getFloorAndItemFromKey(nextNode);

      let currentFloor = this._maps.get(fromFloorId);

      if (nextNodeId) {
        // Create path key using the same pattern for all nodes
        const pathKey = createEdgeWeightKey(currentNodeId, nextNodeId);
        const floorPathKey = createEdgeWeightKey(currentNode, nextNode);
        const staticConnections = currentFloor!.edgeWeights.get(pathKey);
        const tempConnections = tempEdgeWeights.get(floorPathKey);

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
          fullPath.push(
            ...chosenConnection.path
              .map((point, j) => {
                if (
                  j == chosenConnection.path.length - 1 &&
                  i < graphPath.length - 2
                )
                  return null;
                const p: PathPoint = {
                  point,
                  fromPointId: currentNodeId,
                  toPointId: nextNodeId,
                  floorId: currentFloorId,
                };

                if (nextFloorId !== currentFloorId) {
                  p.toFloorId = nextFloorId;
                  p.floorLink = this._links.find(
                    (link) =>
                      link.fromFloorId === currentFloorId &&
                      link.toFloorId === nextFloorId &&
                      ((link.fromPointId === currentNodeId &&
                        link.toPointId === nextNodeId) ||
                        (link.fromPointId === nextNodeId &&
                          link.toPointId === currentNodeId))
                  );
                }

                return p;
              })
              .filter((p) => p !== null)
          );
          continue;
        }
      }
    }

    fullPath.push({
      point: to,
      fromPointId: "to_intermediate",
      toPointId: "to",
      floorId: toFloorId,
    });
    return fullPath;
  }

  private addIntermediateNodeToTempGraph(
    tempAdjacencies: Map<string, string[]>,
    tempEdgeWeights: Map<string, EdgeWeightInfo[]>,
    floor: FloorData,
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
        floor,
        nodeId,
        node.position,
        areaGroupId
      );
    } else {
      // Regular edge handling
      const edgeId = node.edgeId;
      const fromEdge = floor.getGraphEdge(edgeId);
      if (!fromEdge) return;
      const dir = fromEdge.dir;
      const doTo = dir === undefined || dir === 0 || dir === 1;
      const doFrom = dir === undefined || dir === 0 || dir === -1;

      let weight = geometry.calculateDistance(
        node.position,
        floor.getGraphPoint(node.toPointId)!
      );
      if (doTo) {
        // Bidirectional or undefined - add both directions
        let weight = geometry.calculateDistance(
          node.position,
          floor.getGraphPoint(node.toPointId)!
        );
        addAdjacency(
          tempAdjacencies,
          tempEdgeWeights,
          nodeId,
          node.toPointId,
          true,
          {
            weight,
            path: [node.position, floor.getGraphPoint(node.toPointId)!],
          }
        );
      }
      if (doFrom) {
        let weight = geometry.calculateDistance(
          node.position,
          floor.getGraphPoint(node.fromPointId)!
        );
        addAdjacency(
          tempAdjacencies,
          tempEdgeWeights,
          nodeId,
          node.fromPointId,
          true,
          {
            weight,
            path: [node.position, floor.getGraphPoint(node.fromPointId)!],
          }
        );
      }
    }

    const fromEdgeAreaGroups = floor.getGroupsWithEdge(
      node.type === "edge" ? node.edgeId : ""
    );
    const fromIsAreaEdge = fromEdgeAreaGroups.length > 0;

    if (isLegacyEdge) {
      const legacyNavMeshQuery = floor.getLegacyNavMeshQuery();
      if (legacyNavMeshQuery) {
        // Find all graph points that intersect with the legacy NavMesh
        Object.entries(floor.getPoints()).forEach(([pointId, point]) => {
          if (recastUtils.isPointOnLegacyNavMesh(point, legacyNavMeshQuery)) {
            // Connect to all graph points that intersect with legacy NavMesh
            computeNavMeshPathAndConnect(
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
        floor,
        nodeId,
        node.position,
        areaGroupId
      );
    }
  }

  /**
   * Merge temporary graphs with static graphs for optimal Dijkstra performance
   */
  private mergeTempWithStatic(
    fromFloorId: string,
    toFloorId: string,
    tempGraphResults: {
      fromAdjacencies: Map<string, string[]>;
      fromEdgeWeights: Map<string, EdgeWeightInfo[]>;
      toAdjacencies: Map<string, string[]>;
      toEdgeWeights: Map<string, EdgeWeightInfo[]>;
    }
  ): {
    mergedAdjacencies: Map<string, string[]>;
    mergedEdgeWeights: Map<string, EdgeWeightInfo[]>;
  } {
    // Start with copies of the static graphs
    const mergedAdjacencies = new Map<string, string[]>();
    const mergedEdgeWeights = new Map<string, EdgeWeightInfo[]>();

    for (const [floorId, floorData] of this._maps) {
      floorData.adjacencies.forEach((neighbors, nodeId) => {
        const floorNodeId = pathfinding.getFloorItemKey(floorId, nodeId);
        const mergedNeighbors = neighbors.map((neighbor) =>
          pathfinding.getFloorItemKey(floorId, neighbor)
        );
        const existing = mergedAdjacencies.get(floorNodeId) || [];
        mergedAdjacencies.set(floorNodeId, [...existing, ...mergedNeighbors]);
      });

      floorData.edgeWeights.forEach((weights, key) => {
        const keySplit = key.split("-");
        const floorKey = createEdgeWeightKey(
          pathfinding.getFloorItemKey(floorId, keySplit[0]),
          pathfinding.getFloorItemKey(floorId, keySplit[1])
        );
        const existing = mergedEdgeWeights.get(floorKey) || [];
        mergedEdgeWeights.set(floorKey, [...existing, ...weights]);
      });
    }

    // Merge temp adjacencies
    tempGraphResults.fromAdjacencies.forEach((neighbors, nodeId) => {
      const floorNodeId = pathfinding.getFloorItemKey(fromFloorId, nodeId);
      const mergedNeighbors = neighbors.map((neighbor) =>
        pathfinding.getFloorItemKey(fromFloorId, neighbor)
      );
      const existing = mergedAdjacencies.get(floorNodeId) || [];
      mergedAdjacencies.set(floorNodeId, [...existing, ...mergedNeighbors]);
    });

    tempGraphResults.toAdjacencies.forEach((neighbors, nodeId) => {
      const floorNodeId = pathfinding.getFloorItemKey(toFloorId, nodeId);
      const mergedNeighbors = neighbors.map((neighbor) =>
        pathfinding.getFloorItemKey(toFloorId, neighbor)
      );
      const existing = mergedAdjacencies.get(floorNodeId) || [];
      mergedAdjacencies.set(floorNodeId, [...existing, ...mergedNeighbors]);
    });

    tempGraphResults.fromEdgeWeights.forEach((weights, key) => {
      const keySplit = key.split("-");
      const floorKey = createEdgeWeightKey(
        pathfinding.getFloorItemKey(fromFloorId, keySplit[0]),
        pathfinding.getFloorItemKey(fromFloorId, keySplit[1])
      );
      const existing = mergedEdgeWeights.get(floorKey) || [];
      mergedEdgeWeights.set(floorKey, [...existing, ...weights]);
    });

    tempGraphResults.toEdgeWeights.forEach((weights, key) => {
      const keySplit = key.split("-");
      const floorKey = createEdgeWeightKey(
        pathfinding.getFloorItemKey(toFloorId, keySplit[0]),
        pathfinding.getFloorItemKey(toFloorId, keySplit[1])
      );
      const existing = mergedEdgeWeights.get(floorKey) || [];
      mergedEdgeWeights.set(floorKey, [...existing, ...weights]);
    });

    //handle floor links
    this._links.forEach((link) => {
      const { fromFloorId, toFloorId, fromPointId, toPointId } = link;
      const fromKey = pathfinding.getFloorItemKey(fromFloorId, fromPointId);
      const toKey = pathfinding.getFloorItemKey(toFloorId, toPointId);

      //add adjacencies
      const existingAdjacencyFromTo = mergedAdjacencies.get(fromKey) || [];
      mergedAdjacencies.set(fromKey, [...existingAdjacencyFromTo, toKey]);
      const existingAdjacencyToFrom = mergedAdjacencies.get(toKey) || [];
      mergedAdjacencies.set(toKey, [...existingAdjacencyToFrom, fromKey]);

      //add edge weights
      const edgeWeightKeyFromTo = createEdgeWeightKey(fromKey, toKey);
      const edgeWeightKeyToFrom = createEdgeWeightKey(toKey, fromKey);
      const fromFloor = this._maps.get(fromFloorId);
      const toFloor = this._maps.get(toFloorId);
      const edgeWeightFT = {
        weight: link.weight,
        path: [
          fromFloor!.getGraphPoint(fromPointId)!,
          fromFloor!.getGraphPoint(toPointId)!,
        ],
      };
      const edgeWeightTF = {
        weight: link.weight,
        path: [
          toFloor!.getGraphPoint(toPointId)!,
          toFloor!.getGraphPoint(fromPointId)!,
        ],
      };

      mergedEdgeWeights.set(edgeWeightKeyFromTo, [
        edgeWeightFT,
        {
          weight: link.weight,
          path: [
            fromFloor?.getGraphPoint(fromPointId)!,
            fromFloor?.getGraphPoint(toPointId)!,
          ],
        },
      ]);

      mergedEdgeWeights.set(edgeWeightKeyToFrom, [
        edgeWeightTF,
        {
          weight: link.weight,
          path: [
            toFloor?.getGraphPoint(toPointId)!,
            toFloor?.getGraphPoint(fromPointId)!,
          ],
        },
      ]);
    });

    return { mergedAdjacencies, mergedEdgeWeights };
  }

  private createTempGraphs(
    fromResult: PathResult,
    toResult: PathResult,
    fromFloor: FloorData,
    toFloor: FloorData,
    fromFloorId: string,
    toFloorId: string
  ): {
    fromAdjacencies: Map<string, string[]>;
    fromEdgeWeights: Map<string, EdgeWeightInfo[]>;
    toAdjacencies: Map<string, string[]>;
    toEdgeWeights: Map<string, EdgeWeightInfo[]>;
  } {
    // Create a copy of the adjacency list
    const fromAdjacencies = new Map<string, string[]>();
    const fromEdgeWeights = new Map<string, EdgeWeightInfo[]>();
    const toAdjacencies = new Map<string, string[]>();
    const toEdgeWeights = new Map<string, EdgeWeightInfo[]>();

    this.addIntermediateNodeToTempGraph(
      fromAdjacencies,
      fromEdgeWeights,
      fromFloor,
      constants.FROM_INTERMEDIATE,
      fromResult
    );

    this.addIntermediateNodeToTempGraph(
      toAdjacencies,
      toEdgeWeights,
      toFloor,
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

    const fromEdgeAreaGroups = fromFloor.getGroupsWithEdge(fromEdgeId);
    const toEdgeAreaGroups = toFloor.getGroupsWithEdge(toEdgeId);

    // Add connections from existing nodes to intermediate points
    const fromIsAreaEdge = fromEdgeAreaGroups.length > 0;
    const toIsAreaEdge = toEdgeAreaGroups.length > 0;

    // Determine the appropriate NavMesh query for direct connections
    let directNavMeshQuery: NavMeshQuery | null = null;

    // Special case: if both points are in the same areaGroup, add direct connection
    if (
      fromIsAreaGroupEdge &&
      toIsAreaGroupEdge &&
      fromResult.type === "areaGroup" &&
      toResult.type === "areaGroup" &&
      fromFloorId === toFloorId &&
      fromResult.areaGroupId === toResult.areaGroupId
    ) {
      const areaGroupId = fromResult.areaGroupId;
      directNavMeshQuery = fromFloor.getAreaGroupNMQuery(areaGroupId) || null;
    }
    // Mixed case: from off-mesh, to in areaGroup, but same areaGroup
    else if (
      fromResult.type === "edge" &&
      toResult.type === "areaGroup" &&
      fromFloorId === toFloorId &&
      fromEdgeAreaGroups.includes(toResult.areaGroupId)
    ) {
      const areaGroupId = toResult.areaGroupId;
      directNavMeshQuery = toFloor.getAreaGroupNMQuery(areaGroupId) || null;
    }
    // Mixed case: to off-mesh, from in areaGroup, but same areaGroup
    else if (
      toResult.type === "edge" &&
      fromResult.type === "areaGroup" &&
      fromFloorId === toFloorId &&
      toEdgeAreaGroups.includes(fromResult.areaGroupId)
    ) {
      const areaGroupId = fromResult.areaGroupId;
      directNavMeshQuery = fromFloor.getAreaGroupNMQuery(areaGroupId) || null;
    }
    // Both 'from' and 'to' are on legacy NavMesh
    else if (fromIsLegacyEdge && toIsLegacyEdge && fromFloorId === toFloorId) {
      directNavMeshQuery = fromFloor.getLegacyNavMeshQuery() || null;
    }
    // Both 'from' and 'to' are in the same areaGroup (regular edge case)
    else if (
      fromIsAreaEdge &&
      toIsAreaEdge &&
      fromFloorId === toFloorId &&
      fromEdgeAreaGroups[0] === toEdgeAreaGroups[0]
    ) {
      const areaGroupId = fromEdgeAreaGroups[0];
      directNavMeshQuery = fromFloor.getAreaGroupNMQuery(areaGroupId) || null;
    }

    // Execute direct connection if we found a suitable NavMesh query
    if (directNavMeshQuery) {
      computeNavMeshPathAndConnect(
        directNavMeshQuery,
        fromResult.position,
        toResult.position,
        constants.FROM_INTERMEDIATE,
        constants.TO_INTERMEDIATE,
        fromAdjacencies,
        fromEdgeWeights
      );
    }

    return {
      fromAdjacencies,
      fromEdgeWeights,
      toAdjacencies,
      toEdgeWeights,
    };
  }

  private addPointToAllExitPoints(
    tempAdjacencies: Map<string, string[]>,
    tempEdgeWeights: Map<string, EdgeWeightInfo[]>,
    floor: FloorData,
    tempPointId: string,
    position: V3,
    areaGroupId: string
  ): void {
    if (areaGroupId) {
      const navMeshQuery = floor.getAreaGroupNMQuery(areaGroupId);
      // Get true exit points for this areaGroup
      const exitPoints = graphUtils.findExitPointsForGroup(
        floor.graph,
        areaGroupId,
        floor.getAreaGroupAreas(areaGroupId) || [],
        floor.getLegacyNavMeshQuery()
      );

      if (navMeshQuery) {
        exitPoints.forEach((pointId) => {
          const exitPosition = floor.getGraphPoint(pointId);
          if (exitPosition) {
            try {
              computeNavMeshPathAndConnect(
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

  /**
   * Optimized Dijkstra using pre-merged graphs for better performance
   */
  private dijkstraWithMergedGraph(
    mergedAdjacencies: Map<string, string[]>,
    mergedEdgeWeights: Map<string, EdgeWeightInfo[]>,
    from: string,
    to: string
  ): string[] | null {
    const distances = new Map<string, number>();
    const previous = new Map<string, string | null>();
    const visited = new Set<string>();
    const queue = new Map<string, number>();

    // Initialize distances
    distances.set(from, 0);
    queue.set(from, 0);

    while (queue.size > 0) {
      // Find the node with the minimum distance
      let current = "";
      let minDistance = Infinity;
      for (const [nodeId, distance] of queue) {
        if (distance < minDistance) {
          minDistance = distance;
          current = nodeId;
        }
      }

      if (current === to) {
        return pathfinding.reconstructPath(previous, from, to);
      }

      queue.delete(current);
      visited.add(current);

      // Single neighbor lookup (no merging needed)
      const neighbors = mergedAdjacencies.get(current) || [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor)) continue;

        // Single weight lookup (no Math.min needed)
        const edgeWeight = graphUtils.getEdgeWeight(
          mergedEdgeWeights,
          current,
          neighbor
        );

        if (edgeWeight === Infinity) continue;

        const newDistance = distances.get(current)! + edgeWeight;
        const currentDistance = distances.get(neighbor) ?? Infinity;

        if (newDistance < currentDistance) {
          distances.set(neighbor, newDistance);
          previous.set(neighbor, current);
          queue.set(neighbor, newDistance);
        }
      }
    }

    return null;
  }
}
