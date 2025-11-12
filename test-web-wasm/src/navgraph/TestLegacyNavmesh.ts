import testnavmesh from "../assets/testnavmesh.txt?raw";
import { ParseOBJString } from "../navmeshprocessing/objParser";
import * as THREE from "three";
import { setGeometryFromOBJ } from "../navmeshprocessing/setGeometryFromOBJ";

export function createMeshes() {
  const parsed = ParseOBJString(testnavmesh);
  return parsed;
}
