# @auki/navgraph

Navigation graph library for pathfinding.

## Installation

```bash
npm install @auki/navgraph
```

## Basic Usage

```typescript
import { NavMap, Point, Edge, Area } from '@auki/navgraph';

const navMap: NavMap = {
  points: {
    p1: { x: 0, y: 0, z: 0 },
    p2: { x: 10, y: 0, z: 0 },
    p3: { x: 5, y: 0, z: 5 }
  },
  edges: {
    e1: { from: "p1", to: "p2" },
    e2: { from: "p2", to: "p3" },
    e3: { from: "p3", to: "p1" }
  },
  areas: {
    area1: { edges: ["e1", "e2", "e3"] }
  }
};
```

## License

MIT

