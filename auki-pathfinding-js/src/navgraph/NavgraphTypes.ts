import * as THREE from "three";

export type EdgeDirection = 1 | 0 | -1 | undefined;
export type Point = { x: number; y: number; z: number };
export type Edge = {
  from: string;
  to: string;
  dir?: EdgeDirection;
  weightMultiplier?: number; // Optional weight multiplier (default: 1.0)
};
export type Area = { points: string[] };
export type Points = Record<string, Point>;
export type Edges = Record<string, Edge>;
export type Areas = Record<string, Area>;
export type NavMap = { points: Points; edges: Edges; areas: Areas };

// Enhanced edge weight information
export type EdgeWeightInfo = {
  weight: number;
  type: "direct" | "legacy" | "area";
  path: THREE.Vector3Like[];
};
