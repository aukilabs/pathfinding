import ThreeCanvas from "./threed/ThreeCanvas";
import NavgraphToolbar from "./navgraph/NavgraphToolbar";

import { testCRDT } from "./editing/CRDTTest";

console.log("Starting CRDT test...");
testCRDT();
console.log("CRDT test completed.");

function App() {
  return (
    <div className="w-full h-full">
      <ThreeCanvas />
      <NavgraphToolbar />
    </div>
  );
}

export default App;
