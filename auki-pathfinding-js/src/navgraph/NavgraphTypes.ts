import { Edge, EdgeDirection, NavMap, Point, V3 } from "@auki/navgraph";

export type ReadOnlyPoints = Readonly<{
  [key: string]: Readonly<Point>;
}>;

export type ReadOnlyEdges = Readonly<{
  [key: string]: Readonly<Edge>;
}>;

export type ReadOnlyAreas = Readonly<{
  [key: string]: Readonly<{ edges: Readonly<string[]> }>;
}>;
export type ReadOnlyNavMap = Readonly<{
  points: ReadOnlyPoints;
  edges: ReadOnlyEdges;
  areas: ReadOnlyAreas;
}>;

// Floor metadata for a navigation map
export type FloorNavMap = {
  floorId: string;
  navMap: NavMap;
};

// Multi-floor pathfinding input
export type MultiFloorPathInput = {
  floors: FloorNavMap[];
  links?: InterFloorLink[]; // Links between floors (stairs, elevators, etc.)
};

export type InterFloorLink = {
  fromFloorId: string;
  toFloorId: string;
  fromPointId: string;
  toPointId: string;
  weight: number;
  direction: EdgeDirection;
};

// Enhanced edge weight information
export type EdgeWeightInfo = {
  weight: number;
  path: V3[];
};

// Pathfinding result types
export type EdgePathResult = {
  type: "edge";
  position: V3;
  edgeId: string;
  fromPointId: string;
  toPointId: string;
  distance: number;
};

export type LegacyPathResult = {
  type: "legacy";
  position: V3;
  distance: number;
};

export type AreaGroupPathResult = {
  type: "areaGroup";
  position: V3;
  areaGroupId: string;
  distance: number;
};

export type PathResult =
  | EdgePathResult
  | LegacyPathResult
  | AreaGroupPathResult;

export type PathPoint = {
  point: V3;
  fromPointId: string;
  toPointId: string;
  floorId: string;
  toFloorId?: string;
  floorLink?: InterFloorLink;
};
