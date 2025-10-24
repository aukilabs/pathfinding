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

export type FloorMetadata = {
  floors: Floor[];
};

const createInitialFloors = () => [
  { name: "Floor 1", id: uuidv4() },
  { name: "Floor 2", id: uuidv4() },
];

export const useMultiFloorState = create<MultiFloorState>()((set) => ({
  floorData: {
    floors: createInitialFloors(),
  },
  addFloor: (name: string) => {
    console.log("Adding floor:", name);
    set((state) => {
      const newFloors = [...state.floorData.floors, { name, id: uuidv4() }];
      console.log("New floors:", newFloors);
      return {
        floorData: {
          floors: newFloors,
        },
      };
    });
  },
}));
