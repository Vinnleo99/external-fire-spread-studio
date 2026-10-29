import { Project } from "./engine/model";

/** The irregular office example from the method document (openings shifted 1 metre to sit inside a 28 metre façade). */
export function exampleProject(): Project {
  return {
    format: "external-fire-spread-studio-project",
    version: 1,
    name: "Irregular office example",
    engineer: "",
    activeFacadeId: "south",
    facades: [
      {
        id: "south", name: "South elevation", width: 28, height: 10, compartment: "Whole building (not compartmented)",
        fireLoad: "office", boundaryDistance: 3.5, sprinklered: false, sprinklerOption: "halveDistance",
        openings: [
          { id: "o1", type: "window", xMin: 1, xMax: 9, zMin: 0, zMax: 3.5, setback: 0 },
          { id: "o2", type: "window", xMin: 2, xMax: 4, zMin: 4, zMax: 6, setback: 0 },
          { id: "o3", type: "window", xMin: 6, xMax: 8, zMin: 4, zMax: 6, setback: 0 },
          { id: "o4", type: "window", xMin: 11, xMax: 13, zMin: 4, zMax: 6, setback: 0 },
          { id: "o5", type: "window", xMin: 15, xMax: 17, zMin: 4, zMax: 6, setback: 0 },
          { id: "o6", type: "window", xMin: 6, xMax: 8, zMin: 7, zMax: 9, setback: 0 },
          { id: "o7", type: "combustibleCladding", xMin: 19, xMax: 27, zMin: 6, zMax: 9, setback: 0 },
          { id: "o8", type: "door", xMin: 21, xMax: 23, zMin: 0, zMax: 2.5, setback: 1.5 },
        ],
      },
      {
        id: "east", name: "East elevation", width: 12, height: 10, compartment: "Ground floor shop unit",
        fireLoad: "shop", boundaryDistance: 6, sprinklered: true, sprinklerOption: "halveDistance",
        openings: [
          { id: "e1", type: "window", xMin: 1, xMax: 5, zMin: 0.5, zMax: 3.5, setback: 0 },
          { id: "e2", type: "door", xMin: 7, xMax: 9, zMin: 0, zMax: 2.4, setback: 0 },
          { id: "e3", type: "nonFireResistingWall", xMin: 9.5, xMax: 11, zMin: 0, zMax: 3.5, setback: 0 },
        ],
      },
    ],
  };
}

export function blankProject(): Project {
  return {
    format: "external-fire-spread-studio-project", version: 1, name: "New project", engineer: "", activeFacadeId: "f1",
    facades: [{ id: "f1", name: "Elevation 1", width: 20, height: 9, compartment: "Compartment 1", fireLoad: "residential",
      boundaryDistance: 3, sprinklered: false, sprinklerOption: "halveDistance", openings: [] }],
  };
}
