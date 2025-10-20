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

type EdgeDrawingState = { isDrawing: boolean; firstPoint: string | null };
type DragState = {
  isDragging: boolean;
  draggedPoint: string | null;
  startPosition: THREE.Vector3 | null;
};
type EditingTool = "select" | "addPoint" | "drawEdge";
type EditingAction = "fillArea" | null;

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
  fillArea: (pointIds: string[]) => void;
  detectClosedArea: (pointIds: string[]) => string[] | null;
  performAction: (action: EditingAction | null) => void;
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
  detectClosedArea: (pointIds: string[]) => {
    // Find a closed loop through the selected points and return the edge IDs
    const navMap = get().crdt.state;
    const visited = new Set<string>();

    const dfs = (
      current: string,
      start: string,
      path: string[],
      edgePath: string[]
    ): string[] | null => {
      if (visited.has(current)) return null;
      visited.add(current);

      const connectedEdges = Object.entries(navMap.edges)
        .filter(([_, edge]) => edge.from === current || edge.to === current)
        .filter(([edgeId, edge]) => {
          const neighbor = edge.from === current ? edge.to : edge.from;
          return pointIds.includes(neighbor);
        });

      for (const [edgeId, edge] of connectedEdges) {
        const neighbor = edge.from === current ? edge.to : edge.from;
        if (neighbor === start && path.length > 2) {
          return [...edgePath, edgeId];
        }
        const result = dfs(
          neighbor,
          start,
          [...path, neighbor],
          [...edgePath, edgeId]
        );
        if (result) return result;
      }

      return null;
    };

    for (const pointId of pointIds) {
      visited.clear();
      const result = dfs(pointId, pointId, [pointId], []);
      if (result) return result;
    }

    return null;
  },

  fillArea: (pointIds: string[]) => {
    if (pointIds.length < 3) return; // Minimum 3 points for area
    const closedEdgePath = get().detectClosedArea(pointIds);
    console.log("Closed edge path:", closedEdgePath);
    if (closedEdgePath) {
      const areaId = `a${Date.now()}`;
      const operation = {
        type: "setArea" as const,
        data: { id: areaId, area: { edges: closedEdgePath } },
      };
      const newCRDT = applyOperation(get().crdt, operation);
      set({ crdt: newCRDT, selectedPoints: new Set() });
      console.log("Area filled with edges:", closedEdgePath);
    }
  },
  performAction: (action: EditingAction | null) => {
    if (action === "fillArea") {
      get().fillArea(Array.from(get().selectedPoints));
    }
  },
}));
