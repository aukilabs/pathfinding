import { NavMap } from "@auki/pathfinding";

export const TestNavData: NavMap = {
  points: {
    p37: {
      x: 0,
      y: 0,
      z: -22,
    },
    p38: {
      x: 0,
      y: 0,
      z: -18,
    },
    pInside: {
      x: -2,
      y: 0,
      z: -20,
    },
    pLeaf1: {
      x: -3,
      y: 0,
      z: -20,
    },
    pLeaf2: {
      x: -1,
      y: 0,
      z: -21,
    },
    p42: {
      x: -5,
      y: 0,
      z: -20,
    },
    pEdge: {
      x: -2,
      y: 0,
      z: -19,
    },
  },
  edges: {
    e45: {
      from: "p38",
      to: "p37",
    },

    e50: {
      from: "p42",
      to: "pEdge",
    },
    e51: {
      from: "pEdge",
      to: "p38",
    },
    eNo: {
      from: "pEdge",
      to: "pInside",
    },
    eBranch1: {
      from: "pInside",
      to: "pLeaf1",
    },
    eBranch2: {
      from: "pInside",
      to: "pLeaf2",
    },
    e57: {
      from: "p37",
      to: "p42",
    },
  },
  areas: {},
};
