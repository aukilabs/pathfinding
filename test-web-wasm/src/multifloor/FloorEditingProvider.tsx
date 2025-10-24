import React, { createContext, useContext, ReactNode, useMemo } from "react";
import { create } from "zustand";
import { applyOperation, NavMapCRDT, redo, undo } from "../editing/CRDT";
import * as THREE from "three";
import {
  findSmallestUnfilledAreaContainingPoint,
  findExistingAreaContainingPoint,
} from "../editing/AreaFill";
import {
  createEdgeWithIntersections,
  getDrawingPreview,
  DrawingPreview,
  findNearbyPoint,
  findNearbyEdge,
} from "../editing/EdgeDrawing";

type EditingTool =
  | "select"
  | "addPoint"
  | "drawEdge"
  | "fillArea"
  | "deleteEdge";

type EdgeDrawingState = {
  isDrawing: boolean;
  firstPoint: string | null;
  firstPointPosition: THREE.Vector3 | null;
  isCreatingNewPoints: boolean;
};

type DragState = {
  isDragging: boolean;
  draggedPoint: string | null;
  startPosition: THREE.Vector3 | null;
};

type FloorEditingState = {
  currentTool: EditingTool;
  setCurrentTool: (tool: EditingTool) => void;
  crdt: NavMapCRDT;
  setCRDT: (crdt: NavMapCRDT) => void;
  selectedPoint: string | null;
  selectPoint: (pointId: string | null) => void;
  selectedAreas: string[];
  setSelectedAreas: (areaIds: string[]) => void;
  edgeDrawingState: EdgeDrawingState;
  setEdgeDrawingState: (state: EdgeDrawingState) => void;
  mousePosition: THREE.Vector3 | null;
  setMousePosition: (position: THREE.Vector3 | null) => void;
  dragState: DragState;
  setDragState: (state: DragState) => void;
  addPoint: (position: THREE.Vector3) => void;
  updatePoint: (pointId: string, position: THREE.Vector3) => void;
  addEdge: (from: string, to: string) => void;
  undo: () => void;
  redo: () => void;
  toggleAreaFillAroundClick: (clickPoint: THREE.Vector3) => void;
  startEdgeDrawing: (position: THREE.Vector3) => void;
  completeEdgeDrawing: (position: THREE.Vector3) => void;
  cancelEdgeDrawing: () => void;
  getEdgeDrawingPreview: (
    currentPosition: THREE.Vector3
  ) => DrawingPreview | null;
  getFirstClickPreview: (
    currentPosition: THREE.Vector3
  ) => DrawingPreview | null;
  deleteEdge: (edgeId: string) => void;
};

const createFloorEditingStore = (
  initialCRDT: NavMapCRDT,
  setCRDTCallback: (crdt: NavMapCRDT) => void
) =>
  create<FloorEditingState>()((set, get) => ({
    currentTool: "select",
    setCurrentTool: (tool: EditingTool) =>
      set({
        currentTool: tool,
        edgeDrawingState: {
          isDrawing: false,
          firstPoint: null,
          firstPointPosition: null,
          isCreatingNewPoints: false,
        },
      }),
    crdt: initialCRDT,
    setCRDT: (crdt: NavMapCRDT) => {
      set({ crdt });
      setCRDTCallback(crdt);
    },
    selectedPoint: null,
    selectPoint: (pointId: string | null) => {
      set({ selectedPoint: pointId });
    },
    selectedAreas: [],
    setSelectedAreas: (areaIds: string[]) => {
      set({ selectedAreas: areaIds });
    },
    edgeDrawingState: {
      isDrawing: false,
      firstPoint: null,
      firstPointPosition: null,
      isCreatingNewPoints: false,
    },
    setEdgeDrawingState: (state: EdgeDrawingState) =>
      set({ edgeDrawingState: state }),
    mousePosition: null,
    setMousePosition: (position: THREE.Vector3 | null) =>
      set({ mousePosition: position }),
    dragState: { isDragging: false, draggedPoint: null, startPosition: null },
    setDragState: (state: DragState) => set({ dragState: state }),
    addPoint: (position: THREE.Vector3) => {
      const pointId = `p${Date.now()}`;
      const operation = {
        type: "setPoint" as const,
        data: { id: pointId, point: { x: position.x, y: 0, z: position.z } },
      };
      const newCRDT = applyOperation(get().crdt, operation);
      get().setCRDT(newCRDT);
    },

    updatePoint: (pointId: string, position: THREE.Vector3) => {
      const operation = {
        type: "setPoint" as const,
        data: { id: pointId, point: { x: position.x, y: 0, z: position.z } },
      };
      const newCRDT = applyOperation(get().crdt, operation);
      get().setCRDT(newCRDT);
    },

    addEdge: (from: string, to: string) => {
      const edgeId = `e${Date.now()}`;
      const operation = {
        type: "setEdge" as const,
        data: { id: edgeId, edge: { from, to } },
      };
      const newCRDT = applyOperation(get().crdt, operation);
      get().setCRDT(newCRDT);
    },

    undo: () => {
      const newCRDT = undo(get().crdt);
      get().setCRDT(newCRDT);
    },

    redo: () => {
      const newCRDT = redo(get().crdt);
      get().setCRDT(newCRDT);
    },

    toggleAreaFillAroundClick: (clickPoint: THREE.Vector3) => {
      const state = get().crdt.state;

      // First check if we're clicking on an existing area
      const existingArea = findExistingAreaContainingPoint(state, clickPoint);
      if (existingArea) {
        // Delete the existing area
        const operation = {
          type: "removeArea" as const,
          data: { id: existingArea.id },
        };
        console.log("Removing existing area:", operation);
        const newCRDT = applyOperation(get().crdt, operation);
        set({ crdt: newCRDT });
        return;
      }

      // Otherwise, try to create a new area
      const smallestUnfilledArea = findSmallestUnfilledAreaContainingPoint(
        state,
        clickPoint
      );
      if (smallestUnfilledArea) {
        const operation = {
          type: "setArea" as const,
          data: {
            id: `a${Date.now()}`,
            area: { edges: smallestUnfilledArea.edges },
          },
        };
        console.log("Creating new area:", operation);
        const newCRDT = applyOperation(get().crdt, operation);
        set({ crdt: newCRDT });
      }
    },

    startEdgeDrawing: (position: THREE.Vector3) => {
      // Get the preview to determine the actual start position (snapped or not)
      const preview = get().getFirstClickPreview(position);

      // If we're snapping to a point, use the exact point coordinates to avoid precision issues
      let actualStartPosition = position;
      if (preview?.snapType === "point" && preview.snapTarget) {
        const state = get().crdt.state;
        const point = state.points[preview.snapTarget];
        actualStartPosition = new THREE.Vector3(point.x, point.y ?? 0, point.z);
      } else if (preview?.snapPosition) {
        actualStartPosition = preview.snapPosition;
      }

      get().setEdgeDrawingState({
        isDrawing: true,
        firstPoint: null,
        firstPointPosition: actualStartPosition.clone(),
        isCreatingNewPoints: true,
      });
    },

    completeEdgeDrawing: (position: THREE.Vector3) => {
      const { edgeDrawingState } = get();
      if (!edgeDrawingState.isDrawing || !edgeDrawingState.firstPointPosition)
        return;

      const state = get().crdt.state;

      // Get the preview to determine the actual end position (snapped or not)
      const preview = getDrawingPreview(
        state,
        edgeDrawingState.firstPointPosition,
        position
      );

      // If we're snapping to a point, use the exact point coordinates to avoid precision issues
      let actualEndPosition = position;
      if (preview?.snapType === "point" && preview.snapTarget) {
        const point = state.points[preview.snapTarget];
        actualEndPosition = new THREE.Vector3(point.x, point.y ?? 0, point.z);
      } else if (preview?.snapPosition) {
        actualEndPosition = preview.snapPosition;
      }

      const result = createEdgeWithIntersections(
        state,
        edgeDrawingState.firstPointPosition,
        actualEndPosition
      );

      const operation = {
        type: "createEdgeWithIntersections" as const,
        data: result,
      };

      const newCRDT = applyOperation(get().crdt, operation);
      set({ crdt: newCRDT });

      // Reset edge drawing state
      get().cancelEdgeDrawing();
    },

    cancelEdgeDrawing: () => {
      get().setEdgeDrawingState({
        isDrawing: false,
        firstPoint: null,
        firstPointPosition: null,
        isCreatingNewPoints: false,
      });
    },

    getEdgeDrawingPreview: (currentPosition: THREE.Vector3) => {
      const { edgeDrawingState } = get();
      if (!edgeDrawingState.isDrawing || !edgeDrawingState.firstPointPosition)
        return null;

      const state = get().crdt.state;
      return getDrawingPreview(
        state,
        edgeDrawingState.firstPointPosition,
        currentPosition
      );
    },

    getFirstClickPreview: (currentPosition: THREE.Vector3) => {
      const { currentTool } = get();
      if (currentTool !== "drawEdge") return null;

      const state = get().crdt.state;

      // Check point snap first
      const nearbyPointId = findNearbyPoint(state, currentPosition);
      if (nearbyPointId) {
        const point = state.points[nearbyPointId];
        return {
          snapTarget: nearbyPointId,
          snapType: "point" as const,
          snapPosition: new THREE.Vector3(point.x, point.y ?? 0, point.z),
          intersections: [],
          areaSplits: [],
          previewPoints: [
            currentPosition,
            new THREE.Vector3(point.x, point.y ?? 0, point.z),
          ],
        };
      }

      // Check edge snap second
      const nearbyEdge = findNearbyEdge(state, currentPosition);
      if (nearbyEdge) {
        return {
          snapTarget: nearbyEdge.edgeId,
          snapType: "edge" as const,
          snapPosition: nearbyEdge.snapPoint,
          intersections: [],
          areaSplits: [],
          previewPoints: [currentPosition, nearbyEdge.snapPoint],
        };
      }

      return null; // No snap available
    },

    deleteEdge: (edgeId: string) => {
      const { crdt } = get();

      const edge = crdt.state.edges[edgeId];
      if (!edge) return;

      // Find orphan points (points that will have no edges after this deletion)
      const orphanPoints: string[] = [];
      const edgePoints = [edge.from, edge.to];

      for (const pointId of edgePoints) {
        const hasOtherEdges = Object.values(crdt.state.edges).some(
          (otherEdge) =>
            otherEdge !== edge &&
            (otherEdge.from === pointId || otherEdge.to === pointId)
        );

        if (!hasOtherEdges) {
          orphanPoints.push(pointId);
        }
      }

      // Use the new atomic operation
      const operation = {
        type: "deleteEdgeWithAreaMerging" as const,
        data: {
          edgeId,
          orphanPoints,
        },
      };

      const newCRDT = applyOperation(crdt, operation);
      set({ crdt: newCRDT });
    },
  }));

const FloorEditingContext = createContext<ReturnType<
  typeof createFloorEditingStore
> | null>(null);

export function FloorEditingProvider({
  children,
  crdt,
  setCRDT,
}: {
  children: ReactNode;
  crdt: NavMapCRDT;
  setCRDT: (crdt: NavMapCRDT) => void;
}) {
  const store = useMemo(
    () => createFloorEditingStore(crdt, setCRDT),
    [crdt, setCRDT]
  );

  return (
    <FloorEditingContext.Provider value={store}>
      {children}
    </FloorEditingContext.Provider>
  );
}

export function useFloorEditingState() {
  const store = useContext(FloorEditingContext);
  if (!store) {
    throw new Error(
      "useFloorEditingState must be used within a FloorEditingProvider"
    );
  }
  return store();
}
