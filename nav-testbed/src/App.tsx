import ThreeCanvas from "./threed/ThreeCanvas";
import NavgraphToolbar from "./navgraph/NavgraphToolbar";

function App() {
  return (
    <div className="w-full h-full">
      <ThreeCanvas />
      <NavgraphToolbar />
    </div>
  );
}

export default App;
