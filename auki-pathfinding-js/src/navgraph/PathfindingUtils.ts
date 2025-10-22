import * as THREE from "three";
import {
  PathResult,
  EdgePathResult,
  LegacyPathResult,
  AreaGroupPathResult,
} from "./NavgraphTypes";

export function chooseClosestResult(
  edgeResult: {
    position: THREE.Vector3Like;
    edgeId: string;
    fromPointId: string;
    toPointId: string;
    distance: number;
  } | null,
  legacyResult: {
    position: THREE.Vector3Like;
    distance: number;
  } | null
): PathResult | null {
  if (!edgeResult && !legacyResult) return null;
  if (!edgeResult) return convertLegacyToPathResult(legacyResult);
  if (!legacyResult) return convertEdgeToPathResult(edgeResult);

  // Choose the one with smaller distance
  return legacyResult.distance < edgeResult.distance
    ? convertLegacyToPathResult(legacyResult)
    : convertEdgeToPathResult(edgeResult);
}

export function convertAreaGroupToPathResult(
  areaGroupId: string,
  position: THREE.Vector3Like
): AreaGroupPathResult {
  return {
    type: "areaGroup",
    position: position,
    areaGroupId: areaGroupId,
    distance: 0,
  };
}

function convertLegacyToPathResult(legacyResult: any): LegacyPathResult {
  return {
    type: "legacy",
    position: legacyResult.position,
    distance: legacyResult.distance,
  };
}

function convertEdgeToPathResult(edgeResult: any): EdgePathResult {
  return {
    type: "edge",
    position: edgeResult.position,
    edgeId: edgeResult.edgeId,
    fromPointId: edgeResult.fromPointId,
    toPointId: edgeResult.toPointId,
    distance: edgeResult.distance,
  };
}

export function reconstructPath(
  previous: Map<string, string | null>,
  from: string,
  to: string
): string[] | null {
  const path: string[] = [];
  let current = to;

  while (current && current !== "") {
    path.unshift(current);
    current = previous.get(current) || "";
  }

  return path[0] === from ? path : null;
}
