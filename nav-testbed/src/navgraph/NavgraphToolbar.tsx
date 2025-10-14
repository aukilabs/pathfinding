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

export default function NavgraphToolbar({}: {}) {
  const state = useNavgraphDisplayState();

  return (
    <>
      <div className="absolute bottom-5 left-1/2 transform -translate-x-1/2 flex gap-2.5">
        <div className="bg-white rounded-10 shadow-gotu border border-gray-300 p-2.5 flex flex-row gap-2.5 items-center">
          <MenuTrigger aria-label="Visibility">
            <Button
              className="text-gotu-disabled enabled:text-[#101010] enabled:cursor-pointer p-2"
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
              </ListBox>
            </Popover>
          </MenuTrigger>
        </div>
      </div>
    </>
  );
}
