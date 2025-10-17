import ThreeCanvas from "./threed/ThreeCanvas";
import NavgraphToolbar from "./navgraph/NavgraphToolbar";

import { testCRDT } from "./editing/CRDTTest";
import { Grid } from "@react-three/drei";
import { Suspense, useState } from "react";
import NavgraphRenderer from "./navgraph/NavgraphRenderer";
import { createNavMapCRDT } from "./editing/CRDT";
import { TestNavData } from "./navgraph/TestNavGraph";

console.log("Starting CRDT test...");
testCRDT();
console.log("CRDT test completed.");

function App() {
  const [crdt, setCRDT] = useState(() =>
    createNavMapCRDT(TestNavData, "main-client")
  );

  // In NavgraphRenderer.tsx
  const [currentTool, setCurrentTool] = useState<
    "select" | "addPoint" | "drawEdge"
  >("select");

  return (
    <div className="w-full h-full">
      <ThreeCanvas>
        <color attach="background" args={["#f0f0f0"]} />
        <ambientLight intensity={Math.PI / 2} />
        <directionalLight intensity={2} position={[10, 100, 10]} />
        <Grid
          infiniteGrid
          cellSize={1}
          cellThickness={0.5}
          cellColor="#6f6f6f"
          sectionSize={5}
          sectionThickness={1.5}
          sectionColor="#a5b4fc"
          fadeDistance={400}
          fadeStrength={10}
          followCamera={false}
        />

        {/* Add NavgraphRenderer back */}
        <Suspense fallback={null}>
          <NavgraphRenderer
            navMapCrdt={crdt}
            currentTool={currentTool}
            onCRDTChange={setCRDT}
          />
        </Suspense>
      </ThreeCanvas>
      <NavgraphToolbar
        crdt={crdt}
        onCRDTChange={setCRDT}
        currentTool={currentTool}
        onToolChange={setCurrentTool}
      />
    </div>
  );
}

export default App;
