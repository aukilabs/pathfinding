import { TestNavData } from "../navgraph/TestNavGraph";
import { createNavMapCRDT, applyOperation, undo, redo } from "./CRDT";

export const testCRDT = () => {
  let crdt = createNavMapCRDT(TestNavData, "test-client");

  console.log("Initial state:", crdt.state);
  console.log("Initial operations:", crdt.operations.length);

  // Test adding multiple points
  const points = [
    { id: "p99", point: { x: 100, y: 0, z: 100 } },
    { id: "p100", point: { x: 200, y: 0, z: 200 } },
    { id: "p101", point: { x: 300, y: 0, z: 300 } },
  ];

  for (const { id, point } of points) {
    crdt = applyOperation(crdt, { type: "setPoint", data: { id, point } });
  }

  // Test adding edges
  const edges = [
    { id: "e99", edge: { from: "p99", to: "p100" } },
    { id: "e100", edge: { from: "p100", to: "p101" } },
    { id: "e101", edge: { from: "p101", to: "p99" } },
    { id: "e102", edge: { from: "p22", to: "p99" } },
    { id: "e103", edge: { from: "p99", to: "p20" } },
    { id: "e104", edge: { from: "p20", to: "p21" } },
  ];

  for (const { id, edge } of edges) {
    crdt = applyOperation(crdt, { type: "setEdge", data: { id, edge } });
  }

  // Test adding areas
  const areas = [
    { id: "a99", area: { edges: ["e99", "e100", "e101"] } },
    { id: "a100", area: { edges: ["e29", "e102", "e103", "e104"] } },
  ];

  for (const { id, area } of areas) {
    crdt = applyOperation(crdt, { type: "setArea", data: { id, area } });
  }

  // Test updating existing points
  crdt = applyOperation(crdt, {
    type: "setPoint",
    data: { id: "p99", point: { x: 150, y: 5, z: 150 } },
  });

  // Test removing some items
  crdt = applyOperation(crdt, { type: "removePoint", data: { id: "p101" } });
  crdt = applyOperation(crdt, { type: "removeEdge", data: { id: "e101" } });
  crdt = applyOperation(crdt, { type: "removeArea", data: { id: "a100" } });

  console.log("After many operations:");
  console.log("Points count:", Object.keys(crdt.state.points).length);
  console.log("Edges count:", Object.keys(crdt.state.edges).length);
  console.log("Areas count:", Object.keys(crdt.state.areas).length);
  console.log("Total operations:", crdt.operations.length);

  // Test undo/redo chain
  console.log("\nTesting undo/redo:");
  for (let i = 0; i < 5; i++) {
    crdt = undo(crdt);
    console.log(`Undo ${i + 1}: operations = ${crdt.operations.length}`);
  }

  for (let i = 0; i < 3; i++) {
    crdt = redo(crdt);
    console.log(`Redo ${i + 1}: operations = ${crdt.operations.length}`);
  }

  console.log("Final state summary:");
  console.log("Points:", Object.keys(crdt.state.points).length);
  console.log("Edges:", Object.keys(crdt.state.edges).length);
  console.log("Areas:", Object.keys(crdt.state.areas).length);
};

testCRDT();
