import { DragControls } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export function NavEndPoint({
  color,
  visible,
  position,
  setPosition,
  floorId,
  setFloorId,
  onContextMenu,
}: {
  color: string;
  visible: boolean;
  position: THREE.Vector3;
  setPosition: (position: THREE.Vector3) => void;
  floorId: string;
  setFloorId: (floorId: string) => void;
  onContextMenu: (event: ThreeEvent<MouseEvent>) => void;
}) {
  const ref = useRef<THREE.Object3D>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.position.set(position.x, position.y, position.z);
    }
  }, [position, visible]);

  return (
    <group visible={visible}>
      <DragControls
        axisLock="y"
        onDragEnd={() => {
          if (ref.current) {
            const worldPos = new THREE.Vector3();
            ref.current.getWorldPosition(worldPos);
            setPosition(worldPos);
          }
        }}
      >
        <group ref={ref} name="start" onContextMenu={onContextMenu}>
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color={color} />
          </mesh>
        </group>
      </DragControls>
    </group>
  );
}
