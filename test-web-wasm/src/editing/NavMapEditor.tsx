// src/editing/NavMapEditor.tsx
import React, { useState, useCallback } from "react";
import { NavMapCRDT } from "./CRDT";

type EditorTool = "select" | "addPoint" | "drawEdge" | "createArea";

interface NavMapEditorProps {
  crdt: NavMapCRDT;
  onCRDTChange: (crdt: NavMapCRDT) => void;
}

export const NavMapEditor: React.FC<NavMapEditorProps> = ({
  crdt,
  onCRDTChange,
}) => {
  const [currentTool, setCurrentTool] = useState<EditorTool>("select");
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [isDragging, setIsDragging] = useState(false);

  const handleCanvasClick = useCallback(
    (event: React.MouseEvent) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;

      switch (currentTool) {
        case "addPoint":
          // Add point at click location
          break;
        case "select":
          // Select item at click location
          break;
        case "drawEdge":
          // Start/continue edge drawing
          break;
        case "createArea":
          // Add point to area selection
          break;
      }
    },
    [currentTool]
  );

  const handleCanvasDrag = useCallback(
    (event: React.MouseEvent) => {
      if (currentTool === "select" && selectedItems.size > 0) {
        // Move selected points
      }
    },
    [currentTool, selectedItems]
  );

  return (
    <div className="nav-map-editor">
      {/* Toolbar */}
      <div className="toolbar">
        <button
          className={currentTool === "select" ? "active" : ""}
          onClick={() => setCurrentTool("select")}
        >
          Select
        </button>
        <button
          className={currentTool === "addPoint" ? "active" : ""}
          onClick={() => setCurrentTool("addPoint")}
        >
          Add Point
        </button>
        <button
          className={currentTool === "drawEdge" ? "active" : ""}
          onClick={() => setCurrentTool("drawEdge")}
        >
          Draw Edge
        </button>
        <button
          className={currentTool === "createArea" ? "active" : ""}
          onClick={() => setCurrentTool("createArea")}
        >
          Create Area
        </button>
      </div>

      {/* Canvas */}
      <div
        className="canvas"
        onClick={handleCanvasClick}
        onMouseDown={() => setIsDragging(true)}
        onMouseUp={() => setIsDragging(false)}
        onMouseMove={handleCanvasDrag}
      >
        {/* Render points, edges, areas */}
        {Object.entries(crdt.state.points).map(([id, point]) => (
          <div
            key={id}
            className={`point ${selectedItems.has(id) ? "selected" : ""}`}
            style={{
              left: point.x * 10 + 400, // Scale and center
              top: point.z * 10 + 300,
            }}
          />
        ))}
      </div>

      {/* Status */}
      <div className="status">
        Tool: {currentTool} | Selected: {selectedItems.size} | Operations:{" "}
        {crdt.operations.length}
      </div>
    </div>
  );
};
