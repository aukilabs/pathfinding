import { NavMap } from "@auki/pathfinding";
import { NavMapCRDT } from "../editing/CRDT";
import { FloorMetadata } from "./MultifloorState";

export function getFloorItemKey(floorId: string, itemId: string) {
  return `${floorId}/${itemId}`;
}

export function mergeFloorMaps(
  floorData: FloorMetadata,
  floorCRDTs: Record<string, NavMapCRDT>
) {
  const mergedNav: NavMap = {
    points: {},
    edges: {},
    areas: {},
  };
  floorData.floors.forEach((floor) => {
    const floorCRDT = floorCRDTs[floor.id];
    if (!floorCRDT) {
      console.warn(`Floor CRDT not found for floor ${floor.id}`);
      return;
    }

    Object.entries(floorCRDT.state.points).forEach(([pointId, point]) => {
      const key = getFloorItemKey(floor.id, pointId);
      mergedNav.points[key] = point;
    });

    Object.entries(floorCRDT.state.edges).forEach(([edgeId, edge]) => {
      const key = getFloorItemKey(floor.id, edgeId);
      mergedNav.edges[key] = {
        ...edge,
        from: getFloorItemKey(floor.id, edge.from),
        to: getFloorItemKey(floor.id, edge.to),
      };
    });

    Object.entries(floorCRDT.state.areas).forEach(([areaId, area]) => {
      const key = getFloorItemKey(floor.id, areaId);
      mergedNav.areas[key] = {
        ...area,
        edges: area.edges.map((edgeId) => getFloorItemKey(floor.id, edgeId)),
      };
    });
  });

  //add inter-floor links
  floorData.links.forEach((link, index) => {
    const fromKey = getFloorItemKey(link.fromFloorId, link.fromPointId);
    const toKey = getFloorItemKey(link.toFloorId, link.toPointId);

    // Create unique edge ID for inter-floor links
    const linkEdgeId = `link_${link.fromFloorId}_${link.fromPointId}_to_${link.toFloorId}_${link.toPointId}`;

    mergedNav.edges[linkEdgeId] = {
      from: fromKey,
      to: toKey,
      weightMultiplier: 0,
      dir: link.direction,
    };
  });

  return mergedNav;
}
