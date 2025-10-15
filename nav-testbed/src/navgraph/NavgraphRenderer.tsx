import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DragControls, Line, Text, Wireframe } from "@react-three/drei";
import { Pathfinder } from "./Pathfinder";
import { NavMeshHelper } from "@recast-navigation/three";
import { useNavgraphDisplayState } from "./NavgraphDisplayState";
import { TestNavData } from "./TestNavGraph";
import * as constants from "./Constants";
import { createMeshes } from "./TestLegacyNavmesh";

//type Floors = Record<string, { y: number; name: string }>;

// const floors: Floors = {
//   f1: {
//     y: 0,
//     name: "Floor 1",
//   },
// };

export default function NavgraphRenderer() {
  const displayState = useNavgraphDisplayState();
  const [path, setPath] = useState<THREE.Vector3Like[] | null>(null);
  const [start, setStart] = useState<THREE.Vector3Like>({ x: 4, y: 0, z: 0 });
  const [end, setEnd] = useState<THREE.Vector3Like>({ x: -5, y: 0, z: -4.5 });
  const startRef = useRef<THREE.Object3D>(null);
  const endRef = useRef<THREE.Object3D>(null);

  const legacyNavmesh = useMemo(createMeshes, []);
  const navMap = useMemo(() => TestNavData, []);

  // Initialize refs with initial positions
  useEffect(() => {
    if (startRef.current) {
      startRef.current.position.set(start.x, start.y, start.z);
    }
    if (endRef.current) {
      endRef.current.position.set(end.x, end.y, end.z);
    }
  }, []);

  const pathfinder = useMemo(() => {
    return new Pathfinder({ maxOffGraphDistance: 10 });
  }, []);

  useEffect(() => {
    console.log("Loading pathfinder");
    const asyncLoad = async () => {
      await pathfinder.load(TestNavData, legacyNavmesh);
      //kickstart the first pathfinding
      setStart({ ...start });
    };
    asyncLoad();
  }, [pathfinder]);

  useEffect(() => {
    if (!pathfinder.loaded) return;
    const path = pathfinder.findPath(start, end);
    setPath(path);
  }, [pathfinder, start, end]);

  // Get adjacency list for visualization
  const adjacencyList = useMemo(() => {
    if (!pathfinder.loaded) return new Map();
    return pathfinder.adjacencyListForVisualization;
  }, [pathfinder, pathfinder.loaded, pathfinder.adjacencyListForVisualization]);

  const navmeshHelpers = useCallback(
    (id: string) => {
      return new NavMeshHelper(pathfinder.navmeshes.get(id)!);
    },
    [pathfinder.navmeshes]
  );

  return (
    <group>
      {displayState.showNavmesh && (
        <group name="navmesh">
          {Array.from(pathfinder.navmeshes.entries()).map(([id, _]) => {
            return <primitive key={id} object={navmeshHelpers(id)} />;
          })}
        </group>
      )}
      <group name="inputs">
        <DragControls
          axisLock="y"
          onDragEnd={() => {
            if (startRef.current) {
              const worldPos = new THREE.Vector3();
              startRef.current.getWorldPosition(worldPos);
              setStart(worldPos);
            }
          }}
        >
          <group ref={startRef} name="start">
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color="cyan" />
            </mesh>
          </group>
        </DragControls>
        <DragControls
          axisLock="y"
          onDragEnd={() => {
            if (endRef.current) {
              const worldPos = new THREE.Vector3();
              endRef.current.getWorldPosition(worldPos);
              setEnd(worldPos);
            }
          }}
        >
          <group ref={endRef} name="end">
            <mesh>
              <boxGeometry args={[1, 1, 1]} />
              <meshStandardMaterial color="blue" />
            </mesh>
          </group>
        </DragControls>
      </group>
      {displayState.showPoints && (
        <group name="points">
          {Object.entries(navMap.points).map(([pointId, point]) => (
            <mesh
              key={pointId}
              position={[point.x, point.y ?? 0, point.z]}
              renderOrder={10}
            >
              <sphereGeometry args={[0.05, 32, 32]} />
              <meshStandardMaterial color="#FF0000" depthTest={false} />
              <Text
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.5, 0]}
                fontSize={0.25}
                color="#000000"
              >
                {pointId}
              </Text>
            </mesh>
          ))}
        </group>
      )}

      {displayState.showEdges && (
        <group name="edges">
          {Object.entries(navMap.edges).map(([edgeId, edge]) => (
            <Line
              key={edgeId}
              points={[
                [
                  navMap.points[edge.from].x,
                  navMap.points[edge.from].y ?? 0,
                  navMap.points[edge.from].z,
                ],
                [
                  navMap.points[edge.to].x,
                  navMap.points[edge.to].y ?? 0,
                  navMap.points[edge.to].z,
                ],
              ]}
              color="#FF0000"
              linewidth={1}
              dashed={!!edge.dir}
              dashSize={0.1}
              gapSize={0.1}
              depthTest={false}
              transparent={true}
              renderOrder={10}
            />
          ))}
        </group>
      )}

      {/* Visualize adjacency list connections */}
      {displayState.showAdjacencyList && (
        <group name="adjacency-list">
          {Array.from(adjacencyList.entries()).map(([fromPointId, neighbors]) =>
            neighbors.map((toPointId: string, i: number) => {
              const fromPoint = navMap.points[fromPointId];
              const toPoint = navMap.points[toPointId];

              if (!fromPoint || !toPoint) return null;

              if (
                pathfinder.preComputedAreaPaths.has(
                  constants.createEdgeWeightKey(fromPointId, toPointId)
                )
              ) {
                const path = pathfinder.preComputedAreaPaths.get(
                  constants.createEdgeWeightKey(fromPointId, toPointId)
                );
                return (
                  <Line
                    key={`adj-${fromPointId}-${toPointId}-${i}`}
                    points={
                      path?.map((point) => [point.x, point.y ?? 0, point.z]) ??
                      []
                    }
                    color="#00AAFF"
                    linewidth={2}
                    dashed={false}
                    depthTest={false}
                    transparent={true}
                    renderOrder={5}
                  />
                );
              }

              return (
                <Line
                  key={`adj-${fromPointId}-${toPointId}-${i}`}
                  points={[
                    [fromPoint.x, (fromPoint.y ?? 0) + 0.1, fromPoint.z],
                    [toPoint.x, (toPoint.y ?? 0) + 0.1, toPoint.z],
                  ]}
                  color="#00AAFF"
                  linewidth={2}
                  dashed={false}
                  depthTest={false}
                  transparent={true}
                  renderOrder={5}
                />
              );
            })
          )}
        </group>
      )}
      {displayState.showAreas && (
        <group name="area-meshes">
          {Object.entries(pathfinder.areaMeshes).map(([areaId, mesh]) => {
            return (
              <group key={areaId}>
                <primitive object={mesh} onPointerOver={() => {}}>
                  <meshStandardMaterial
                    color="red"
                    depthTest={false}
                    opacity={0.5}
                    transparent={true}
                  />
                </primitive>
              </group>
            );
          })}
        </group>
      )}
      {displayState.showPath && (
        <group name="path">
          {/* draw lines between consecutive points in path */}
          {path &&
            path.length > 1 &&
            path.map((currentPoint, index) => {
              if (index === path.length - 1) return null; // Skip last point
              const nextPoint = path[index + 1];

              return (
                <Line
                  key={`path-${index}`}
                  points={[
                    [currentPoint.x, currentPoint.y ?? 0, currentPoint.z],
                    [nextPoint.x, nextPoint.y ?? 0, nextPoint.z],
                  ]}
                  color="#00FF00"
                  linewidth={3}
                  dashed={false}
                  depthTest={false}
                  transparent={true}
                  renderOrder={15}
                />
              );
            })}
          {path &&
            path.length > 1 &&
            path.map((currentPoint, index) => {
              return (
                <mesh
                  key={"path-point-" + index}
                  position={[
                    currentPoint.x,
                    currentPoint.y ?? 0,
                    currentPoint.z,
                  ]}
                  renderOrder={15}
                  onPointerOver={() => {}}
                >
                  <sphereGeometry args={[0.05, 32, 32]} />
                  <meshStandardMaterial color="#00FF00" depthTest={false} />
                  <Text
                    rotation={[-Math.PI / 2, 0, 0]}
                    position={[0, 0.5, 0]}
                    fontSize={0.25}
                    color="#007700"
                    renderOrder={20}
                  >
                    {index}
                  </Text>
                </mesh>
              );
            })}
        </group>
      )}
      {displayState.showLegacyNavmesh && (
        <group>
          {legacyNavmesh?.map(({ name, geometry }) => (
            <group key={name}>
              <mesh
                key={name + "x"}
                geometry={geometry}
                position={[0, 0.01, 0]}
              >
                <meshBasicMaterial
                  color="#38bdf8"
                  depthWrite={true}
                  depthTest={true}
                />
              </mesh>
            </group>
          ))}
        </group>
      )}
    </group>
  );
}
