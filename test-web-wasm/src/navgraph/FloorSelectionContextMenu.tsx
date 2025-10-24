import React, { useState, useEffect, useRef } from "react";
import { useMultiFloorState } from "../multifloor/MultifloorState";

interface FloorSelectionContextMenuProps {
  visible: boolean;
  position: { x: number; y: number };
  onFloorSelect: (floorId: string) => void;
  onClose: () => void;
  currentFloorId: string;
}

export function FloorSelectionContextMenu({
  visible,
  position,
  onFloorSelect,
  onClose,
  currentFloorId,
}: FloorSelectionContextMenuProps) {
  const { floorData } = useMultiFloorState();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    if (visible) {
      document.addEventListener("mousedown", handleClickOutside);
      document.addEventListener("keydown", handleEscape);
    }

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [visible, onClose]);

  if (!visible) return null;

  return (
    <div
      ref={menuRef}
      className="fixed bg-white rounded-md shadow-lg border border-gray-200 py-1 z-50"
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      <div className="px-3 py-2 text-sm text-gray-500 border-b border-gray-100">
        Teleport to floor:
      </div>
      {floorData.floors.map((floor) => (
        <button
          key={floor.id}
          className={`w-full px-3 py-2 text-left text-sm hover:bg-gray-100 ${
            floor.id === currentFloorId
              ? "bg-blue-50 text-blue-600"
              : "text-gray-700"
          }`}
          onClick={() => {
            onFloorSelect(floor.id);
            onClose();
          }}
        >
          {floor.name}
        </button>
      ))}
    </div>
  );
}
