# Auki Pathfinding

A hybrid pathfinding library that combines traditional navigation graphs with Recast/Detour NavMeshes for efficient pathfinding in complex 3D environments.

## Features

- **Hybrid Pathfinding**: Combines graph-based pathfinding with NavMesh pathfinding
- **Multi-modal Connections**: Supports direct edges, legacy NavMesh, and area-based NavMesh connections
- **Weight Multipliers**: Configurable edge weights for traffic, terrain difficulty, or preference
- **Precomputed Paths**: Optimized area-to-area pathfinding with cached NavMesh routes
- **Three.js Integration**: Built for Three.js with full TypeScript support

## Installation

```bash
npm install @auki/pathfinding
```

## Basic Usage

```typescript
import { Pathfinder, NavMap } from '@auki/pathfinding';
import * as THREE from 'three';

// Create a pathfinder instance
const pathfinder = new Pathfinder({
  maxOffGraphDistance: 10 // Maximum distance to find nearest point
});

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
    area1: { points: ["p1", "p2", "p3"] }
  }
};

// Load the map and legacy NavMesh (optional)
const legacyNavmesh: THREE.Mesh[] = []; // Your legacy NavMesh meshes
await pathfinder.load(navMap, legacyNavmesh);

// Find a path
const start = { x: 0, y: 0, z: 0 };
const end = { x: 10, y: 0, z: 10 };
const path = pathfinder.findPath(start, end);

if (path) {
  console.log(`Found path with ${path.length} waypoints`);
  const pathLength = pathfinder.getPathLength(path);
  console.log(`Path length: ${pathLength}`);
  
  // Access map data
  const allPoints = pathfinder.allPoints;
  const allEdges = pathfinder.allEdges;
  console.log(`Map has ${Object.keys(allPoints).length} points and ${Object.keys(allEdges).length} edges`);
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

- `load(map: NavMap, legacyNavmesh: THREE.Mesh[]): Promise<void>` - Load navigation data
- `findPath(from: THREE.Vector3Like, to: THREE.Vector3Like): THREE.Vector3Like[] | null` - Find path between two points
- `setConfig(config: NavOptions): void` - Update configuration

#### Data Access Methods

- `getMapPoint(pointId: string): THREE.Vector3Like | null` - Get point by ID
- `getMapEdge(edgeId: string): Edge | null` - Get edge by ID
- `getMapArea(areaId: string): Area | null` - Get area by ID
- `allPoints: Record<string, THREE.Vector3Like>` - Get all points
- `allEdges: Record<string, Edge>` - Get all edges
- `allAreas: Record<string, Area>` - Get all areas
- `getPathLength(path: THREE.Vector3Like[]): number` - Calculate path length

#### Visualization Properties

- `navmeshes: Map<string, NavMesh>` - Area NavMeshes for visualization
- `areaMeshes: Record<string, THREE.Mesh>` - Three.js meshes for areas
- `edgeWeights: Map<string, EdgeWeightInfo[]>` - Edge weight information
- `adjacencyListForVisualization: Map<string, string[]>` - Graph connections
- `loaded: boolean` - Whether the pathfinder is ready

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

#### Point
```typescript
interface Point {
  x: number;
  y: number;
  z: number;
}
```

#### Area
```typescript
interface Area {
  points: string[];
}
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

Define areas for complex pathfinding:

```typescript
const areas = {
  room1: { points: ["p1", "p2", "p3", "p4"] },
  room2: { points: ["p5", "p6", "p7", "p8"] }
};
```

## License

MIT
