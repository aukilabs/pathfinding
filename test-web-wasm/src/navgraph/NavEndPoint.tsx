import { DragControls, Text } from "@react-three/drei";
import { ThreeEvent } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import * as THREE from "three";

export function NavEndPoint({
  color,
  visible,
  position,
  setPosition,
  onContextMenu,
  name,
}: {
  color: string;
  visible: boolean;
  position: THREE.Vector3Like;
  setPosition: (position: THREE.Vector3Like) => void;
  onContextMenu: (event: ThreeEvent<MouseEvent>) => void;
  name: string;
}) {
  const matrix = useRef<THREE.Matrix4>(new THREE.Matrix4());

  useEffect(() => {
    matrix.current.makeTranslation(position.x, position.y, position.z);
  }, [position, visible]);

  return (
    <group visible={visible}>
      <DragControls
        axisLock="y"
        autoTransform={false}
        matrix={matrix.current}
        onDrag={(local) => {
          matrix.current.copy(local);
        }}
        onDragEnd={() => {
          const worldPos = new THREE.Vector3();
          worldPos.setFromMatrixPosition(matrix.current);
          setPosition(worldPos);
        }}
      >
        <group onContextMenu={onContextMenu}>
          <mesh position={[0, 0.5, 0]}>
            <boxGeometry args={[0.5, 1, 0.5]} />
            <meshStandardMaterial color={color} />
          </mesh>
          <Text
            position={[0, 1.25, 0]}
            fontSize={0.25}
            color={"black"}
            rotation={[0, 0, 0]}
          >
            {name}
          </Text>
        </group>
      </DragControls>
    </group>
  );
}
