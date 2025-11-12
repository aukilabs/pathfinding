# Auki Pathfinding

A hybrid pathfinding library that combines traditional navigation graphs with Recast/Detour NavMeshes for efficient pathfinding in complex 3D environments. Supports traversing across multiple coordinate systems.

## Features

- **Hybrid Pathfinding**: Combines graph-based pathfinding with NavMesh pathfinding
- **Multi-floor Support**: Navigate across multiple floors with inter-floor links

## Installation

```bash
npm install @auki/pathfinding
```

## Basic Usage

```typescript
import { Pathfinder, FloorData, NavMap, NavmeshGeometry } from '@auki/pathfinding';

// Create a pathfinder instance
const pathfinder = new Pathfinder({
  maxOffGraphDistance: 10 // Maximum distance to find nearest point
});

// Initialize Recast (required before loading)
await pathfinder.initializeRecast();

// Define your navigation map
const navMap: NavMap = {
  points: {
    p1: { x: 0, y: 0, z: 0 },
    p2: { x: 10, y: 0, z: 0 },
    p3: { x: 5, y: 0, z: 5 }
  },
  edges: {
    e1: { from: "p1", to: "p2" },
    e2: { from: "p2", to: "p3", weightMultiplier: 2.0 }, // 2x weight
    e3: { from: "p3", to: "p1" }
  },
  areas: {
    area1: { edges: ["e1", "e2", "e3"] } // Areas are defined by edges
  }
};

// Create legacy NavMesh geometry (optional)
// This represents a ground plane mesh for the floor
const legacyNavmesh: NavmeshGeometry[] = [
  {
    // A simple 20x20 ground plane at y=0
    positions: [
      // Triangle 1
      -10, 0, -10,  // vertex 0
      10, 0, -10,   // vertex 1
      10, 0, 10,    // vertex 2
      // Triangle 2
      -10, 0, -10,  // vertex 3
      10, 0, 10,    // vertex 4
      -10, 0, 10,   // vertex 5
    ],
    indices: [0, 1, 2, 3, 4, 5]
  }
];

// Create floor data
const floorData = new FloorData(navMap, legacyNavmesh);

// Load the floor
pathfinder.load(floorData);

// Find a path
const start = { x: 0, y: 0, z: 0 };
const end = { x: 10, y: 0, z: 10 };
const path = pathfinder.findPath(start, end);

if (path) {
  console.log(`Found path with ${path.length} waypoints`);
  path.forEach((point) => {
    console.log(`Point: (${point.point.x}, ${point.point.y}, ${point.point.z}) on floor ${point.floorId}`);
  });
}
```

## API Reference

### Pathfinder Class

#### Constructor
```typescript
new Pathfinder(config?: NavOptions)
```

#### Configuration Options
```typescript
interface NavOptions {
  maxDistance?: number;           // Maximum pathfinding distance
  maxOffGraphDistance?: number;  // Maximum distance to find nearest point
}
```

#### Core Methods

- `initializeRecast(): Promise<void>` - Initialize Recast navigation (required before loading)
- `load(floorData: FloorData): void` - Load single floor navigation data
- `loadMultifloor(data: { data: Record<string, FloorData>, links: InterFloorLink[] }): void` - Load multi-floor navigation data
- `findPath(from: V3, to: V3, fromFloorId: string, toFloorId: string): PathPoint[] | null` - Find path between two points on specified floors
- `setConfig(config: NavOptions): void` - Update configuration

#### Properties

- `loaded: boolean` - Whether the pathfinder is ready

#### FloorData Class

- `constructor(graph: NavMap, navmeshGeometry: NavmeshGeometry[])` - Create floor data from navigation map and legacy NavMesh geometry
- `getGraphPoint(pointId: string): Point | null` - Get point by ID
- `getGraphEdge(edgeId: string): Edge | null` - Get edge by ID
- `getPoints(): Readonly<Record<string, Point>>` - Get all points
- `graph: ReadOnlyNavMap` - Access the navigation graph
- `adjacencies: ReadonlyMap<string, string[]>` - Graph adjacency list
- `edgeWeights: ReadonlyMap<string, EdgeWeightInfo[]>` - Edge weight information

### Data Types

#### NavMap
```typescript
interface NavMap {
  points: Record<string, Point>;
  edges: Record<string, Edge>;
  areas: Record<string, Area>;
}
```

#### Edge
```typescript
interface Edge {
  from: string;
  to: string;
  dir?: EdgeDirection;        // 1, 0, -1, or undefined
  weightMultiplier?: number;  // Optional weight multiplier (default: 1.0)
}
```

#### Point / V3
```typescript
type Point = V3;
type V3 = {
  x: number;
  y: number;
  z: number;
};
```

#### Area
```typescript
interface Area {
  edges: string[]; // Array of edge IDs that form the area boundary
}
```

#### PathPoint
```typescript
type PathPoint = {
  point: V3;
  fromPointId: string;
  toPointId: string;
  floorId: string;
  toFloorId?: string; // Present when crossing floors
  floorLink?: InterFloorLink; // Present when using inter-floor link
};
```

#### NavmeshGeometry
```typescript
type NavmeshGeometry = {
  positions: number[]; // Flat array of x, y, z coordinates
  indices: number[];  // Triangle indices
};
```

## Examples

### Weight Multipliers

Use weight multipliers to discourage certain paths:

```typescript
const edges = {
  e1: { from: "p1", to: "p2" },                    // Normal weight
  e2: { from: "p2", to: "p3", weightMultiplier: 5.0 }, // 5x weight (avoided)
  e3: { from: "p1", to: "p3" }                    // Normal weight
};
```

### Area-based Pathfinding

Define areas using edges for complex pathfinding:

```typescript
const areas = {
  room1: { edges: ["e1", "e2", "e3", "e4"] }, // Edges forming room1 boundary
  room2: { edges: ["e5", "e6", "e7", "e8"] }  // Edges forming room2 boundary
};
```

### Multi-floor Pathfinding

Navigate across multiple floors with inter-floor links:

```typescript
// Define navigation map for floor 1
const navMap1: NavMap = {
  points: {
    p1: { x: 0, y: 0, z: 0 },
    p2: { x: 10, y: 0, z: 0 },
    p3: { x: 5, y: 0, z: 5 },
    stairs1: { x: 0, y: 0, z: 10 } // Stairs connection point
  },
  edges: {
    e1: { from: "p1", to: "p2" },
    e2: { from: "p2", to: "p3" },
    e3: { from: "p3", to: "p1" },
    e4: { from: "p1", to: "stairs1" }
  },
  areas: {
    room1: { edges: ["e1", "e2", "e3"] }
  }
};

// Define navigation map for floor 2
const navMap2: NavMap = {
  points: {
    p4: { x: 0, y: 10, z: 0 },
    p5: { x: 10, y: 10, z: 0 },
    p6: { x: 5, y: 10, z: 5 },
    stairs2: { x: 0, y: 10, z: 10 } // Stairs connection point
  },
  edges: {
    e5: { from: "p4", to: "p5" },
    e6: { from: "p5", to: "p6" },
    e7: { from: "p6", to: "p4" },
    e8: { from: "p4", to: "stairs2" }
  },
  areas: {
    room2: { edges: ["e5", "e6", "e7"] }
  }
};

// Create legacy NavMesh geometry for floor 1 (ground plane at y=0)
const legacyNavmesh1: NavmeshGeometry[] = [
  {
    positions: [
      -10, 0, -10,  10, 0, -10,  10, 0, 10,  // Triangle 1
      -10, 0, -10,  10, 0, 10,   -10, 0, 10,  // Triangle 2
    ],
    indices: [0, 1, 2, 3, 4, 5]
  }
];

// Create legacy NavMesh geometry for floor 2 (ground plane at y=10)
const legacyNavmesh2: NavmeshGeometry[] = [
  {
    positions: [
      -10, 10, -10,  10, 10, -10,  10, 10, 10,  // Triangle 1
      -10, 10, -10,  10, 10, 10,   -10, 10, 10,  // Triangle 2
    ],
    indices: [0, 1, 2, 3, 4, 5]
  }
];

// Create floor data for each floor
const floor1 = new FloorData(navMap1, legacyNavmesh1);
const floor2 = new FloorData(navMap2, legacyNavmesh2);

// Define links between floors (stairs connecting floor1 to floor2)
const links: InterFloorLink[] = [
  {
    fromFloorId: "floor1",
    toFloorId: "floor2",
    fromPointId: "stairs1",
    toPointId: "stairs2",
    weight: 1.0,
    direction: 0 // bidirectional (0 = both directions)
  }
];

// Load multi-floor data
pathfinder.loadMultifloor({
  data: {
    "floor1": floor1,
    "floor2": floor2
  },
  links
});

// Find path across floors
const path = pathfinder.findPath(
  { x: 0, y: 0, z: 0 },      // Start on floor 1
  { x: 10, y: 10, z: 0 },    // End on floor 2
  "floor1",
  "floor2"
);

if (path) {
  console.log(`Found path with ${path.length} waypoints`);
  path.forEach((point) => {
    if (point.toFloorId) {
      console.log(`Crossing from ${point.floorId} to ${point.toFloorId}`);
    }
    console.log(`Point: (${point.point.x}, ${point.point.y}, ${point.point.z})`);
  });
}
```

## License

MIT
