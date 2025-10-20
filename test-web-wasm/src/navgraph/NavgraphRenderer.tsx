import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { DragControls, Line, Text } from "@react-three/drei";
import { Pathfinder } from "auki-pathfinding";
import { NavMeshHelper } from "@recast-navigation/three";
import { useNavgraphDisplayState } from "./NavgraphDisplayState";
import * as constants from "auki-pathfinding";
import { createMeshes } from "./TestLegacyNavmesh";
import { initialize, add } from "auki-pathfinding/wasm";
import { useThree } from "@react-three/fiber";
import { useNavgraphEditingState } from "../editing/NavgraphEditingState";
import { OrbitControls } from "@react-three/drei";

initialize().then(() => {
  console.log("WASM initialized");
  const result = add(5, 2);
  console.log("WSM add Result: ", result);
});

export default function NavgraphRenderer({}: {}) {
  const displayState = useNavgraphDisplayState();
  const editor = useNavgraphEditingState();
  const [path, setPath] = useState<THREE.Vector3Like[] | null>(null);
  const [start, setStart] = useState<THREE.Vector3Like>({ x: 4, y: 0, z: 0 });
  const [end, setEnd] = useState<THREE.Vector3Like>({ x: -5, y: 0, z: -4.5 });
  const startRef = useRef<THREE.Object3D>(null);
  const endRef = useRef<THREE.Object3D>(null);

  useEffect(() => {
    console.log("editor.crdt.state", editor.crdt.state);
  }, [editor.crdt.state]);

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
    const asyncLoad = async () => {
      await pathfinder.load(editor.crdt.state, createMeshes());
      //kickstart the first pathfinding
      setStart({ ...start });
    };
    asyncLoad();
  }, [editor.crdt.state, createMeshes]);

  const handlePointClick = useCallback(
    (pointId: string, event: React.MouseEvent) => {
      event.stopPropagation();

      if (editor.currentTool === "select") {
        editor.togglePointSelection(pointId);
      } else if (editor.currentTool === "drawEdge") {
        if (!editor.edgeDrawingState.isDrawing) {
          // Start edge drawing - select first point
          editor.setEdgeDrawingState({ isDrawing: true, firstPoint: pointId });
        } else {
          // Complete edge drawing - create edge
          if (
            editor.edgeDrawingState.firstPoint &&
            editor.edgeDrawingState.firstPoint !== pointId
          ) {
            editor.addEdge(editor.edgeDrawingState.firstPoint, pointId);
          }

          // Reset edge drawing state
          editor.setEdgeDrawingState({ isDrawing: false, firstPoint: null });
        }
      }
    },
    [
      editor.currentTool,
      editor.edgeDrawingState,
      editor.selectedPoints,
      editor.addEdge,
      editor.crdt,
      editor.setCRDT,
    ]
  );

  const camera = useThree((state) => state.camera);
  // Add this function to NavgraphRenderer.tsx
  const getIntersectionFromClick = useCallback(
    (event: React.MouseEvent) => {
      // Get mouse coordinates normalized to [-1, 1]
      const mouse = new THREE.Vector2();
      mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
      mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

      // Create raycaster
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);

      // Intersect with ground plane (y = 0)
      const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
      const intersection = new THREE.Vector3();

      if (raycaster.ray.intersectPlane(groundPlane, intersection)) {
        return intersection;
      }

      return null;
    },
    [camera]
  );

  const handleEmptySpaceClick = useCallback(
    (event: React.MouseEvent) => {
      if (editor.currentTool !== "addPoint") return;

      // Get 3D coordinates from the click
      const intersection = getIntersectionFromClick(event);
      if (intersection) {
        editor.addPoint(intersection);
      }
    },
    [editor.currentTool, editor.addPoint]
  );

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

  const handleMouseMove = useCallback(
    (event: React.MouseEvent) => {
      if (editor.edgeDrawingState.isDrawing) {
        const intersection = getIntersectionFromClick(event);
        if (intersection) {
          editor.setMousePosition(intersection);
        }
      } else if (editor.dragState.isDragging && editor.dragState.draggedPoint) {
        const intersection = getIntersectionFromClick(event);
        if (intersection) {
          editor.updatePoint(editor.dragState.draggedPoint, intersection);
        }
      }
    },
    [
      editor.edgeDrawingState.isDrawing,
      editor.dragState.isDragging,
      editor.dragState.draggedPoint,
      getIntersectionFromClick,
      editor.updatePoint,
    ]
  );

  const handlePointMouseDown = useCallback(
    (pointId: string, event: React.MouseEvent) => {
      event.stopPropagation();

      if (
        editor.currentTool === "select" &&
        editor.selectedPoints.has(pointId)
      ) {
        const point = pathfinder.getMapPoint(pointId);
        if (point) {
          editor.setDragState({
            isDragging: true,
            draggedPoint: pointId,
            startPosition: new THREE.Vector3(point.x, point.y ?? 0, point.z),
          });
        }
      }
    },
    [editor.currentTool, editor.selectedPoints, editor.setDragState, pathfinder]
  );

  const handleMouseUp = useCallback(() => {
    if (editor.dragState.isDragging) {
      editor.setDragState({
        isDragging: false,
        draggedPoint: null,
        startPosition: null,
      });
    }
  }, [editor.dragState.isDragging, editor.setDragState]);

  return (
    <group>
      <OrbitControls enabled={!editor.dragState.isDragging} makeDefault />
      <mesh
        position={[0, -0.1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={handleEmptySpaceClick}
        onPointerMove={handleMouseMove}
        onPointerUp={handleMouseUp}
      >
        <planeGeometry args={[100, 100]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>
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
          {Object.entries(pathfinder.allPoints).map(([pointId, point]) => (
            <mesh
              key={pointId}
              position={[point.x, point.y ?? 0, point.z]}
              renderOrder={10}
              onClick={(event: React.MouseEvent) =>
                handlePointClick(pointId, event)
              }
              onPointerDown={(event: React.MouseEvent) =>
                handlePointMouseDown(pointId, event)
              }
            >
              <sphereGeometry
                args={[
                  editor.dragState.isDragging &&
                  editor.dragState.draggedPoint === pointId
                    ? 0.15
                    : 0.1,
                  32,
                  32,
                ]}
              />
              <meshStandardMaterial
                color={
                  editor.dragState.isDragging &&
                  editor.dragState.draggedPoint === pointId
                    ? "#FFFF00"
                    : editor.selectedPoints.has(pointId)
                    ? "#00FF00"
                    : "#FF0000"
                }
                depthTest={false}
              />
              <Text
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.1, -0.25]}
                fontSize={0.25}
                color="#000000"
              >
                {pointId}
              </Text>
            </mesh>
          ))}
        </group>
      )}
      {editor.edgeDrawingState.isDrawing &&
        editor.edgeDrawingState.firstPoint &&
        editor.mousePosition && (
          <Line
            points={[
              [
                pathfinder.getMapPoint(editor.edgeDrawingState.firstPoint)!.x,
                pathfinder.getMapPoint(editor.edgeDrawingState.firstPoint)!.y ??
                  0,
                pathfinder.getMapPoint(editor.edgeDrawingState.firstPoint)!.z,
              ],
              [
                editor.mousePosition.x,
                editor.mousePosition.y,
                editor.mousePosition.z,
              ],
            ]}
            color="#ffbb00"
            linewidth={2}
            dashed={true}
            depthTest={false}
            transparent={true}
            renderOrder={20}
          />
        )}
      {displayState.showEdges && (
        <group name="edges">
          {Object.entries(pathfinder.allEdges).map(([edgeId, edge]) => {
            const midpoint = new THREE.Vector3(
              (pathfinder.getMapPoint(edge.from)!.x +
                pathfinder.getMapPoint(edge.to)!.x) /
                2,
              ((pathfinder.getMapPoint(edge.from)!.y ?? 0) +
                (pathfinder.getMapPoint(edge.to)!.y ?? 0)) /
                2,
              (pathfinder.getMapPoint(edge.from)!.z +
                pathfinder.getMapPoint(edge.to)!.z) /
                2
            );
            return (
              <group key={edgeId}>
                <Line
                  key={edgeId}
                  points={[
                    [
                      pathfinder.getMapPoint(edge.from)!.x,
                      pathfinder.getMapPoint(edge.from)!.y ?? 0,
                      pathfinder.getMapPoint(edge.from)!.z,
                    ],
                    [
                      pathfinder.getMapPoint(edge.to)!.x,
                      pathfinder.getMapPoint(edge.to)!.y ?? 0,
                      pathfinder.getMapPoint(edge.to)!.z,
                    ],
                  ]}
                  color="#AA0000"
                  linewidth={0.75}
                  dashed={!!edge.dir}
                  dashSize={0.1}
                  gapSize={0.1}
                  depthTest={false}
                  transparent={true}
                  renderOrder={10}
                />
                <Text
                  rotation={[-Math.PI / 2, 0, 0]}
                  position={midpoint}
                  fontSize={0.25}
                  color="#000000"
                >
                  {edgeId}
                </Text>
              </group>
            );
          })}
        </group>
      )}
      {/* Visualize adjacency list connections */}
      {displayState.showAdjacencyList && (
        <group name="adjacency-list">
          {Array.from(adjacencyList.entries()).map(([fromPointId, neighbors]) =>
            neighbors.map((toPointId: string, i: number) => {
              const fromPoint = pathfinder.getMapPoint(fromPointId);
              const toPoint = pathfinder.getMapPoint(toPointId);

              if (!fromPoint || !toPoint) return null;

              const edgeKey = constants.createEdgeWeightKey(
                fromPointId,
                toPointId
              );
              const connections = pathfinder.edgeWeights.get(edgeKey);
              if (connections && connections.length > 0) {
                // Find the connection with minimum weight (what Dijkstra would choose)
                const chosenConnection = connections.reduce((min, conn) =>
                  conn.weight < min.weight ? conn : min
                );
                const path = chosenConnection.path;
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
                  color="#007700"
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
          {pathfinder.legacyMeshes?.map(({ name, geometry }) => (
            <group key={name}>
              <mesh
                key={name + "x"}
                geometry={geometry}
                position={[0, 0.01, 0]}
              >
                <meshBasicMaterial
                  color="#c8cd88"
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
