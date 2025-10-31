import { useCallback, useEffect, useMemo } from "react";
import * as THREE from "three";
import { useNavgraphDisplayState } from "./NavgraphDisplayState";
import { useThree } from "@react-three/fiber";
import { useFloorEditingState } from "../multifloor/FloorEditingProvider";
import { Line, MapControls, Text } from "@react-three/drei";
import { useFloorData } from "../multifloor/FloorDataProvider";
import { createEdgeWeightKey } from "auki-pathfinding";
import { setGeometryFromOBJ } from "../navmeshprocessing/setGeometryFromOBJ";

export default function NavgraphRenderer({}: {}) {
  const displayState = useNavgraphDisplayState();
  const editor = useFloorEditingState();
  const floorData = useFloorData();

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && editor.edgeDrawingState.isDrawing) {
        editor.cancelEdgeDrawing();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor.edgeDrawingState.isDrawing, editor.cancelEdgeDrawing]);

  const handlePointClick = useCallback(
    (pointId: string, event: React.MouseEvent) => {
      event.stopPropagation();

      if (editor.currentTool === "select") {
        editor.selectPoint(editor.selectedPoint === pointId ? null : pointId);
      } else if (editor.currentTool === "drawEdge") {
        const point = editor.crdt.state.points[pointId];
        if (!point) return;

        const pointPosition = new THREE.Vector3(point.x, point.y ?? 0, point.z);

        if (!editor.edgeDrawingState.isDrawing) {
          // Start edge drawing from existing point
          editor.setEdgeDrawingState({
            isDrawing: true,
            firstPoint: pointId,
            firstPointPosition: pointPosition,
            isCreatingNewPoints: false,
          });
        } else {
          // Complete edge drawing - snap to this point
          editor.completeEdgeDrawing(pointPosition);
        }
      }
    },
    [
      editor.currentTool,
      editor.edgeDrawingState,
      editor.selectedPoint,
      editor.addEdge,
      editor.crdt,
      editor.setCRDT,
    ]
  );

  const camera = useThree((state) => state.camera);
  const gl = useThree((state) => state.gl);
  // Add this function to NavgraphRenderer.tsx
  const getIntersectionFromClick = useCallback(
    (event: React.MouseEvent) => {
      // Get the canvas element's bounding rectangle
      const canvas = gl.domElement;
      const rect = canvas.getBoundingClientRect();

      // Get mouse coordinates normalized to [-1, 1] relative to the canvas
      const mouse = new THREE.Vector2();
      mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
      mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

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
    [camera, gl]
  );

  const handleEmptySpaceClick = useCallback(
    (event: React.MouseEvent) => {
      // Get 3D coordinates from the click
      const intersection = getIntersectionFromClick(event);
      if (!intersection) return;

      if (editor.currentTool === "addPoint") {
        editor.addPoint(intersection);
      } else if (editor.currentTool === "fillArea") {
        editor.toggleAreaFillAroundClick(intersection);
      } else if (editor.currentTool === "drawEdge") {
        if (!editor.edgeDrawingState.isDrawing) {
          // Start edge drawing
          editor.startEdgeDrawing(intersection);
        } else {
          // Complete edge drawing
          editor.completeEdgeDrawing(intersection);
        }
      }
    },
    [
      editor.currentTool,
      editor.addPoint,
      editor.toggleAreaFillAroundClick,
      editor.startEdgeDrawing,
      editor.completeEdgeDrawing,
      editor.edgeDrawingState.isDrawing,
      getIntersectionFromClick,
    ]
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
      } else if (editor.currentTool === "drawEdge") {
        // Update mouse position for first click preview
        const intersection = getIntersectionFromClick(event);
        if (intersection) {
          editor.setMousePosition(intersection);
        }
      }
    },
    [
      editor.edgeDrawingState.isDrawing,
      editor.dragState.isDragging,
      editor.dragState.draggedPoint,
      editor.currentTool,
      getIntersectionFromClick,
      editor.updatePoint,
      editor.setMousePosition,
    ]
  );

  const handlePointMouseDown = useCallback(
    (pointId: string, event: React.MouseEvent) => {
      event.stopPropagation();

      if (
        editor.currentTool === "drawEdge" &&
        editor.selectedPoint === pointId
      ) {
        const point = editor.crdt.state.points[pointId];
        if (point) {
          editor.setDragState({
            isDragging: true,
            draggedPoint: pointId,
            startPosition: new THREE.Vector3(point.x, point.y ?? 0, point.z),
          });
        }
      }
    },
    [
      editor.currentTool,
      editor.selectedPoint,
      editor.setDragState,
      editor.crdt.state,
    ]
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

  const legacyMeshGeometries = useMemo(() => {
    return floorData.getLegacyMeshes()?.map((obj) => {
      const geometry = new THREE.BufferGeometry();
      setGeometryFromOBJ(obj, geometry);
      return geometry;
    });
  }, [floorData.getLegacyMeshes()]);

  return (
    <group>
      <MapControls enabled={!editor.dragState.isDragging} makeDefault />
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
      {displayState.showPoints && (
        <group name="points">
          {Object.entries(editor.crdt.state.points).map(([pointId, point]) => (
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
                    : editor.selectedPoint === pointId
                    ? "#00FF00"
                    : "#FF0000"
                }
                depthTest={false}
              />
              <Text
                rotation={[-Math.PI / 2, 0, 0]}
                position={[0, 0.05, -0.15]}
                fontSize={0.1}
                color="#888888"
                visible={true}
              >
                {pointId}
              </Text>
            </mesh>
          ))}
        </group>
      )}
      {/* First click preview (when draw edge tool is active but not drawing yet) */}
      {editor.currentTool === "drawEdge" &&
        !editor.edgeDrawingState.isDrawing &&
        editor.mousePosition &&
        (() => {
          const preview = editor.getFirstClickPreview(editor.mousePosition);
          if (!preview) return null;

          return (
            <>
              {/* Snap highlight */}
              {preview.snapTarget && preview.snapPosition && (
                <mesh
                  position={[
                    preview.snapPosition.x,
                    preview.snapPosition.y,
                    preview.snapPosition.z,
                  ]}
                  renderOrder={25}
                >
                  <sphereGeometry args={[0.12, 16, 16]} />
                  <meshStandardMaterial
                    color={preview.snapType === "point" ? "#00ff00" : "#0000ff"}
                    depthTest={false}
                    transparent={true}
                    opacity={0.7}
                  />
                </mesh>
              )}
            </>
          );
        })()}

      {/* Edge drawing preview */}
      {editor.edgeDrawingState.isDrawing &&
        editor.edgeDrawingState.firstPointPosition &&
        editor.mousePosition &&
        (() => {
          const preview = editor.getEdgeDrawingPreview(editor.mousePosition);
          const endPosition = preview?.snapPosition || editor.mousePosition;

          return (
            <>
              {/* Main preview line */}
              <Line
                points={[
                  [
                    editor.edgeDrawingState.firstPointPosition.x,
                    editor.edgeDrawingState.firstPointPosition.y,
                    editor.edgeDrawingState.firstPointPosition.z,
                  ],
                  [endPosition.x, endPosition.y, endPosition.z],
                ]}
                color="#ffbb00"
                linewidth={2}
                dashed={true}
                dashSize={0.1}
                gapSize={0.1}
                depthTest={false}
                transparent={true}
                renderOrder={20}
              />

              {/* Preview intersections and area splits */}
              {preview && (
                <>
                  {/* Intersection points */}
                  {preview.intersections.map((intersection, index) => (
                    <mesh
                      key={`intersection-${index}`}
                      position={[
                        intersection.intersectionPoint.x,
                        intersection.intersectionPoint.y,
                        intersection.intersectionPoint.z,
                      ]}
                      renderOrder={25}
                    >
                      <sphereGeometry args={[0.08, 16, 16]} />
                      <meshStandardMaterial color="#ff0000" depthTest={false} />
                    </mesh>
                  ))}

                  {/* Snap highlight */}
                  {preview.snapTarget && preview.snapPosition && (
                    <mesh
                      position={[
                        preview.snapPosition.x,
                        preview.snapPosition.y,
                        preview.snapPosition.z,
                      ]}
                      renderOrder={25}
                    >
                      <sphereGeometry args={[0.12, 16, 16]} />
                      <meshStandardMaterial
                        color={
                          preview.snapType === "point" ? "#00ff00" : "#0000ff"
                        }
                        depthTest={false}
                        transparent={true}
                        opacity={0.7}
                      />
                    </mesh>
                  )}
                </>
              )}
            </>
          );
        })()}
      {displayState.showEdges && (
        <group name="edges">
          {Object.entries(editor.crdt.state.edges).map(([edgeId, edge]) => {
            const fromPoint = editor.crdt.state.points[edge.from];
            const toPoint = editor.crdt.state.points[edge.to];

            if (!fromPoint || !toPoint) {
              console.warn(`Missing points for edge ${edgeId}:`, {
                from: edge.from,
                to: edge.to,
              });
              return null;
            }

            const midpoint = new THREE.Vector3(
              (fromPoint.x + toPoint.x) / 2,
              ((fromPoint.y ?? 0) + (toPoint.y ?? 0)) / 2,
              (fromPoint.z + toPoint.z) / 2
            );
            return (
              <group key={edgeId}>
                {/* Invisible wider hit area for delete tool */}
                {editor.currentTool === "deleteEdge" && (
                  <Line
                    points={[
                      [fromPoint.x, fromPoint.y ?? 0, fromPoint.z],
                      [toPoint.x, toPoint.y ?? 0, toPoint.z],
                    ]}
                    linewidth={8}
                    visible={false}
                    renderOrder={9}
                    onClick={(event: React.MouseEvent) => {
                      event.stopPropagation();
                      if (editor.currentTool === "deleteEdge") {
                        editor.deleteEdge(edgeId);
                      }
                    }}
                  />
                )}
                {/* Visual line */}
                <Line
                  points={[
                    [fromPoint.x, fromPoint.y ?? 0, fromPoint.z],
                    [toPoint.x, toPoint.y ?? 0, toPoint.z],
                  ]}
                  color={
                    editor.currentTool === "deleteEdge" ? "#FF0000" : "#AA0000"
                  }
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
                  fontSize={0.08}
                  color="#888888"
                  visible={true}
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
          {Array.from(floorData.adjacencies.entries()).map(
            ([fromPointId, neighbors]) =>
              neighbors.map((toPointId: string, i: number) => {
                const fromPoint = editor.crdt.state.points[fromPointId];
                const toPoint = editor.crdt.state.points[toPointId];

                if (!fromPoint || !toPoint) return null;

                const edgeKey = createEdgeWeightKey(fromPointId, toPointId);
                const connections = floorData.edgeWeights.get(edgeKey);
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
                        path?.map((point) => [
                          point.x,
                          point.y ?? 0,
                          point.z,
                        ]) ?? []
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
          {Array.from(floorData.getAreaMeshes().entries()).map(
            ([areaId, mesh]) => {
              // Check if this area is being split in the current preview
              const isBeingSplit =
                editor.edgeDrawingState.isDrawing &&
                editor.mousePosition &&
                (() => {
                  const preview = editor.getEdgeDrawingPreview(
                    editor.mousePosition
                  );
                  return (
                    preview?.areaSplits.some(
                      (split) => split.areaId === areaId
                    ) || false
                  );
                })();

              return (
                <group key={areaId}>
                  <mesh onPointerOver={() => {}}>
                    <bufferGeometry>
                      <bufferAttribute
                        args={[new Float32Array(mesh.positions), 3]}
                        attach="attributes-position"
                      />
                      <bufferAttribute
                        args={[new Uint16Array(mesh.indices), 1]}
                        attach="attributes-index"
                      />
                    </bufferGeometry>
                    <meshStandardMaterial
                      color={isBeingSplit ? "#ff6600" : "red"}
                      depthTest={false}
                      opacity={0.5}
                      transparent={true}
                    />
                  </mesh>
                </group>
              );
            }
          )}
        </group>
      )}
      {displayState.showLegacyNavmesh && (
        <group>
          {legacyMeshGeometries?.map((geometry, i) => (
            <group key={i}>
              <mesh geometry={geometry} position={[0, 0.01, 0]}>
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
