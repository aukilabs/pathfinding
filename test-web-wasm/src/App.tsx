import ThreeCanvas from "./threed/ThreeCanvas";
import NavgraphToolbar from "./navgraph/NavgraphToolbar";
import { Grid, Line } from "@react-three/drei";
import { Suspense, useMemo, useState, useEffect, useCallback } from "react";
import NavgraphRenderer from "./navgraph/NavgraphRenderer";
import { useMultiFloorState } from "./multifloor/MultifloorState";
import { FloorEditingProvider } from "./multifloor/FloorEditingProvider";
import { Button } from "react-aria-components";
import { Pathfinder, FloorData } from "auki-pathfinding";
import { NavMapCRDT, createNavMapCRDT } from "./editing/CRDT";
import { TestNavData } from "./navgraph/TestNavGraph";
import { NavEndPoint } from "./navgraph/NavEndPoint";
import { FloorSelectionContextMenu } from "./navgraph/FloorSelectionContextMenu";
import * as THREE from "three";
import { ThreeEvent } from "@react-three/fiber";
import { FloorDataProvider } from "./multifloor/FloorDataProvider";
import { createMeshes } from "./navgraph/TestLegacyNavmesh";

const initialFloorCRDTs: Record<string, NavMapCRDT> = {
  f1: createNavMapCRDT({ ...TestNavData }, "floor-f1"),
  f2: createNavMapCRDT({ ...TestNavData }, "floor-f2"),
};

const testlegacy = createMeshes();

function App() {
  const { floorData, addFloor } = useMultiFloorState();

  const [floorCRDTs, setFloorCRDTs] =
    useState<Record<string, NavMapCRDT>>(initialFloorCRDTs);

  // Handle CRDT updates from floors
  const updateFloorCRDT = useCallback(
    (floorId: string, newCRDT: NavMapCRDT) => {
      setFloorCRDTs((prev) => ({ ...prev, [floorId]: newCRDT }));
      console.log("Updated floor CRDT:", floorId, newCRDT);
    },
    []
  );

  const [path, setPath] = useState<
    | {
        point: THREE.Vector3Like;
        fromPointId: string;
        toPointId: string;
        floorId: string;
      }[]
    | null
  >(null);

  const [pathfinderInitialized, setPathfinderInitialized] = useState(false);

  const floorMaps = useMemo(() => {
    if (!pathfinderInitialized) return {};
    return Object.entries(floorCRDTs).reduce((acc, [floorId, crdt]) => {
      acc[floorId] = new FloorData(crdt.state, testlegacy);
      return acc;
    }, {} as Record<string, FloorData>);
  }, [floorCRDTs, pathfinderInitialized]);

  const pathfinder = useMemo(() => {
    const pathfinder = new Pathfinder({ maxOffGraphDistance: 10 });
    pathfinder.initializeRecast().then(() => {
      setPathfinderInitialized(true);
    });
    return pathfinder;
  }, []);

  useEffect(() => {
    if (!pathfinderInitialized) return;

    pathfinder.loadMultifloor({
      data: floorMaps,
      links: floorData.links,
    });
    //do this to trigger the first pathfind
    setStart({ ...start });
  }, [pathfinderInitialized, floorMaps, floorData.links]);

  const [start, setStart] = useState<{
    floorId: string;
    position: THREE.Vector3Like;
  }>({ floorId: "f1", position: { x: 2, y: 0, z: -20 } });

  const [end, setEnd] = useState<{
    floorId: string;
    position: THREE.Vector3Like;
  }>({ floorId: "f2", position: { x: -7, y: 0, z: -20 } });

  useEffect(() => {
    if (!pathfinder.loaded) return;

    const path = pathfinder.findPath(
      start.position,
      end.position,
      start.floorId,
      end.floorId
    );

    setPath(path);
    console.log("Path:", path);
  }, [start, end]);

  // Context menu state
  const [contextMenu, setContextMenu] = useState<{
    visible: boolean;
    position: { x: number; y: number };
    endpoint: "start" | "end" | null;
  }>({
    visible: false,
    position: { x: 0, y: 0 },
    endpoint: null,
  });

  // Handle context menu
  const handleContextMenu = (
    event: ThreeEvent<MouseEvent>,
    endpoint: "start" | "end"
  ) => {
    event.stopPropagation();
    setContextMenu({
      visible: true,
      position: { x: event.clientX, y: event.clientY },
      endpoint,
    });
  };

  const handleFloorSelect = (floorId: string) => {
    if (contextMenu.endpoint === "start") {
      setStart({ ...start, floorId });
    } else if (contextMenu.endpoint === "end") {
      setEnd({ ...end, floorId });
    }
  };

  const closeContextMenu = () => {
    setContextMenu({
      visible: false,
      position: { x: 0, y: 0 },
      endpoint: null,
    });
  };

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
        {floorData.floors.map((floor) => {
          const floorCRDT = floorCRDTs[floor.id];
          if (!floorCRDT) return null; // Skip rendering until CRDT is initialized

          return (
            <FloorEditingProvider
              key={floor.id}
              crdt={floorCRDT}
              setCRDT={(newCRDT) => updateFloorCRDT(floor.id, newCRDT)}
            >
              <FloorDataProvider key={floor.id} floorData={floorMaps[floor.id]}>
                <div className="flex flex-col relative">
                  <div className="flex-1">
                    <ThreeCanvas>
                      <color attach="background" args={["#f0f0f0"]} />
                      <ambientLight intensity={Math.PI / 2} />
                      <directionalLight
                        intensity={2}
                        position={[10, 100, 10]}
                      />
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

                      {/* Add NavEndPoints for this floor */}
                      <NavEndPoint
                        color="cyan"
                        name="Start"
                        visible={start.floorId === floor.id}
                        position={
                          new THREE.Vector3(
                            start.position.x,
                            start.position.y,
                            start.position.z
                          )
                        }
                        setPosition={(pos) =>
                          setStart({ ...start, position: pos })
                        }
                        onContextMenu={(event) =>
                          handleContextMenu(event, "start")
                        }
                      />
                      <NavEndPoint
                        color="blue"
                        name="End"
                        visible={end.floorId === floor.id}
                        position={
                          new THREE.Vector3(
                            end.position.x,
                            end.position.y,
                            end.position.z
                          )
                        }
                        setPosition={(pos) => setEnd({ ...end, position: pos })}
                        onContextMenu={(event: ThreeEvent<MouseEvent>) =>
                          handleContextMenu(event, "end")
                        }
                      />
                      {path &&
                        path.length > 1 &&
                        path.map((currentPoint, index) => {
                          if (index === path.length - 1) return null; // Skip last point

                          if (currentPoint.floorId !== floor.id) return null;
                          const nextPoint = path[index + 1];

                          return (
                            <Line
                              key={`path-${index}`}
                              points={[
                                [
                                  currentPoint.point.x,
                                  currentPoint.point.y ?? 0,
                                  currentPoint.point.z,
                                ],
                                [
                                  nextPoint.point.x,
                                  nextPoint.point.y ?? 0,
                                  nextPoint.point.z,
                                ],
                              ]}
                              color="#007700"
                              linewidth={3}
                              dashed={false}
                              depthTest={false}
                              transparent={true}
                              renderOrder={15}
                            />
                          );
                        })}
                    </ThreeCanvas>
                  </div>
                  <div className="absolute top-0 left-1/2 transform -translate-x-1/2 ">
                    <div className="bg-black rounded-10  text-white p-2.5 flex flex-row gap-2.5 items-center">
                      {floor.name}
                    </div>
                  </div>
                  <NavgraphToolbar />
                </div>
              </FloorDataProvider>
            </FloorEditingProvider>
          );
        })}
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

      {/* Context Menu */}
      <FloorSelectionContextMenu
        visible={contextMenu.visible}
        position={contextMenu.position}
        onFloorSelect={handleFloorSelect}
        onClose={closeContextMenu}
        currentFloorId={
          contextMenu.endpoint === "start" ? start.floorId : end.floorId
        }
      />
    </div>
  );
}

export default App;
