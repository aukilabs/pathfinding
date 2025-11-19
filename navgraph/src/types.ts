export type V3 = {
  x: number;
  y: number;
  z: number;
};

export type Point = V3;

export type EdgeDirection = 1 | 0 | -1 | undefined;

export type Edge = {
  from: string;
  to: string;
  dir?: EdgeDirection;
  weightMultiplier?: number;
};

export type Area = {
  edges: string[];
};

export type Points = Record<string, Point>;
export type Edges = Record<string, Edge>;
export type Areas = Record<string, Area>;

export type NavMap = {
  points: Points;
  edges: Edges;
  areas: Areas;
};

export type MeshGeometry = {
  positions: number[];
  indices: number[];
};
