import ComputeWorker from "../worker?worker&inline";
import { PARAGRAPH_13_8 } from "../engine/siteChecks";
import { FacadeResults, facadeKey } from "../compute";
import {
  ACCEPTANCE_LIMIT, FIRE_LOAD_LABELS, FireLoadCategory, Facade, OPENING_TYPES, Opening, OpeningType, Project,
  openingArea, fmtDown, fmtUp, openingFraction, openingOverlaps, sourceIntensity,
} from "../engine/model";
import { blankProject, exampleProject } from "../example";
import { drawElevationStatic, drawHeatMap, drawLegend, drawProfile } from "../ui/charts";
import { OPENING_STYLE, PALETTE } from "../ui/colours";
import { ElevationEditor } from "../ui/elevation";
import { renderReport } from "../ui/report";
import { VIEW_LEGEND, View3D } from "../ui/view3d";

type View = "model" | "view3d" | "report";
const STORAGE_KEY = "external-fire-spread-studio-project";

let project: Project = loadInitialProject();
let selectedId: string | null = null;
let tool: OpeningType = "window";
let view: View = "model";
const results = new Map<string, FacadeResults>();
let view3d: View3D | null = null;
let computeTimer: number | undefined;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function loadInitialProject(): Project {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored) as Project;
      if (parsed.format === "external-fire-spread-studio-project" && parsed.facades?.length) return parsed;
    }
  } catch { /* storage unavailable */ }
  return exampleProject();
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch { /* storage unavailable */ }
}

function activeFacade(): Facade {
  return project.facades.find((f) => f.id === project.activeFacadeId) ?? project.facades[0];
}

function newId(prefix = "o"): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

const fmt = (v: number, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "not applicable");

// ---------------------------------------------------------------- calculation worker
const worker = new ComputeWorker();
const inflight = new Map<number, { facadeId: string; key: string }>();
let nextRequest = 1;

function requestCompute(facade: Facade) {
  const key = facadeKey(facade);
  if (results.get(facade.id)?.key === key) return;
  for (const v of inflight.values()) if (v.facadeId === facade.id && v.key === key) return;
  const requestId = nextRequest++;
  inflight.set(requestId, { facadeId: facade.id, key });
  worker.postMessage({ requestId, facade: JSON.parse(JSON.stringify(facade)) });
  renderStatus();
}

worker.onmessage = (event: MessageEvent<{ requestId: number; results?: FacadeResults; error?: string }>) => {
  const { requestId, results: res, error } = event.data;
  inflight.delete(requestId);
  if (error || !res) {
    console.warn("Calculation failed:", error);
  } else {
    const facade = project.facades.find((f) => f.id === res.facadeId);
    if (facade && facadeKey(facade) === res.key) {
      results.set(facade.id, res);
      if (facade.id === activeFacade().id) renderResults();
      if (view === "view3d" && facade.id === activeFacade().id) updateView3D();
      if (view === "report") showReport();
    }
  }
  renderStatus();
};

worker.onerror = (event) => {
  console.warn("The calculation worker failed to start:", event.message);
};

function scheduleCompute(delay = 250) {
  window.clearTimeout(computeTimer);
  computeTimer = window.setTimeout(() => {
    requestCompute(activeFacade());
    if (view === "report") project.facades.forEach(requestCompute);
  }, delay);
  renderStatus(true);
}

function isCalculating(): boolean {
  const current = results.get(activeFacade().id);
  return !current || current.key !== facadeKey(activeFacade());
}

function renderStatus(force = false) {
  const el = document.querySelector<HTMLElement>("#status");
  if (!el) return;
  el.innerHTML = force || isCalculating() || inflight.size
    ? `<span class="badge working">Calculating</span>`
    : `<span class="badge pass">Up to date</span>`;
}

// ---------------------------------------------------------------- shell (inside the "Simple elevation" tab)
const app = document.querySelector<HTMLDivElement>("#simple-root")!;
app.innerHTML = `
  <div class="subnav">
    <nav id="simple-nav" aria-label="Simple elevation views">
      <button data-view="model" aria-current="page">Elevation and results</button>
      <button data-view="view3d">Three-dimensional view</button>
      <button data-view="report">Report</button>
    </nav>
    <div class="subnav-actions">
      <span class="hint" style="margin:0">The original single-façade method: one flat elevation and a parallel boundary.</span>
      <button class="button secondary small" id="simple-load-example">Load example</button>
    </div>
  </div>
  <section id="model-view" class="layout"></section>
  <section id="view3d-view" class="layout" hidden></section>
  <section id="report-view" hidden style="padding:1rem 1.25rem 2rem"></section>`;

document.querySelectorAll<HTMLButtonElement>("#simple-nav button").forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.view as View)));
document.querySelector("#simple-load-example")!.addEventListener("click", () => {
  if (!confirm("Replace the simple elevation project with the irregular office example?")) return;
  replaceProject(exampleProject());
});

export function replaceProject(p: Project) {
  project = p;
  if (!project.facades.find((f) => f.id === project.activeFacadeId)) project.activeFacadeId = project.facades[0].id;
  selectedId = null;
  results.clear();
  save();
  renderModel();
  if (view === "view3d") renderView3DShell();
  if (view === "report") showReport();
  scheduleCompute(0);
}

export function setView(next: View) {
  view = next;
  document.querySelectorAll<HTMLButtonElement>("#simple-nav button").forEach((b) =>
    b.toggleAttribute("aria-current", b.dataset.view === next));
  document.querySelectorAll<HTMLButtonElement>("#simple-nav button").forEach((b) => {
    if (b.dataset.view === next) b.setAttribute("aria-current", "page");
  });
  (document.querySelector("#model-view") as HTMLElement).hidden = next !== "model";
  (document.querySelector("#view3d-view") as HTMLElement).hidden = next !== "view3d";
  (document.querySelector("#report-view") as HTMLElement).hidden = next !== "report";
  if (next === "model") { renderModel(); }
  if (next === "view3d") renderView3DShell();
  if (next === "report") { project.facades.forEach(requestCompute); showReport(); }
}

// ---------------------------------------------------------------- model view
let editor: ElevationEditor | null = null;

function renderModel() {
  const root = document.querySelector<HTMLElement>("#model-view")!;
  const f = activeFacade();
  root.innerHTML = `
    <aside>
      <div class="panel">
        <h2>Project</h2>
        <div class="field"><label for="project-name">Project name</label><input id="project-name" value="${escapeHtml(project.name)}" /></div>
        <div class="field"><label for="engineer">Prepared by</label><input id="engineer" value="${escapeHtml(project.engineer ?? "")}" placeholder="Name of the engineer" /></div>
      </div>
      <div class="panel">
        <h2>Façades</h2>
        <div class="facade-tabs">${project.facades.map((x) => `
          <button data-facade="${x.id}" aria-current="${x.id === f.id}">${escapeHtml(x.name)}<small>${escapeHtml(x.compartment)}</small></button>`).join("")}
        </div>
        <div style="display:flex;gap:.4rem;flex-wrap:wrap">
          <button class="button secondary small" id="add-facade">Add façade</button>
          <button class="button secondary small" id="duplicate-facade">Duplicate</button>
          <button class="button ghost small danger" id="delete-facade" ${project.facades.length < 2 ? "disabled" : ""}>Delete</button>
        </div>
      </div>
      <div class="panel">
        <h2>Façade settings</h2>
        <div class="field"><label for="facade-name">Façade name</label><input id="facade-name" value="${escapeHtml(f.name)}" /></div>
        <div class="row">
          <div class="field"><label for="facade-width">Width (metres)</label><input id="facade-width" type="number" min="1" step="0.1" value="${f.width}" /></div>
          <div class="field"><label for="facade-height">Height (metres)</label><input id="facade-height" type="number" min="1" step="0.1" value="${f.height}" /></div>
        </div>
        <div class="field"><label for="compartment">Fire compartment</label><input id="compartment" value="${escapeHtml(f.compartment)}" /></div>
        <div class="field field-full"><label for="fire-load">Purpose group and fire load</label>
          <select id="fire-load">${(Object.keys(FIRE_LOAD_LABELS) as FireLoadCategory[]).map((k) =>
            `<option value="${k}" ${k === f.fireLoad ? "selected" : ""}>${FIRE_LOAD_LABELS[k].replace(/ \(.*\)$/, "")}</option>`).join("")}</select>
          <p class="hint" id="fire-load-hint">Heat release rate: ${escapeHtml((FIRE_LOAD_LABELS[f.fireLoad].match(/\((.*)\)/) ?? ["", ""])[1])}.</p></div>
        <div class="field"><label for="boundary-distance">Boundary distance (metres)</label>
          <input id="boundary-distance" type="number" min="0.1" step="0.1" value="${f.boundaryDistance ?? 1}" /></div>
        <label class="check"><input type="checkbox" id="sprinklered" ${f.sprinklered ? "checked" : ""}/> Fitted throughout with sprinklers</label>
        <div id="sprinkler-options" ${f.sprinklered ? "" : "hidden"}>
          <label class="check"><input type="radio" name="sprinkler-option" value="halveDistance" ${f.sprinklerOption !== "doubleArea" ? "checked" : ""}/> Halve the boundary distance (minimum 1 metre)</label>
          <label class="check"><input type="radio" name="sprinkler-option" value="doubleArea" ${f.sprinklerOption === "doubleArea" ? "checked" : ""}/> Double the permitted unprotected area</label>
          <p class="hint">Approved Document B, Volume 2, paragraph 13.22. The two allowances are alternatives.</p>
        </div>
      </div>
    </aside>
    <div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem">
          <h2 style="margin:0">Elevation: ${escapeHtml(f.name)}</h2>
          <div id="status" class="status"></div>
        </div>
        <div class="tools" role="toolbar" aria-label="Opening type to draw">
          ${(Object.keys(OPENING_TYPES) as OpeningType[]).map((t) => `<button data-tool="${t}" aria-pressed="${t === tool}">
            <span class="swatch" style="background:${OPENING_STYLE[t].fill};border-color:${OPENING_STYLE[t].stroke}"></span>${OPENING_TYPES[t].label}${t === "combustibleCladding" ? " (half its area)" : ""}</button>`).join("")}
        </div>
        <p class="hint">Click and drag on the elevation to draw an opening of the chosen type. Drag an opening to move it, drag a corner to resize it, and press Delete, or use the Delete button in the openings table, to remove the selected opening. Positions snap to 0.1 metres. Dashed outlines are set back behind the face of the wall.</p>
        <div class="editor-wrap"><canvas class="editor" id="editor"></canvas></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.9rem">
          <h3>Openings</h3>
          <button class="button primary small" id="add-opening">Add opening</button>
        </div>
        <div id="openings-table"></div>
      </div>
      <div class="panel">
        <h2>Results</h2>
        <div id="results"></div>
      </div>
      <div class="panel">
        <h2>Received intensity on the receiving plane</h2>
        <p class="hint" id="heat-caption"></p>
        <canvas class="chart" id="heat-map"></canvas>
        <canvas class="chart" id="heat-legend"></canvas>
      </div>
      <div class="panel">
        <h2>Required boundary distance along the boundary</h2>
        <div class="legend">
          <span><i style="background:${PALETTE.blue};height:3px"></i>Each opening calculated separately</span>
          <span><i style="background:${PALETTE.lime};height:3px"></i>Single enclosing rectangle</span>
          <span><i style="border-top:3px dotted ${PALETTE.navy}"></i>Entered boundary distance</span>
          <span><i style="background:rgba(204,31,29,.25);height:.8rem"></i>Requirement exceeds the entered distance</span>
        </div>
        <canvas class="chart" id="profile"></canvas>
        <p class="hint">At each position along the boundary, the smallest boundary distance at which no point on a vertical line of the receiving plane exceeds 12.6 kilowatts per square metre. Sprinkler allowances are not applied to this curve.</p>
      </div>
    </div>`;

  // project and façade fields
  bind("#project-name", (v) => { project.name = v; }, false);
  bind("#engineer", (v) => { project.engineer = v; }, false);
  bind("#facade-name", (v) => { f.name = v; refreshFacadeTabs(); }, false);
  bind("#compartment", (v) => { f.compartment = v; refreshFacadeTabs(); }, false);
  bindNumber("#facade-width", (v) => { f.width = Math.max(1, v); editor?.resize(editorWidth()); });
  bindNumber("#facade-height", (v) => { f.height = Math.max(1, v); editor?.resize(editorWidth()); });
  bindNumber("#boundary-distance", (v) => { f.boundaryDistance = Math.max(0.1, v); });
  document.querySelector<HTMLSelectElement>("#fire-load")!.addEventListener("change", (e) => {
    f.fireLoad = (e.target as HTMLSelectElement).value as FireLoadCategory;
    document.querySelector("#fire-load-hint")!.textContent = `Heat release rate: ${(FIRE_LOAD_LABELS[f.fireLoad].match(/\((.*)\)/) ?? ["", ""])[1]}.`;
    changed();
  });
  document.querySelector<HTMLInputElement>("#sprinklered")!.addEventListener("change", (e) => {
    f.sprinklered = (e.target as HTMLInputElement).checked;
    (document.querySelector("#sprinkler-options") as HTMLElement).hidden = !f.sprinklered;
    changed();
  });
  document.querySelectorAll<HTMLInputElement>('#model-view input[name="sprinkler-option"]').forEach((r) =>
    r.addEventListener("change", () => { f.sprinklerOption = r.value as "halveDistance" | "doubleArea"; changed(); }));
  document.querySelectorAll<HTMLButtonElement>("#model-view [data-facade]").forEach((b) => b.addEventListener("click", () => {
    project.activeFacadeId = b.dataset.facade!; selectedId = null; save(); renderModel(); scheduleCompute(0);
  }));
  document.querySelector("#add-facade")!.addEventListener("click", () => {
    const id = newId("f");
    project.facades.push({ id, name: `Elevation ${project.facades.length + 1}`, width: 20, height: 9, compartment: "Compartment 1",
      fireLoad: f.fireLoad, boundaryDistance: 3, sprinklered: false, sprinklerOption: "halveDistance", openings: [] });
    project.activeFacadeId = id; selectedId = null; save(); renderModel(); scheduleCompute(0);
  });
  document.querySelector("#duplicate-facade")!.addEventListener("click", () => {
    const copy: Facade = JSON.parse(JSON.stringify(f));
    copy.id = newId("f"); copy.name = `${f.name} (copy)`;
    copy.openings.forEach((o) => { o.id = newId(); });
    project.facades.push(copy);
    project.activeFacadeId = copy.id; selectedId = null; save(); renderModel(); scheduleCompute(0);
  });
  document.querySelector("#delete-facade")!.addEventListener("click", () => {
    if (project.facades.length < 2 || !confirm(`Delete the façade "${f.name}"?`)) return;
    project.facades = project.facades.filter((x) => x.id !== f.id);
    project.activeFacadeId = project.facades[0].id; selectedId = null; save(); renderModel(); scheduleCompute(0);
  });
  document.querySelectorAll<HTMLButtonElement>("#model-view [data-tool]").forEach((b) => b.addEventListener("click", () => {
    tool = b.dataset.tool as OpeningType;
    document.querySelectorAll<HTMLButtonElement>("#model-view [data-tool]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const selected = f.openings.find((o) => o.id === selectedId);
    if (selected) { selected.type = tool; renderOpeningsTable(); editor?.draw(); changed(); }
  }));
  document.querySelector("#add-opening")!.addEventListener("click", () => {
    const w = Math.min(2, f.width), h = Math.min(2, f.height);
    const opening: Opening = { id: newId(), type: tool, xMin: 0, xMax: w, zMin: Math.min(1, f.height - h), zMax: Math.min(1, f.height - h) + h, setback: 0 };
    // find a free spot on a 0.5 metre grid
    outer: for (let z = 1; z + h <= f.height; z += 0.5) for (let x = 0.5; x + w <= f.width; x += 0.5) {
      if (!f.openings.some((o) => x < o.xMax && x + w > o.xMin && z < o.zMax && z + h > o.zMin)) {
        Object.assign(opening, { xMin: x, xMax: x + w, zMin: z, zMax: z + h }); break outer;
      }
    }
    f.openings.push(opening); selectedId = opening.id; renderOpeningsTable(); editor?.draw(); changed();
  });

  editor = new ElevationEditor(document.querySelector<HTMLCanvasElement>("#editor")!, {
    getFacade: activeFacade,
    getTool: () => tool,
    getSelected: () => selectedId,
    select: (id) => { selectedId = id; renderOpeningsTable(); },
    changed: (final) => { renderOpeningsTable(); if (final) changed(); },
    newId: () => newId(),
  });
  editor.resize(editorWidth());
  renderOpeningsTable();
  renderResults();
  renderStatus();
}

function editorWidth(): number {
  const el = document.querySelector<HTMLElement>("#model-view .editor-wrap");
  return Math.max(320, el?.clientWidth ?? 800);
}

function refreshFacadeTabs() {
  document.querySelectorAll<HTMLButtonElement>("#model-view [data-facade]").forEach((b) => {
    const x = project.facades.find((ff) => ff.id === b.dataset.facade);
    if (x) b.innerHTML = `${escapeHtml(x.name)}<small>${escapeHtml(x.compartment)}</small>`;
  });
}

function bind(selector: string, apply: (v: string) => void, recalculates = true) {
  const el = document.querySelector<HTMLInputElement>(selector)!;
  el.addEventListener("input", () => { apply(el.value); save(); if (recalculates) changed(); });
}

function bindNumber(selector: string, apply: (v: number) => void) {
  const el = document.querySelector<HTMLInputElement>(selector)!;
  el.addEventListener("input", () => {
    const v = parseFloat(el.value);
    if (!Number.isFinite(v)) return;
    apply(v); changed(500);
  });
}

function changed(delay = 250) {
  save();
  editor?.draw();
  scheduleCompute(delay);
}

function renderOpeningsTable() {
  const f = activeFacade();
  const el = document.querySelector<HTMLElement>("#openings-table");
  if (!el) return;
  if (f.openings.length === 0) {
    el.innerHTML = `<p class="hint">No openings yet. Draw one on the elevation or use the button above.</p>`;
    return;
  }
  const active = document.activeElement as HTMLElement | null;
  const focusKey = active?.dataset.key;
  el.innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Type</th><th>Left edge (metres)</th><th>Right edge (metres)</th><th>Bottom (metres)</th><th>Top (metres)</th><th>Set back (metres)</th><th>Area (square metres)</th><th>Unprotected area (square metres)</th><th></th></tr></thead>
    <tbody>${f.openings.map((o) => `
      <tr data-id="${o.id}" aria-selected="${o.id === selectedId}">
        <td><select data-key="${o.id}-type" data-field="type">${(Object.keys(OPENING_TYPES) as OpeningType[]).map((t) =>
          `<option value="${t}" ${t === o.type ? "selected" : ""}>${OPENING_TYPES[t].label}</option>`).join("")}</select></td>
        ${(["xMin", "xMax", "zMin", "zMax", "setback"] as const).map((k) =>
          `<td><input class="num" type="number" step="0.1" data-key="${o.id}-${k}" data-field="${k}" value="${o[k]}" /></td>`).join("")}
        <td class="num">${openingArea(o).toFixed(2)}</td>
        <td class="num">${(openingArea(o) * openingFraction(o)).toFixed(2)}</td>
        <td><button class="button ghost small danger" data-delete="${o.id}" aria-label="Delete opening">Delete</button></td>
      </tr>`).join("")}</tbody></table></div>`;
  el.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((row) => {
    row.addEventListener("focusin", () => {
      if (selectedId !== row.dataset.id) {
        selectedId = row.dataset.id!;
        el.querySelectorAll("tr[data-id]").forEach((r) => r.setAttribute("aria-selected", String(r === row)));
        editor?.draw();
      }
    });
  });
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const id = input.closest("tr")!.dataset.id!;
      const o = f.openings.find((p) => p.id === id);
      if (!o) return;
      const field = input.dataset.field!;
      if (field === "type") o.type = input.value as OpeningType;
      else {
        const v = parseFloat(input.value);
        if (!Number.isFinite(v)) return;
        (o as unknown as Record<string, number>)[field] = field === "setback" ? Math.max(0, v) : v;
        if (o.xMax - o.xMin < 0.05) o.xMax = o.xMin + 0.1;
        if (o.zMax - o.zMin < 0.05) o.zMax = o.zMin + 0.1;
      }
      renderOpeningsTable(); changed();
    });
  });
  el.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((b) => b.addEventListener("click", () => {
    f.openings = f.openings.filter((o) => o.id !== b.dataset.delete);
    if (selectedId === b.dataset.delete) selectedId = null;
    renderOpeningsTable(); changed();
  }));
  if (focusKey) el.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
}

function sprinklerText(r: FacadeResults): string {
  if (!r.sprinklered) return "No sprinkler allowance";
  return r.sprinklerOption === "halveDistance" ? "Sprinklers: boundary distance halved, minimum 1 metre" : "Sprinklers: permitted unprotected area doubled";
}

function renderResults() {
  const f = activeFacade();
  const el = document.querySelector<HTMLElement>("#results");
  if (!el) return;
  const r = results.get(f.id);
  if (!r) { el.innerHTML = `<p class="hint">Calculating…</p>`; return; }
  const stale = r.key !== facadeKey(f);
  const overlaps = openingOverlaps(f.openings);
  const overlapNote = overlaps.length ? `<ul class="warnings">${overlaps.map((o) => `<li>Two openings overlap by ${fmt(o.area)} square metres; they are merged and the overlap is counted once.</li>`).join("")}</ul>` : "";
  const roundingNote = `<p class="hint">Rounding: distances and intensities are rounded up; percentages and permitted areas are rounded down.</p>`;
  if ((f.boundaryDistance ?? 1) < 1) {
    el.innerHTML = `<div class="verdict na"><div class="mark">–</div><div><div class="title">Not applicable: within 1 metre of the boundary</div>
      <div class="sub">The entered boundary distance is ${fmt(f.boundaryDistance ?? 0)} metres. ${PARAGRAPH_13_8} No pass or fail is given by calculation.</div></div></div>${overlapNote}`;
  } else if (r.empty || !r.individual || !r.enclosing) {
    el.innerHTML = `<div class="verdict pass"><div class="mark">✓</div><div><div class="title">Pass</div><div class="sub">This façade has no openings, so the minimum boundary distance is 0 metres.</div></div></div>`;
  } else {
    const ind = r.individual, box = r.enclosing, at = r.atEntered;
    const limitText = r.sprinklered && r.sprinklerOption === "doubleArea"
      ? "Limit 12.6 kilowatts per square metre; with the area doubled, intensities up to 25.2 are accepted"
      : "Acceptance limit 12.6 kilowatts per square metre";
    const tableText = __PUBLIC_BUILD__ ? "BR 187 (1991) table: Table values not included in this public version" : r.enclosingTable === null ? "Outside the range of the 1991 table (height above 27 metres)"
      : `BR 187 (1991) table: ${fmt(r.enclosingTable)} metres interpolated, ${fmt(r.enclosingTableColumn ?? NaN, 1)} metres by the next column`;
    el.innerHTML = `
      ${stale ? `<p class="note">Showing the previous result while the new one is calculated.</p>` : ""}
      <div class="verdict ${at.passes ? "pass" : "fail"}"><div class="mark">${at.passes ? "✓" : "✕"}</div><div><div class="title">${at.passes ? "Pass" : "Fail"}</div>
        <div class="sub">At the entered boundary distance of ${fmt(r.boundaryDistance)} metres. ${at.passes ? "The requirement is met." : `At least ${fmtUp(r.requiredDistance)} metres is needed.`}</div></div></div>
      ${overlapNote}
      <div class="results-grid">
        <div class="stat"><div class="value">${fmtUp(r.requiredDistance)} metres</div>
          <div class="label">Minimum boundary distance, each opening calculated separately</div>
          <div class="sub">${r.sprinklered ? `${fmtUp(ind.boundaryDistance)} metres before the sprinkler allowance. ` : ""}Worst point opposite ${fmt(ind.peakX, 1)} metres along and ${fmt(ind.peakZ, 1)} metres up</div></div>
        <div class="stat"><div class="value">${fmtUp(r.enclosingRequiredDistance)} metres</div>
          <div class="label">Single enclosing rectangle, receiver opposite its centre</div>
          <div class="sub">${tableText}${r.sprinklered ? " (before the sprinkler allowance)" : ""}</div></div>
        <div class="stat"><div class="value">${fmt(box.percentage, 1)}%</div>
          <div class="label">Unprotected area as a percentage of the enclosing rectangle</div>
          <div class="sub">${fmt(box.unprotectedArea, 1)} square metres within a ${fmt(box.width, 1)} by ${fmt(box.height, 1)} metre rectangle</div></div>
        <div class="stat"><div class="value ${at.passes ? "pass" : "fail"}">${at.passes ? "Pass" : "Fail"}</div>
          <div class="label">At the entered boundary distance of ${fmt(r.boundaryDistance)} metres</div>
          <div class="sub">${sprinklerText(r)}. ${at.passes ? "The requirement is met." : `At least ${fmtUp(r.requiredDistance)} metres is needed.`}</div></div>
        <div class="stat"><div class="value ${at.peakIntensity > ACCEPTANCE_LIMIT * (r.sprinklered && r.sprinklerOption === "doubleArea" ? 2 : 1) ? "fail" : ""}">${fmtUp(at.peakIntensity, 1)}</div>
          <div class="label">Peak received intensity at the entered distance (kilowatts per square metre)</div>
          <div class="sub">${limitText}</div></div>
        <div class="stat"><div class="value">${fmtDown(at.permittedPercentage, 1)}%</div>
          <div class="label">Maximum unprotected area at the entered distance, same layout</div>
          <div class="sub">${fmtDown(at.permittedArea, 1)} square metres. Single enclosing rectangle method: ${fmtDown(at.enclosingPermittedPercentage, 1)}%</div></div>
      </div>
      <p class="hint">Source intensity ${sourceIntensity(f.fireLoad)} kilowatts per square metre. The building opposite is assumed to be a mirror image, so the separation distance is twice the boundary distance.</p>${roundingNote}`;
  }
  const caption = document.querySelector<HTMLElement>("#heat-caption");
  if (caption) caption.textContent = `Receiving plane parallel to the façade at the separation distance of ${fmt(2 * (f.boundaryDistance ?? 1))} metres (twice the entered boundary distance). The black line is the 12.6 kilowatts per square metre contour; the cross marks the peak. White outlines show the openings.`;
  const width = Math.max(320, (document.querySelector<HTMLElement>("#heat-map")?.parentElement?.clientWidth ?? 800) - 40);
  drawHeatMap(document.querySelector<HTMLCanvasElement>("#heat-map")!, f, r, width);
  drawLegend(document.querySelector<HTMLCanvasElement>("#heat-legend")!, width);
  drawProfile(document.querySelector<HTMLCanvasElement>("#profile")!, r, width);
}

// ---------------------------------------------------------------- three-dimensional view
function renderView3DShell() {
  const root = document.querySelector<HTMLElement>("#view3d-view")!;
  const f = activeFacade();
  root.style.gridTemplateColumns = "1fr";
  if (!root.querySelector("#view3d")) {
    root.innerHTML = `
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.6rem;gap:1rem;flex-wrap:wrap">
          <h2 style="margin:0" id="view3d-title"></h2>
          <div style="display:flex;gap:.5rem;align-items:center">
            <label class="field" style="margin:0;flex-direction:row;align-items:center;gap:.5rem"><span style="font-size:.8125rem;color:var(--charcoal)">Façade</span>
              <select id="view3d-facade"></select></label>
          </div>
        </div>
        <div id="view3d"></div>
        <div class="view-legend">${VIEW_LEGEND.map((l) => `<span style="--c:${l.colour}">${l.label}</span>`).join("")}
          <span style="--c:linear-gradient(90deg,#c4edf3,#006ba6,#cedc00,#cc1f1d)">Heat map on the receiving plane at twice the boundary distance</span></div>
        <p class="hint" style="margin-top:.6rem">Drag to rotate, scroll to zoom, and right-drag to pan. The receiving plane stands where the face of the assumed mirror-image building would be, at twice the boundary distance; the translucent blue plane is the boundary itself.</p>
      </div>`;
    view3d = new View3D(document.querySelector<HTMLElement>("#view3d")!);
    window.addEventListener("resize", () => view3d?.resize());
  }
  const select = root.querySelector<HTMLSelectElement>("#view3d-facade")!;
  select.innerHTML = project.facades.map((x) => `<option value="${x.id}" ${x.id === f.id ? "selected" : ""}>${escapeHtml(x.name)}</option>`).join("");
  select.onchange = () => { project.activeFacadeId = select.value; save(); renderView3DShell(); scheduleCompute(0); };
  updateView3D();
  scheduleCompute(0);
}

function updateView3D() {
  const f = activeFacade();
  const title = document.querySelector<HTMLElement>("#view3d-title");
  if (title) title.textContent = `${f.name}: boundary at ${fmt(f.boundaryDistance ?? 1)} metres`;
  view3d?.update(f, results.get(f.id) ?? null);
}

// ---------------------------------------------------------------- report
let reportView3d: View3D | null = null;
function showReport() {
  const root = document.querySelector<HTMLElement>("#report-view")!;
  renderReport(root, project, results, {
    elevation: (f) => { const c = document.createElement("canvas"); drawElevationStatic(c, f, 820); return c.toDataURL("image/png"); },
    heatMap: (f, r) => { const c = document.createElement("canvas"); drawHeatMap(c, f, r, 820); return c.toDataURL("image/png"); },
    legend: () => { const c = document.createElement("canvas"); drawLegend(c, 820); return c.toDataURL("image/png"); },
    profile: (r) => { const c = document.createElement("canvas"); drawProfile(c, r, 820); return c.toDataURL("image/png"); },
    view3d: (f, r) => {
      if (!reportView3d) {
        const host = document.createElement("div");
        host.style.cssText = "position:fixed;left:-10000px;top:0;width:960px;height:520px";
        host.setAttribute("aria-hidden", "true");
        document.body.appendChild(host);
        reportView3d = new View3D(host);
      }
      return reportView3d.snapshotFor(f, r);
    },
  }, () => window.print());
}

window.addEventListener("resize", () => {
  if (view === "model" && app.offsetParent !== null) { editor?.resize(editorWidth()); renderResults(); }
});

/** Called when the "Simple elevation" tab becomes visible. */
export function activate() { setView(view); }
export function getProject(): Project { return project; }
export function blankSimpleProject(): Project { return blankProject(); }

renderModel();
scheduleCompute(0);
export const simpleResults = results;
