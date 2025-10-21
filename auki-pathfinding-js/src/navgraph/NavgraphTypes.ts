import * as THREE from "three";

export type EdgeDirection = 1 | 0 | -1 | undefined;
export type Point = { x: number; y: number; z: number };
export type Edge = {
  from: string;
  to: string;
  dir?: EdgeDirection;
  weightMultiplier?: number; // Optional weight multiplier (default: 1.0)
};
export type Area = { edges: string[] };
export type Points = Record<string, Point>;
export type Edges = Record<string, Edge>;
export type Areas = Record<string, Area>;
export type NavMap = { points: Points; edges: Edges; areas: Areas };

// Enhanced edge weight information
export type EdgeWeightInfo = {
  weight: number;
  path: THREE.Vector3Like[];
};

// Pathfinding result types
export type EdgePathResult = {
  type: "edge";
  position: THREE.Vector3Like;
  edgeId: string;
  fromPointId: string;
  toPointId: string;
  distance: number;
};

export type LegacyPathResult = {
  type: "legacy";
  position: THREE.Vector3Like;
  distance: number;
};

export type AreaGroupPathResult = {
  type: "areaGroup";
  position: THREE.Vector3Like;
  areaGroupId: string;
  distance: number;
};

export type PathResult =
  | EdgePathResult
  | LegacyPathResult
  | AreaGroupPathResult;
