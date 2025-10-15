export type EdgeDirection = 1 | 0 | -1 | undefined;
export type Point = { x: number; y: number; z: number };
export type Edge = {
  from: string;
  to: string;
  dir?: EdgeDirection;
};
export type Area = { points: string[] };
export type Points = Record<string, Point>;
export type Edges = Record<string, Edge>;
export type Areas = Record<string, Area>;
export type NavMap = { points: Points; edges: Edges; areas: Areas };
