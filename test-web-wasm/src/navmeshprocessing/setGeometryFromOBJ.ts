import * as THREE from "three";

export function setGeometryFromOBJ(
  model: { positions: number[]; indices: number[] },
  geometry: THREE.BufferGeometry
) {
  geometry.setAttribute(
    "position",
    new THREE.BufferAttribute(new Float32Array(model.positions), 3)
  );
  geometry.setIndex(
    new THREE.BufferAttribute(new Uint16Array(model.indices), 1)
  );
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}
