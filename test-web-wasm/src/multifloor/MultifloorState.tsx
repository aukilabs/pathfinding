import { EdgeDirection } from "auki-pathfinding";
import * as React from "react";
import * as THREE from "three";
import { v4 as uuidv4 } from "uuid";
import { create } from "zustand";

type MultiFloorState = {
  readonly floorData: FloorMetadata;
  readonly addFloor: (name: string) => void;
};

export type Floor = {
  name: string;
  id: string;
};

export type Link = {
  fromFloorId: string;
  toFloorId: string;
  fromPointId: string;
  toPointId: string;
  weight: number;
  direction: EdgeDirection;
};

export type FloorMetadata = {
  floors: Floor[];
  links: Link[];
};

export const useMultiFloorState = create<MultiFloorState>()((set) => ({
  floorData: {
    floors: [
      { name: "Floor 1", id: "f1" },
      { name: "Floor 2", id: "f2" },
    ],
    links: [
      {
        fromFloorId: "f1",
        toFloorId: "f2",
        fromPointId: "p42",
        toPointId: "pInside",
        weight: 5,
        direction: 0,
      },
    ],
  },
  addFloor: (name: string) => {
    console.log("Adding floor:", name);
    set((state) => {
      const newFloors = [...state.floorData.floors, { name, id: uuidv4() }];
      console.log("New floors:", newFloors);
      return {
        floorData: {
          ...state.floorData,
          floors: newFloors,
        },
      };
    });
  },
}));
