import {
  Canvas,
  events,
  type RootState,
  type RootStore,
} from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Suspense, useCallback, useRef } from "react";
import * as THREE from "three";
import Scene from "./Scene";

const ThreeCanvas = () => {
  const controlsRef = useRef<any>(null);

  return (
    <div className="w-full h-full bg-red-500">
      <Canvas
        id="three-canvas"
        camera={{ position: [0, 5, 10], fov: 50 }}
        onPointerMissed={(e) => {}}
      >
        <Suspense fallback={null}>
          <Scene />
        </Suspense>
        <OrbitControls ref={controlsRef} makeDefault enabled={true} />
      </Canvas>
    </div>
  );
};

export default ThreeCanvas;
