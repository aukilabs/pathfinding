import {
  Area,
  buildPolygonFromEdges,
  isPointInPolygon,
  Edge,
  NavMap,
  Point,
} from "@auki/pathfinding";
import { v4 as uuidv4 } from "uuid";
import { EdgeWithId } from "./EdgeDrawing";
import { findSmallestPolygonContainingPoint } from "./AreaFill";

export type NavMapCRDT = {
  readonly state: NavMap;
  readonly initialState: NavMap;
  readonly operations: readonly Operation[];
  readonly redoStack: readonly Operation[];
  lastSequence: number;
  clientId: string;
  lastSyncTimestamp: number;
};

type Operation =
  | { type: "setPoint"; data: { id: string; point: Point } }
  | { type: "removePoint"; data: { id: string } }
  | { type: "setEdge"; data: { id: string; edge: Edge } }
  | { type: "removeEdge"; data: { id: string } }
  | { type: "setArea"; data: { id: string; area: Area } }
  | { type: "removeArea"; data: { id: string } }
  | { type: "mergeAreas"; data: { areaIds: string[]; mergedAreaId: string } }
  | {
      type: "deleteEdgeWithAreaMerging";
      data: { edgeId: string; orphanPoints: string[] };
    }
  | {
      type: "createEdgeWithIntersections";
      data: {
        edgeId: string;
        edge: Edge;
        newPoints: { id: string; point: Point }[];
        splitEdges: {
          originalEdgeId: string;
          newEdges: EdgeWithId[];
        }[];
      };
    };

export const generateOperationId = () => uuidv4();

export const createNavMapCRDT = (
  initialState: NavMap,
  clientId: string
): NavMapCRDT => ({
  state: initialState,
  initialState: initialState,
  operations: [],
  redoStack: [],
  lastSequence: 0,
  clientId,
  lastSyncTimestamp: Date.now(),
});

export const applyOperation = (
  crdt: NavMapCRDT,
  operation: Operation
): NavMapCRDT => {
  const newOperation = {
    ...operation,
    id: generateOperationId(),
    timestamp: Date.now(),
    sequence: crdt.lastSequence + 1,
  };

  return {
    ...crdt,
    state: applyOperationToState(crdt.state, newOperation),
    operations: [...crdt.operations, newOperation],
    lastSequence: newOperation.sequence,
  };
};

const applyOperationToState = (state: NavMap, operation: Operation): NavMap => {
  switch (operation.type) {
    case "setPoint":
      return {
        ...state,
        points: { ...state.points, [operation.data.id]: operation.data.point },
      };
    case "removePoint":
      const {
        [operation.data.id]: removedPoint,
        ...remainingPointsAfterPointRemoval
      } = state.points;
      return { ...state, points: remainingPointsAfterPointRemoval };
    case "setEdge":
      return {
        ...state,
        edges: { ...state.edges, [operation.data.id]: operation.data.edge },
      };
    case "removeEdge":
      const {
        [operation.data.id]: removedEdgeFromState,
        ...remainingEdgesAfterEdgeRemoval
      } = state.edges;
      return { ...state, edges: remainingEdgesAfterEdgeRemoval };
    case "setArea":
      // Update the area
      const newAreasWithArea = {
        ...state.areas,
        [operation.data.id]: operation.data.area,
      };

      // Build polygon from edges to check if edges are inside
      const polygon = buildPolygonFromEdges(operation.data.area.edges, {
        points: state.points,
        edges: state.edges,
        areas: newAreasWithArea,
      });

      // Find edges that are inside the new area
      const edgesToRemove: string[] = [];
      const pointsToRemove: string[] = [];

      // Check each edge in the global state to see if its midpoint is inside the area
      for (const [edgeId, edge] of Object.entries(state.edges)) {
        // Skip edges that are part of the area definition itself
        if (operation.data.area.edges.includes(edgeId)) {
          continue;
        }

        const fromPoint = state.points[edge.from];
        const toPoint = state.points[edge.to];
        if (!fromPoint || !toPoint) continue;

        // Calculate midpoint of the edge
        const midpoint = {
          x: (fromPoint.x + toPoint.x) / 2,
          y: (fromPoint.y + toPoint.y) / 2,
          z: (fromPoint.z + toPoint.z) / 2,
        };

        // Check if midpoint is inside the area
        if (polygon && isPointInPolygon(midpoint, polygon)) {
          edgesToRemove.push(edgeId);
        }
      }

      // Remove edges that are inside the area
      const { ...remainingEdges } = state.edges;
      for (const edgeId of edgesToRemove) {
        delete remainingEdges[edgeId];
      }

      // Find orphaned points (points with no remaining edges)
      for (const [pointId] of Object.entries(state.points)) {
        const hasEdges = Object.values(remainingEdges).some(
          (edge) => edge.from === pointId || edge.to === pointId
        );
        if (!hasEdges) {
          pointsToRemove.push(pointId);
        }
      }

      // Remove orphaned points
      const { ...remainingPoints } = state.points;
      for (const pointId of pointsToRemove) {
        delete remainingPoints[pointId];
      }

      return {
        ...state,
        points: remainingPoints,
        edges: remainingEdges,
        areas: newAreasWithArea,
      };
    case "removeArea":
      const { [operation.data.id]: removedArea, ...remainingAreas } =
        state.areas;
      return { ...state, areas: remainingAreas };
    case "mergeAreas":
      const areasToMerge = operation.data.areaIds
        .map((id) => state.areas[id])
        .filter(Boolean);
      if (areasToMerge.length < 2) return state;

      // Collect all unique edges from the areas to merge
      const allEdges = new Set<string>();
      for (const area of areasToMerge) {
        for (const edgeId of area.edges) {
          allEdges.add(edgeId);
        }
      }

      // Remove the original areas
      const areasAfterRemoval = { ...state.areas };
      for (const areaId of operation.data.areaIds) {
        delete areasAfterRemoval[areaId];
      }

      // Add the merged area
      return {
        ...state,
        areas: {
          ...areasAfterRemoval,
          [operation.data.mergedAreaId]: {
            edges: Array.from(allEdges),
          },
        },
      };
    case "deleteEdgeWithAreaMerging":
      const edgeToDelete = state.edges[operation.data.edgeId];
      if (!edgeToDelete) return state;

      // Find areas that contain this edge
      const areasContainingEdge: string[] = [];
      for (const [areaId, area] of Object.entries(state.areas)) {
        if (area.edges.includes(operation.data.edgeId)) {
          areasContainingEdge.push(areaId);
        }
      }

      // Remove the edge
      const {
        [operation.data.edgeId]: removedEdgeFromDelete,
        ...remainingEdgesAfterDelete
      } = state.edges;

      // Remove orphan points
      const { ...remainingPointsAfterDelete } = state.points;
      for (const pointId of operation.data.orphanPoints) {
        delete remainingPointsAfterDelete[pointId];
      }

      // Handle area merging
      let updatedAreas = { ...state.areas };

      if (areasContainingEdge.length === 0) {
        // Edge not part of any area, just remove it
        return {
          ...state,
          points: remainingPointsAfterDelete,
          edges: remainingEdgesAfterDelete,
        };
      } else if (areasContainingEdge.length === 1) {
        // Remove edge from single area
        const areaId = areasContainingEdge[0];
        const area = updatedAreas[areaId];
        updatedAreas[areaId] = {
          ...area,
          edges: area.edges.filter((id) => id !== operation.data.edgeId),
        };
      } else {
        // Merge multiple areas
        const mergedAreaId = `a${Date.now()}_merged`;

        // Collect all edges from areas that will be merged (excluding the deleted edge)
        const allEdges = new Set<string>();
        for (const areaId of areasContainingEdge) {
          const area = updatedAreas[areaId];
          for (const edgeId of area.edges) {
            if (edgeId !== operation.data.edgeId) {
              allEdges.add(edgeId);
            }
          }
          // Remove the original area
          delete updatedAreas[areaId];
        }

        // Use polygon detection to find the actual boundary of the merged area
        let detectedPolygonEdges: string[] | null = null;

        // Use the midpoint of the deleted edge to detect the polygon
        const fromPoint = state.points[edgeToDelete.from];
        const toPoint = state.points[edgeToDelete.to];
        if (fromPoint && toPoint) {
          const detectionPoint = {
            x: (fromPoint.x + toPoint.x) / 2,
            y: (fromPoint.y + toPoint.y) / 2,
            z: (fromPoint.z + toPoint.z) / 2,
          };

          const currentState = {
            points: remainingPointsAfterDelete,
            edges: remainingEdgesAfterDelete,
            areas: updatedAreas,
          };

          // Find the actual polygon boundary using our robust algorithm
          detectedPolygonEdges = findSmallestPolygonContainingPoint(
            currentState,
            detectionPoint
          );
        }

        // Define the merged area using detected polygon or fallback to collected edges
        if (detectedPolygonEdges && detectedPolygonEdges.length >= 3) {
          updatedAreas[mergedAreaId] = {
            edges: detectedPolygonEdges,
          };
        } else {
          // Fallback to the original approach if polygon detection fails
          updatedAreas[mergedAreaId] = {
            edges: Array.from(allEdges),
          };
        }

        // Clean up edges that are inside the merged area
        const edgesToRemove: string[] = [];
        const pointsToRemove: string[] = [];

        // Check each edge in the global state to see if its midpoint is inside the merged area
        for (const [edgeId, edge] of Object.entries(
          remainingEdgesAfterDelete
        )) {
          // Skip edges that are part of the merged area definition itself
          if (updatedAreas[mergedAreaId].edges.includes(edgeId)) {
            continue;
          }

          const fromPoint = remainingPointsAfterDelete[edge.from];
          const toPoint = remainingPointsAfterDelete[edge.to];
          if (!fromPoint || !toPoint) continue;

          // Calculate midpoint of the edge
          const midpoint = {
            x: (fromPoint.x + toPoint.x) / 2,
            y: (fromPoint.y + toPoint.y) / 2,
            z: (fromPoint.z + toPoint.z) / 2,
          };

          const polygon = buildPolygonFromEdges(
            updatedAreas[mergedAreaId].edges,
            {
              points: remainingPointsAfterDelete,
              edges: remainingEdgesAfterDelete,
              areas: updatedAreas,
            }
          );
          // Check if midpoint is inside the merged area
          if (polygon && isPointInPolygon(midpoint, polygon)) {
            edgesToRemove.push(edgeId);
          }
        }

        // Remove edges that are inside the merged area
        for (const edgeId of edgesToRemove) {
          delete remainingEdgesAfterDelete[edgeId];
        }

        // Find orphaned points (points with no remaining edges)
        for (const [pointId] of Object.entries(remainingPointsAfterDelete)) {
          const hasEdges = Object.values(remainingEdgesAfterDelete).some(
            (edge) => edge.from === pointId || edge.to === pointId
          );
          if (!hasEdges) {
            pointsToRemove.push(pointId);
          }
        }

        // Remove orphaned points
        for (const pointId of pointsToRemove) {
          delete remainingPointsAfterDelete[pointId];
        }
      }

      return {
        ...state,
        points: remainingPointsAfterDelete,
        edges: remainingEdgesAfterDelete,
        areas: updatedAreas,
      };
    case "createEdgeWithIntersections":
      const newEdges = { ...state.edges };
      const newPoints = { ...state.points };
      const newAreas = { ...state.areas };
      let newState = { edges: newEdges, points: newPoints, areas: newAreas };
      console.log("Processing createEdgeWithIntersections:", operation.data);

      // Add new points
      for (const pointData of operation.data.newPoints) {
        newPoints[pointData.id] = pointData.point;
      }

      // Handle split edges (including the main edge if it's split)

      console.log("Original edges before processing:", Object.keys(newEdges));

      // First, remove all edges that will be split
      for (const splitData of operation.data.splitEdges) {
        console.log(`Removing edge ${splitData.originalEdgeId}`);
        delete newEdges[splitData.originalEdgeId];
      }

      console.log("Edges after removal:", Object.keys(newEdges));

      const areasSplitByPoint = new Map<string, string[]>();
      // Then add all new split edges
      for (const splitData of operation.data.splitEdges) {
        console.log(
          `Adding ${splitData.newEdges.length} new edges for ${splitData.originalEdgeId}`
        );
        for (const newEdge of splitData.newEdges) {
          // Use the provided edge ID if available, otherwise generate one
          const splitEdgeId =
            newEdge.id ||
            `e${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
          // Remove the id field from the edge object before storing
          const { id, ...edgeData } = newEdge;
          newEdges[splitEdgeId] = edgeData;
          console.log(`Added edge ${splitEdgeId}:`, edgeData);
        }

        //iterate through areas and update them if they are intersected by the new edges
        for (const [areaId, area] of Object.entries(newAreas)) {
          if (area.edges.some((edgeId) => edgeId == splitData.originalEdgeId)) {
            const intersectionPointId = splitData.newEdges[0].to;
            areasSplitByPoint.set(areaId, [
              ...(areasSplitByPoint.get(areaId) ?? []),
              intersectionPointId,
            ]);
            newAreas[areaId] = {
              ...area,
              edges: [
                ...area.edges.filter(
                  (edgeId) => edgeId != splitData.originalEdgeId
                ),
                ...splitData.newEdges.map((edge) => edge.id),
              ],
            };
          }
        }
      }

      // Finally, add the main edge (only if it wasn't split)
      const mainEdgeWasSplit = operation.data.splitEdges.some(
        (split) => split.originalEdgeId === operation.data.edgeId
      );

      if (!mainEdgeWasSplit) {
        newEdges[operation.data.edgeId] = operation.data.edge;
      }

      // Remove all internal edges in the area
      for (const [areaId, splitPoints] of areasSplitByPoint.entries()) {
        const area = newAreas[areaId];
        if (!area) continue;
        // Find edges that connect the split points (these are the cutting edges)
        const cuttingEdges = Object.entries(newEdges).filter(
          ([edgeId, edge]) =>
            !area.edges.includes(edgeId) &&
            (splitPoints.includes(edge.from) || splitPoints.includes(edge.to))
        );

        const points = new Set(
          cuttingEdges.reduce(
            (acc, [_, edge]) => [...acc, edge.from, edge.to],
            [] as string[]
          )
        );

        const polygon = buildPolygonFromEdges(area.edges, newState);

        // Also remove the cutting edges from the global edges
        const edgesToRemove = new Set<string>();
        for (const [cuttingEdgeId, _] of cuttingEdges) {
          //check if midpoint of edge is in the area polygon
          const cuttingEdge = newEdges[cuttingEdgeId];
          if (cuttingEdge && polygon) {
            const from = newPoints[cuttingEdge.from];
            const to = newPoints[cuttingEdge.to];
            const midpoint = {
              x: (from.x + to.x) / 2,
              y: (from.y + to.y) / 2,
              z: (from.z + to.z) / 2,
            };

            if (isPointInPolygon(midpoint, polygon)) {
              edgesToRemove.add(cuttingEdgeId);
            }
          }
        }
        for (const edgeId of edgesToRemove) {
          delete newEdges[edgeId];
        }

        for (const pointId of points) {
          //check if point is orphaned (no edges point to it)
          if (
            Object.values(newEdges).every(
              (edge) => edge.from !== pointId && edge.to !== pointId
            )
          ) {
            delete newPoints[pointId];
          }
        }
      }

      return newState;
    default:
      // This should never happen with proper typing, but satisfies TypeScript
      return state;
  }
};

export const undo = (crdt: NavMapCRDT): NavMapCRDT => {
  if (crdt.operations.length === 0) return crdt;

  const lastOp = crdt.operations[crdt.operations.length - 1];
  const newOperations = crdt.operations.slice(0, -1);
  const newRedoStack = [...crdt.redoStack, lastOp];

  // If no operations left, return to initial state
  const newState =
    newOperations.length === 0
      ? crdt.initialState // Return to initial state
      : reconstructStateFromOperations(crdt.initialState, newOperations);

  return {
    ...crdt,
    state: newState,
    operations: newOperations,
    redoStack: newRedoStack,
    lastSequence: crdt.lastSequence - 1,
  };
};

export const redo = (crdt: NavMapCRDT): NavMapCRDT => {
  if (crdt.redoStack.length === 0) return crdt;

  const nextOp = crdt.redoStack[crdt.redoStack.length - 1];
  const newOperations = [...crdt.operations, nextOp];
  const newRedoStack = crdt.redoStack.slice(0, -1);
  const newState = reconstructStateFromOperations(
    crdt.initialState,
    newOperations
  );

  return {
    ...crdt,
    state: newState,
    operations: newOperations,
    redoStack: newRedoStack,
    lastSequence: crdt.lastSequence + 1,
  };
};

const reconstructStateFromOperations = (
  initialState: NavMap,
  operations: readonly Operation[]
): NavMap => {
  // Start with empty state
  let state = initialState;

  // Apply each operation in sequence
  for (const operation of operations) {
    state = applyOperationToState(state, operation);
  }

  return state;
};
