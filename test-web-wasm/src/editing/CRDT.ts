import { Area, Edge, NavMap, Point } from "auki-pathfinding";
import { v4 as uuidv4 } from "uuid";

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
  | {
      type: "createEdgeWithIntersections";
      data: {
        edgeId: string;
        edge: Edge;
        newPoints: { id: string; point: Point }[];
        splitEdges: { originalEdgeId: string; newEdges: Edge[] }[];
        splitAreas: { originalAreaId: string; newAreas: Area[] }[];
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
      const { [operation.data.id]: removed, ...remainingPoints } = state.points;
      return { ...state, points: remainingPoints };
    case "setEdge":
      return {
        ...state,
        edges: { ...state.edges, [operation.data.id]: operation.data.edge },
      };
    case "removeEdge":
      const { [operation.data.id]: removedEdge, ...remainingEdges } =
        state.edges;
      return { ...state, edges: remainingEdges };
    case "setArea":
      return {
        ...state,
        areas: { ...state.areas, [operation.data.id]: operation.data.area },
      };
    case "removeArea":
      const { [operation.data.id]: removedArea, ...remainingAreas } =
        state.areas;
      return { ...state, areas: remainingAreas };
    case "createEdgeWithIntersections":
      let newState = { ...state };
      console.log("Processing createEdgeWithIntersections:", operation.data);

      // Add new points
      const newPoints = { ...newState.points };
      for (const pointData of operation.data.newPoints) {
        newPoints[pointData.id] = pointData.point;
      }

      // Handle split edges (including the main edge if it's split)
      const newEdges = { ...newState.edges };
      console.log("Original edges before processing:", Object.keys(newEdges));

      // First, remove all edges that will be split
      for (const splitData of operation.data.splitEdges) {
        console.log(`Removing edge ${splitData.originalEdgeId}`);
        delete newEdges[splitData.originalEdgeId];
      }

      console.log("Edges after removal:", Object.keys(newEdges));

      // Then add all new split edges
      for (const splitData of operation.data.splitEdges) {
        console.log(
          `Adding ${splitData.newEdges.length} new edges for ${splitData.originalEdgeId}`
        );
        for (const newEdge of splitData.newEdges) {
          const splitEdgeId = `e${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          newEdges[splitEdgeId] = newEdge;
          console.log(`Added edge ${splitEdgeId}:`, newEdge);
        }
      }

      // Finally, add the main edge (only if it wasn't split)
      const mainEdgeWasSplit = operation.data.splitEdges.some(
        (split) => split.originalEdgeId === operation.data.edgeId
      );
      console.log(
        `Main edge ${operation.data.edgeId} was split:`,
        mainEdgeWasSplit
      );
      if (!mainEdgeWasSplit) {
        newEdges[operation.data.edgeId] = operation.data.edge;
        console.log(
          `Added main edge ${operation.data.edgeId}:`,
          operation.data.edge
        );
      }

      console.log("Final edges:", Object.keys(newEdges));

      // Handle split areas
      const newAreas = { ...newState.areas };
      for (const splitData of operation.data.splitAreas) {
        // Remove original area
        const {
          [splitData.originalAreaId]: removedSplitArea,
          ...remainingSplitAreas
        } = newAreas;
        Object.assign(newAreas, remainingSplitAreas);

        // Add new areas
        for (const newArea of splitData.newAreas) {
          const newAreaId = `a${Date.now()}_${Math.random()
            .toString(36)
            .substr(2, 9)}`;
          newAreas[newAreaId] = newArea;
        }
      }

      return {
        ...newState,
        points: newPoints,
        edges: newEdges,
        areas: newAreas,
      };
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
