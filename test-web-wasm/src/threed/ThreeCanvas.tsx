import { Canvas } from "@react-three/fiber";

const ThreeCanvas = ({ children }: { children: React.ReactNode }) => {
  return (
    <div className="w-full h-full ">
      <Canvas id="three-canvas" camera={{ position: [0, 5, 10], fov: 50 }}>
        {children}
      </Canvas>
    </div>
  );
};

export default ThreeCanvas;
