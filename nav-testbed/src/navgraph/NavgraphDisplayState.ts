import { create } from "zustand";

export const useNavgraphDisplayState = create<{
  showEdges: boolean;
  showPoints: boolean;
  showPath: boolean;
  showAreas: boolean;
  showNavmesh: boolean;
  showAdjacencyList: boolean;
  showLegacyNavmesh: boolean;
  setShowEdges: (show: boolean) => void;
  setShowPoints: (show: boolean) => void;
  setShowPath: (show: boolean) => void;
  setShowAreas: (show: boolean) => void;
  setShowNavmesh: (show: boolean) => void;
  setShowAdjacencyList: (show: boolean) => void;
  setShowLegacyNavmesh: (show: boolean) => void;
}>((set) => ({
  showEdges: true,
  showPoints: true,
  showPath: true,
  showAreas: true,
  showNavmesh: false,
  showAdjacencyList: false,
  showLegacyNavmesh: true,
  setShowEdges: (show: boolean) => set({ showEdges: show }),
  setShowPoints: (show: boolean) => set({ showPoints: show }),
  setShowPath: (show: boolean) => set({ showPath: show }),
  setShowAreas: (show: boolean) => set({ showAreas: show }),
  setShowNavmesh: (show: boolean) => set({ showNavmesh: show }),
  setShowAdjacencyList: (show: boolean) => set({ showAdjacencyList: show }),
  setShowLegacyNavmesh: (show: boolean) => set({ showLegacyNavmesh: show }),
}));
