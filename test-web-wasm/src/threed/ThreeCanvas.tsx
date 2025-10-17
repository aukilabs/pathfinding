import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { useRef } from "react";

const ThreeCanvas = ({ children }: { children: React.ReactNode }) => {
  const controlsRef = useRef<any>(null);

  return (
    <div className="w-full h-full ">
      <Canvas id="three-canvas" camera={{ position: [0, 5, 10], fov: 50 }}>
        {children}
        <OrbitControls ref={controlsRef} makeDefault enabled={true} />
      </Canvas>
    </div>
  );
};

export default ThreeCanvas;
