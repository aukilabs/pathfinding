import { Suspense } from "react";
import { Grid } from "@react-three/drei";
import NavgraphRenderer from "../navgraph/NavgraphRenderer";

export default function Scene() {
  return (
    <>
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

      {/* Simple test cube */}
      <mesh position={[0, 1, 0]}>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="red" />
      </mesh>

      {/* Add NavgraphRenderer back */}
      <Suspense fallback={null}>
        <NavgraphRenderer />
      </Suspense>
    </>
  );
}
