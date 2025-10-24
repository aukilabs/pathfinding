import ThreeCanvas from "./threed/ThreeCanvas";
import NavgraphToolbar from "./navgraph/NavgraphToolbar";
import { Grid } from "@react-three/drei";
import { Suspense } from "react";
import NavgraphRenderer from "./navgraph/NavgraphRenderer";
import { useMultiFloorState } from "./multifloor/MultifloorState";
import { FloorEditingProvider } from "./multifloor/FloorEditingProvider";
import { Button } from "react-aria-components";

function App() {
  const { floorData, addFloor } = useMultiFloorState();

  return (
    <div className="w-full h-screen flex flex-col bg-black">
      <div
        className="flex-1 gap-1 p-1 overflow-auto"
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(400px, 1fr))",
          gridAutoRows: "minmax(300px, 1fr)",
        }}
      >
        {floorData.floors.map((floor) => (
          <FloorEditingProvider key={floor.id}>
            <div className="flex flex-col relative">
              <div className="flex-1">
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
              </div>
              <div className="absolute top-0 left-1/2 transform -translate-x-1/2 ">
                <div className="bg-black rounded-10  text-white p-2.5 flex flex-row gap-2.5 items-center">
                  {floor.name}
                </div>
              </div>
              <NavgraphToolbar />
            </div>
          </FloorEditingProvider>
        ))}
        <div className="absolute top-5 right-5 flex gap-2.5">
          <div className="bg-white rounded-10 shadow-gotu border border-gray-300 p-2.5 flex flex-row gap-2.5 items-center">
            <Button
              className="text-gotu-disabled enabled:text-[#101010] enabled:cursor-pointer p-2"
              onPress={() => {
                console.log("Adding floor");
                addFloor("Floor " + (floorData.floors.length + 1));
              }}
            >
              Add Floor
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
