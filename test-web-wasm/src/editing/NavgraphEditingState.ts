import { create } from "zustand";
import {
  applyOperation,
  createNavMapCRDT,
  NavMapCRDT,
  redo,
  undo,
} from "./CRDT";
import { TestNavData } from "../navgraph/TestNavGraph";
import * as THREE from "three";
import { findSmallestUnfilledAreaContainingPoint } from "./AreaFill";

type EdgeDrawingState = { isDrawing: boolean; firstPoint: string | null };
type DragState = {
  isDragging: boolean;
  draggedPoint: string | null;
  startPosition: THREE.Vector3 | null;
};
type EditingTool = "select" | "addPoint" | "drawEdge" | "fillArea";

export const useNavgraphEditingState = create<{
  currentTool: EditingTool;
  setCurrentTool: (tool: EditingTool) => void;
  crdt: NavMapCRDT;
  setCRDT: (crdt: NavMapCRDT) => void;
  // Add to useNavgraphEditingState
  selectedPoints: Set<string>;
  setSelectedPoints: (points: Set<string>) => void;
  edgeDrawingState: { isDrawing: boolean; firstPoint: string | null };
  setEdgeDrawingState: (state: EdgeDrawingState) => void;
  mousePosition: THREE.Vector3 | null;
  setMousePosition: (position: THREE.Vector3 | null) => void;
  dragState: DragState;
  setDragState: (state: DragState) => void;
  addPoint: (position: THREE.Vector3) => void;
  updatePoint: (pointId: string, position: THREE.Vector3) => void;
  addEdge: (from: string, to: string) => void;
  selectPoint: (pointId: string) => void;
  togglePointSelection: (pointId: string) => void;
  clearSelection: () => void;
  undo: () => void;
  redo: () => void;
  fillAreaByClick: (clickPoint: THREE.Vector3) => void;
}>((set, get) => ({
  currentTool: "select",
  setCurrentTool: (tool: EditingTool) =>
    set({
      currentTool: tool,
      edgeDrawingState: { isDrawing: false, firstPoint: null },
    }),
  crdt: createNavMapCRDT(TestNavData, "main-client"),
  setCRDT: (crdt: NavMapCRDT) => set({ crdt }),
  selectedPoints: new Set(),
  setSelectedPoints: (points: Set<string>) => set({ selectedPoints: points }),
  edgeDrawingState: { isDrawing: false, firstPoint: null },
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
    set({ crdt: newCRDT });
  },

  updatePoint: (pointId: string, position: THREE.Vector3) => {
    const operation = {
      type: "setPoint" as const,
      data: { id: pointId, point: { x: position.x, y: 0, z: position.z } },
    };
    const newCRDT = applyOperation(get().crdt, operation);
    set({ crdt: newCRDT });
  },

  addEdge: (from: string, to: string) => {
    const edgeId = `e${Date.now()}`;
    const operation = {
      type: "setEdge" as const,
      data: { id: edgeId, edge: { from, to } },
    };
    const newCRDT = applyOperation(get().crdt, operation);
    set({ crdt: newCRDT });
  },

  selectPoint: (pointId: string) => {
    set({ selectedPoints: new Set([pointId]) });
  },

  togglePointSelection: (pointId: string) => {
    const current = get().selectedPoints;
    const newSet = new Set(current);
    if (newSet.has(pointId)) {
      newSet.delete(pointId);
    } else {
      newSet.add(pointId);
    }
    set({ selectedPoints: newSet });
  },

  clearSelection: () => {
    set({ selectedPoints: new Set() });
  },

  undo: () => {
    const newCRDT = undo(get().crdt);
    set({ crdt: newCRDT });
  },

  redo: () => {
    const newCRDT = redo(get().crdt);
    set({ crdt: newCRDT });
  },

  fillAreaByClick: (clickPoint: THREE.Vector3) => {
    const state = get().crdt.state;
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
      const newCRDT = applyOperation(get().crdt, operation);
      set({ crdt: newCRDT });
    }
  },
}));
