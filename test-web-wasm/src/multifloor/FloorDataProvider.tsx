import { createContext, useContext, ReactNode } from "react";
import { FloorData } from "@auki/pathfinding";

const FloorDataContext = createContext<FloorData | null>(null);

export function FloorDataProvider({
  children,
  floorData,
}: {
  children: ReactNode;
  floorData: FloorData;
}) {
  return (
    <FloorDataContext.Provider value={floorData}>
      {children}
    </FloorDataContext.Provider>
  );
}

export function useFloorData() {
  const data = useContext(FloorDataContext);
  if (!data) {
    throw new Error(
      "useFloorEditingState must be used within a FloorEditingProvider"
    );
  }
  return data;
}
