import testnavmesh from "../assets/testnavmesh.txt?raw";
import { ParseOBJString } from "../navmeshprocessing/objParser";
import * as THREE from "three";
import { setGeometryFromOBJ } from "../navmeshprocessing/setGeometryFromOBJ";

export function createMeshes() {
  const parsed = ParseOBJString(testnavmesh);
  const meshes = parsed.map((model) => {
    const geometry = new THREE.BufferGeometry();
    setGeometryFromOBJ(model, geometry);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry);
    mesh.name = model.name;
    return mesh;
  });

  return meshes;
}
