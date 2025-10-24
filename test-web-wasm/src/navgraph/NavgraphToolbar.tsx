import {
  Button,
  ListBox,
  ListBoxItem,
  MenuTrigger,
  Popover,
} from "react-aria-components";
import EyeIcon from "../assets/eye.svg?react";
import GotuSwitch from "../ui/GotuSwitch";
import { useNavgraphDisplayState } from "./NavgraphDisplayState";
import { useFloorEditingState } from "../multifloor/FloorEditingProvider";

export default function NavgraphToolbar() {
  const state = useNavgraphDisplayState();
  const editingState = useFloorEditingState();

  const tools = [
    {
      label: "Select",
      tool: "select",
    },
    {
      label: "Add Point",
      tool: "addPoint",
    },
    {
      label: "Draw Edge",
      tool: "drawEdge",
    },
    {
      label: "Fill Area",
      tool: "fillArea",
    },
    {
      label: "Delete Edge",
      tool: "deleteEdge",
    },
  ] as const;

  return (
    <>
      <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2 flex gap-1">
        <div className="bg-white rounded-md shadow-gotu border border-gray-300 p-1 flex flex-row gap-1 items-center">
          <MenuTrigger aria-label="Visibility">
            <Button
              className="text-gotu-disabled enabled:text-[#101010] enabled:cursor-pointer p-1"
              aria-label="Toggle visibility options"
            >
              <EyeIcon />
            </Button>
            <Popover placement="top start">
              <ListBox
                className="bg-white rounded-md shadow-gotu border border-gray-200 p-1 gap-2.5 flex flex-col-reverse mb-2"
                aria-label="Visibility Options"
              >
                <ListBoxItem textValue="Show Edges">
                  <GotuSwitch
                    isSelected={state.showEdges}
                    onChange={() => {
                      state.setShowEdges(!state.showEdges);
                    }}
                    ariaLabel="Toggle show edges"
                  >
                    Show Edges
                  </GotuSwitch>
                </ListBoxItem>
                <ListBoxItem textValue="Show Points">
                  <GotuSwitch
                    isSelected={state.showPoints}
                    onChange={() => {
                      state.setShowPoints(!state.showPoints);
                    }}
                    ariaLabel="Toggle show points"
                  >
                    Show Points
                  </GotuSwitch>
                </ListBoxItem>
                <ListBoxItem textValue="Show Path">
                  <GotuSwitch
                    isSelected={state.showPath}
                    onChange={() => {
                      state.setShowPath(!state.showPath);
                    }}
                    ariaLabel="Toggle show path"
                  >
                    Show Path
                  </GotuSwitch>
                </ListBoxItem>
                <ListBoxItem textValue="Show Areas">
                  <GotuSwitch
                    isSelected={state.showAreas}
                    onChange={() => {
                      state.setShowAreas(!state.showAreas);
                    }}
                    ariaLabel="Toggle show areas"
                  >
                    Show Areas
                  </GotuSwitch>
                </ListBoxItem>
                <ListBoxItem textValue="Show Navmesh">
                  <GotuSwitch
                    isSelected={state.showNavmesh}
                    onChange={() => {
                      state.setShowNavmesh(!state.showNavmesh);
                    }}
                    ariaLabel="Toggle show navmesh"
                  >
                    Show Navmesh
                  </GotuSwitch>
                </ListBoxItem>
                <ListBoxItem textValue="Show Adjacency List">
                  <GotuSwitch
                    isSelected={state.showAdjacencyList}
                    onChange={() => {
                      state.setShowAdjacencyList(!state.showAdjacencyList);
                    }}
                    ariaLabel="Toggle show adjacency list"
                  >
                    Show Adjacency List
                  </GotuSwitch>
                </ListBoxItem>
                <ListBoxItem textValue="Show Legacy Navmesh">
                  <GotuSwitch
                    isSelected={state.showLegacyNavmesh}
                    onChange={() => {
                      state.setShowLegacyNavmesh(!state.showLegacyNavmesh);
                    }}
                    ariaLabel="Toggle show legacy navmesh"
                  >
                    Show Legacy Navmesh
                  </GotuSwitch>
                </ListBoxItem>
              </ListBox>
            </Popover>
          </MenuTrigger>
          <div className="bg-white rounded-md shadow-gotu border border-gray-300 p-1 flex flex-row gap-1 items-center">
            {tools.map((tool) => (
              <Button
                key={tool.tool}
                className={`px-2 py-1 text-xs rounded ${
                  editingState.currentTool === tool.tool
                    ? "bg-blue-500 text-white"
                    : "bg-gray-200"
                }`}
                onPress={() => editingState.setCurrentTool(tool.tool)}
              >
                {tool.label}
              </Button>
            ))}
          </div>
          <div className="bg-white rounded-md shadow-gotu border border-gray-300 p-1 flex flex-row gap-1 items-center">
            <Button
              className="px-2 py-1 text-xs rounded bg-gray-200 disabled:opacity-50"
              onPress={() => editingState.undo()}
              isDisabled={editingState.crdt.operations.length === 0}
            >
              Undo
            </Button>
            <Button
              className="px-2 py-1 text-xs rounded bg-gray-200 disabled:opacity-50"
              onPress={() => editingState.redo()}
              isDisabled={editingState.crdt.redoStack.length === 0}
            >
              Redo
            </Button>
          </div>
          {/* <MenuTrigger>
            <Button className="bg-white rounded-10 shadow-gotu border border-gray-300 p-2.5 flex flex-row gap-2.5 items-center">
              Preferences
            </Button>
            <Popover className="bg-white rounded-10 shadow-gotu border border-gray-300 p-2.5">
              <ListBox aria-label="User preferences"></ListBox>
            </Popover>
          </MenuTrigger> */}
        </div>
      </div>
    </>
  );
}
