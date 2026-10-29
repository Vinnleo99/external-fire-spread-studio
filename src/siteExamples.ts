/** Example site projects. */
import { Facade } from "./engine/model";
import { DEFAULT_SETTINGS, SiteOpening, SiteProject, wallId } from "./engine/site";
import { exampleProject } from "./example";

/** A single flat façade as a block on a site, with a straight boundary parallel to it at the façade's boundary distance. */
export function siteFromFacade(f: Facade, depth = 12, name?: string): SiteProject {
  const blockId = "b1";
  const d = f.boundaryDistance ?? 3;
  return {
    format: "external-fire-spread-studio-site", version: 2,
    name: name ?? `${f.name} on a site`, engineer: "",
    compartments: [{ id: "c1", name: f.compartment || "Compartment 1", fireLoad: f.fireLoad }],
    blocks: [{ id: blockId, name: "Building", footprint: [[0, 0], [f.width, 0], [f.width, depth], [0, depth]],
      base: 0, storeys: 1, storeyHeight: f.height, compartmentId: "c1" }],
    openings: f.openings.map((o): SiteOpening => ({ ...o, wallId: wallId(blockId, 0) })),
    boundaries: [{ id: "bd1", name: "Relevant boundary", kind: "relevant", points: [[-10, -d], [f.width + 10, -d]] }],
    settings: { ...DEFAULT_SETTINGS, sprinklered: !!f.sprinklered, sprinklerOption: f.sprinklerOption ?? "halveDistance" },
    activeBlockId: blockId, activeWallId: wallId(blockId, 0), activeBoundaryId: "bd1",
  };
}

export function siteExampleOffice(): SiteProject {
  const f = exampleProject().facades[0];
  return siteFromFacade(f, 12, "Example 1: irregular office façade");
}

export function siteExamplePodium(): SiteProject {
  const w = (b: string, e: number) => wallId(b, e);
  let n = 0;
  const op = (wall: string, type: SiteOpening["type"], xMin: number, xMax: number, zMin: number, zMax: number, setback = 0): SiteOpening =>
    ({ id: `s${++n}`, wallId: wall, type, xMin, xMax, zMin, zMax, setback });
  const openings: SiteOpening[] = [
    // Podium shops, south wall: two shopfronts and first-floor windows.
    op(w("podium", 0), "window", 3, 9, 0.5, 3.5), op(w("podium", 0), "window", 20, 26, 0.5, 3.5),
    op(w("podium", 0), "door", 13, 15, 0, 2.5, 1),
    ...[3, 10, 20, 27].map((x) => op(w("podium", 0), "window", x, x + 2, 5.5, 7)),
    // Podium, east wall.
    op(w("podium", 1), "window", 4, 8, 0.5, 3.5),
    // Level 2 offices, set back 6 metres.
    ...[2, 7, 12, 17, 22, 27].map((x) => op(w("level2", 0), "window", x, x + 3, 0.9, 2.7)),
    ...[2, 8].map((x) => op(w("level2", 1), "window", x, x + 3, 0.9, 2.7)),
    // Levels 3 and 4 offices, set back 10 metres, with a band of combustible cladding.
    ...[2, 7.5, 13.5, 19].flatMap((x) => [op(w("level34", 0), "window", x, x + 3, 0.9, 2.7), op(w("level34", 0), "window", x, x + 3, 4.4, 6.2)]),
    op(w("level34", 0), "combustibleCladding", 0, 24, 6.4, 7),
  ];
  return {
    format: "external-fire-spread-studio-site", version: 2,
    name: "Example 2: podium with set-back upper floors", engineer: "",
    compartments: [
      { id: "c-podium", name: "Podium shops", fireLoad: "shop" },
      { id: "c-level2", name: "Level 2 offices", fireLoad: "office" },
      { id: "c-level34", name: "Levels 3 and 4 offices", fireLoad: "office" },
    ],
    blocks: [
      { id: "podium", name: "Podium", footprint: [[0, 0], [32, 0], [32, 20], [0, 20]], base: 0, storeys: 2, storeyHeight: 4.5, compartmentId: "c-podium" },
      { id: "level2", name: "Level 2", footprint: [[0, 6], [32, 6], [32, 20], [0, 20]], base: 9, storeys: 1, storeyHeight: 3.5, compartmentId: "c-level2" },
      { id: "level34", name: "Levels 3 and 4", footprint: [[4, 10], [28, 10], [28, 20], [4, 20]], base: 12.5, storeys: 2, storeyHeight: 3.5, compartmentId: "c-level34" },
    ],
    openings,
    boundaries: [
      { id: "south", name: "Site boundary (south)", kind: "relevant", points: [[-6, -5], [14, -3.5], [24, -7], [40, -7]] },
      { id: "east", name: "Notional boundary (east)", kind: "notional", points: [[38, -6], [38, 26]] },
    ],
    settings: { ...DEFAULT_SETTINGS },
    activeBlockId: "podium", activeWallId: w("podium", 0), activeBoundaryId: "south",
  };
}

export function blankSite(): SiteProject {
  return {
    format: "external-fire-spread-studio-site", version: 2, name: "New site", engineer: "",
    compartments: [{ id: "c1", name: "Compartment 1", fireLoad: "office" }],
    blocks: [{ id: "b1", name: "Block 1", footprint: [[0, 0], [20, 0], [20, 12], [0, 12]], base: 0, storeys: 3, storeyHeight: 3.5, compartmentId: "c1" }],
    openings: [],
    boundaries: [{ id: "bd1", name: "Relevant boundary", kind: "relevant", points: [[-8, -6], [28, -6]] }],
    settings: { ...DEFAULT_SETTINGS },
    activeBlockId: "b1", activeWallId: "b1:0", activeBoundaryId: "bd1",
  };
}
