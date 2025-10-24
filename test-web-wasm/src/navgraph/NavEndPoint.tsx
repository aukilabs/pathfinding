import { DragControls } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export function NavEndPoint({
  color,
  visible,
  position,
  setPosition,
  onContextMenu,
}: {
  color: string;
  visible: boolean;
  position: THREE.Vector3Like;
  setPosition: (position: THREE.Vector3Like) => void;
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
          console.log("onDragEnd called");
          if (ref.current) {
            console.log("ref.current exists, position:", ref.current.position);
            // Use local position instead of world position
            setPosition(ref.current.position.clone());
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
