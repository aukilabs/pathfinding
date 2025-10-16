import * as THREE from "three";
import { ParsedOBJModel } from "./objParser";

export function setGeometryFromOBJ(
  model: ParsedOBJModel,
  geometry: THREE.BufferGeometry
) {
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(model.vertices, 3)
  );
  geometry.setIndex(new THREE.BufferAttribute(model.indices, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
