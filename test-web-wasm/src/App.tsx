import ThreeCanvas from "./threed/ThreeCanvas";
import NavgraphToolbar from "./navgraph/NavgraphToolbar";
import { Grid } from "@react-three/drei";
import { Suspense } from "react";
import NavgraphRenderer from "./navgraph/NavgraphRenderer";

function App() {
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
          <NavgraphRenderer />
        </Suspense>
      </ThreeCanvas>
      <NavgraphToolbar />
    </div>
  );
}

export default App;
