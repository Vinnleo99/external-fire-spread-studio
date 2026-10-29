/** User interface for the site model: plan editor, wall elevations, three-dimensional view, results and report. */
import ComputeWorker from "../worker?worker&inline";
import { FIRE_LOAD_LABELS, Facade, FireLoadCategory, OPENING_TYPES, OpeningType, openingArea, fmtUp, openingFraction } from "../engine/model";
import { Block, DEFAULT_SETTINGS, Point2, SiteOpening, SiteProject, Wall, allWalls, blockTop, siteKey, wallsOfBlock } from "../engine/site";
import { SHIELDING_STATUS, SiteResults, wallDescription } from "../engine/siteAssessment";
import { PARAGRAPH_13_8 } from "../engine/siteChecks";
import { blankSite, siteExampleOffice, siteExamplePodium } from "../siteExamples";
import { drawElevationStatic, drawLegend } from "../ui/charts";
import { OPENING_STYLE } from "../ui/colours";
import { ElevationEditor } from "../ui/elevation";
import { PlanEditor, PlanTool, Selection, drawPlanStatic } from "./planEditor";
import { compartmentLegend, drawBoundaryProfile, escapeHtml } from "./siteCharts";
import { APPROACH_LABELS, ORIENTATION_LABELS, down, offsetText, up, renderSiteReport, sprinklerText } from "./siteReport";
import { SITE_VIEW_LEGEND, SiteView3D } from "./siteView3d";

export type SiteTab = "plan" | "elevations" | "site3d" | "results" | "report";

const STORAGE_KEY = "external-fire-spread-studio-site";
const fmt = (v: number | null | undefined, n = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "not applicable" : v.toFixed(n));
const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel);

function newId(prefix = "o"): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function normaliseSite(p: SiteProject): SiteProject {
  p.format = "external-fire-spread-studio-site";
  p.version = 2;
  p.settings = { ...DEFAULT_SETTINGS, ...(p.settings ?? {}) };
  p.compartments = p.compartments ?? [];
  p.blocks = p.blocks ?? [];
  p.openings = p.openings ?? [];
  p.boundaries = p.boundaries ?? [];
  if (!p.compartments.length) p.compartments.push({ id: "c1", name: "Compartment 1", fireLoad: "office" });
  return p;
}

function loadInitial(): SiteProject {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as SiteProject;
      if (p && p.format === "external-fire-spread-studio-site") return normaliseSite(p);
    }
  } catch { /* ignore a corrupt saved project */ }
  return siteExamplePodium();
}

// ---------------------------------------------------------------- state
let project: SiteProject = loadInitial();
let results: SiteResults | null = null;
let computing = false;
let lastError = "";
let requestId = 0;
let timer: number | undefined;
let tool: PlanTool = "select";
let selection: Selection = project.activeBlockId ? { kind: "block", id: project.activeBlockId } : null;
let openingTool: OpeningType = "window";
let selectedOpeningId: string | null = null;
let tab: SiteTab = "plan";
let plan: PlanEditor | null = null;
let elev: ElevationEditor | null = null;
let proxy: Facade | null = null;
let view3d: SiteView3D | null = null;
let snapView: SiteView3D | null = null;

const worker = new ComputeWorker();
worker.onmessage = (event: MessageEvent<{ requestId: number; kind?: string; results?: SiteResults; error?: string }>) => {
  const d = event.data;
  if (d.kind !== "site" || d.requestId !== requestId) return;
  computing = false;
  if (d.error) { lastError = d.error; console.warn("Site calculation failed:", d.error); }
  else if (d.results) { results = d.results; lastError = ""; }
  refreshResults();
};
worker.onerror = (e) => { computing = false; lastError = e.message || "The calculation worker failed to start."; renderStatus(); };

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(project)); } catch { /* storage full or unavailable */ }
}

function isStale(): boolean { return !results || results.key !== siteKey(project); }

function scheduleCompute(delay = 200) {
  window.clearTimeout(timer);
  computing = true;
  renderStatus();
  timer = window.setTimeout(() => {
    requestId++;
    worker.postMessage({ kind: "site", requestId, project: JSON.parse(JSON.stringify(project)) });
  }, delay);
}

/** After any edit. `final` triggers a recalculation and refreshes the side panels. */
function changed(final = true, delay = 200) {
  save();
  plan?.draw();
  if (final) scheduleCompute(delay);
}

function renderStatus() {
  const text = lastError ? `<span class="badge fail">Calculation error</span> ${escapeHtml(lastError)}`
    : computing || isStale() ? `<span class="badge working">Calculating…</span>`
    : results ? `<span class="badge ${results.passes ? "pass" : "fail"}">${results.passes ? "Pass" : "Fail"}</span> Up to date (${results.milliseconds.toFixed(0)} milliseconds)` : "";
  document.querySelectorAll<HTMLElement>(".site-status").forEach((el) => { el.innerHTML = text; });
}

function refreshResults() {
  renderStatus();
  plan?.draw();
  if (tab === "plan") renderSummary();
  if (tab === "elevations") renderWallResults();
  if (tab === "site3d") view3d?.update(project, results, project.activeWallId);
  if (tab === "results") renderResultsTab();
  if (tab === "report") renderReportTab();
}

// ---------------------------------------------------------------- public interface
export function getSiteProject(): SiteProject { return project; }
export function getSiteResults(): SiteResults | null { return results; }

export function replaceSiteProject(p: SiteProject) {
  project = normaliseSite(p);
  results = null;
  selection = project.blocks[0] ? { kind: "block", id: project.blocks[0].id } : null;
  project.activeBlockId = selection?.id;
  project.activeWallId = undefined;
  selectedOpeningId = null;
  proxy = null;
  save();
  if (plan) { plan.cancelDraft(); plan.fit(); }
  renderTab();
  scheduleCompute(0);
}

export function blankSiteProject(): SiteProject { return blankSite(); }

export function showSiteTab(next: SiteTab) {
  tab = next;
  const ids: Record<SiteTab, string> = { plan: "#tab-plan", elevations: "#tab-elevations", site3d: "#tab-site3d", results: "#tab-results", report: "#tab-report" };
  (Object.keys(ids) as SiteTab[]).forEach((k) => { $(ids[k])!.hidden = k !== next; });
  renderTab();
}

export function hideSite() {
  ["#tab-plan", "#tab-elevations", "#tab-site3d", "#tab-results", "#tab-report"].forEach((s) => { $(s)!.hidden = true; });
}

function renderTab() {
  if (tab === "plan") renderPlanTab();
  if (tab === "elevations") renderElevationsTab();
  if (tab === "site3d") render3DTab();
  if (tab === "results") renderResultsTab();
  if (tab === "report") renderReportTab();
  renderStatus();
}

// ---------------------------------------------------------------- opening re-mapping when footprints change
function remapOpenings(blockId: string, map: (edge: number) => number | null) {
  const kept: SiteOpening[] = [];
  let dropped = 0;
  for (const o of project.openings) {
    const [b, e] = o.wallId.split(":");
    if (b !== blockId) { kept.push(o); continue; }
    const next = map(Number(e));
    if (next === null) { dropped++; continue; }
    o.wallId = `${blockId}:${next}`;
    kept.push(o);
  }
  project.openings = kept;
  if (project.activeWallId?.startsWith(`${blockId}:`)) project.activeWallId = undefined;
  if (dropped) planStatus(`${dropped} opening(s) on the removed wall were deleted.`);
}

/** A vertex was inserted after vertex `index`, splitting edge `index`. */
function afterInsert(blockId: string, index: number) { remapOpenings(blockId, (e) => (e > index ? e + 1 : e)); }
/** Vertex `index` was removed: edges index − 1 and index merge; openings on edge index are deleted. */
function afterDelete(blockId: string, index: number) { remapOpenings(blockId, (e) => (e === index ? null : e > index ? e - 1 : e)); }

function planStatus(text: string) { const el = $("#site-plan-status"); if (el) el.textContent = text; }

// ---------------------------------------------------------------- plan tab
const TOOL_LABELS: Record<PlanTool, string> = {
  select: "Select and edit", boundary: "Draw relevant boundary", notional: "Draw notional boundary",
  rectangle: "Draw rectangular block", block: "Draw block outline",
};
const TOOL_HINTS: Record<PlanTool, string> = {
  select: "Click a block or boundary to select it. Drag a corner point to move it; double-click a line of the selected item to add a point; select a point and press Delete to remove it. Drag empty space, or drag with the right mouse button, to pan; use the mouse wheel to zoom. On a touch screen, drag with one finger, pinch with two fingers to zoom, and double-tap instead of double-clicking. Hold Alt to turn off snapping.",
  boundary: "Click to place each point of the relevant boundary. Double-click (double-tap on a touch screen) or press Enter to finish; press Escape to cancel. The boundary may have any number of straight, angled or stepped segments.",
  notional: "Click to place each point of a notional boundary between two buildings on the same site (Approved Document B, paragraph 13.5(c) and Diagram 13.3). Double-click (double-tap on a touch screen) or press Enter to finish.",
  rectangle: "Drag to draw a rectangular storey block. Set its base level, number of storeys and compartment in the panel on the left.",
  block: "Click to place each corner of the block outline. Double-click (double-tap on a touch screen) or press Enter to close it.",
};

function planWidth(): number { return Math.max(360, $("#tab-plan .plan-wrap")?.clientWidth ?? 900); }

function renderPlanTab() {
  const root = $("#tab-plan")!;
  if (!root.dataset.built) {
    root.dataset.built = "1";
    root.innerHTML = `
      <aside>
        <div class="panel">
          <h2>Project</h2>
          <div class="field"><label for="site-name">Project name</label><input id="site-name" /></div>
          <div class="field"><label for="site-engineer">Prepared by</label><input id="site-engineer" placeholder="Name of the engineer" /></div>
          <div class="eyebrow">Examples</div>
          <div style="display:flex;flex-direction:column;gap:.4rem">
            <button class="button secondary small" id="site-example-1">Example 1: irregular office façade</button>
            <button class="button secondary small" id="site-example-2">Example 2: podium with set-back upper floors</button>
          </div>
        </div>
        <div class="panel" id="site-selection-panel"></div>
      </aside>
      <div>
        <div class="panel">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;gap:1rem">
            <h2 style="margin:0">Site plan</h2><div class="status site-status"></div>
          </div>
          <div class="toolbar" role="toolbar" aria-label="Plan tools">
            ${(Object.keys(TOOL_LABELS) as PlanTool[]).map((t) => `<button data-plan-tool="${t}" aria-pressed="${t === tool}">${TOOL_LABELS[t]}</button>`).join("")}
            <span class="sep"></span>
            <button id="site-fit">Fit to view</button>
          </div>
          <p class="hint" id="site-plan-hint"></p>
          <div class="plan-wrap"><canvas class="plan" id="site-plan"></canvas></div>
          <div class="status-line" id="site-plan-status"></div>
          <canvas class="chart" id="site-plan-legend"></canvas>
          <p class="hint">The coloured strip outside each boundary is the peak received intensity at that point over all heights and fire compartments. Grey means no wall of the building is opposite that point. The cross marks the governing point.</p>
        </div>
        <div class="panel"><h2>Results</h2><div id="site-summary"></div></div>
        <div class="panel" id="site-compartments-panel"></div>
        <div class="panel" id="site-settings-panel"></div>
      </div>`;
    const name = $<HTMLInputElement>("#site-name")!, eng = $<HTMLInputElement>("#site-engineer")!;
    name.addEventListener("input", () => { project.name = name.value; save(); });
    eng.addEventListener("input", () => { project.engineer = eng.value; save(); });
    $("#site-example-1")!.addEventListener("click", () => { if (confirm("Replace the site model with example 1?")) replaceSiteProject(siteExampleOffice()); });
    $("#site-example-2")!.addEventListener("click", () => { if (confirm("Replace the site model with example 2?")) replaceSiteProject(siteExamplePodium()); });
    root.querySelectorAll<HTMLButtonElement>("[data-plan-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.planTool as PlanTool)));
    $("#site-fit")!.addEventListener("click", () => plan?.fit());
    plan = new PlanEditor($<HTMLCanvasElement>("#site-plan")!, {
      getProject: () => project,
      getResults: () => results,
      getTool: () => tool,
      setTool,
      getSelection: () => selection,
      select: (s) => {
        selection = s;
        project.activeBlockId = s?.kind === "block" ? s.id : project.activeBlockId;
        project.activeBoundaryId = s?.kind === "boundary" ? s.id : project.activeBoundaryId;
        renderSelectionPanel();
      },
      changed: (final, detail) => {
        if (detail?.kind === "insertVertex") afterInsert(detail.blockId, detail.index);
        if (detail?.kind === "deleteVertex") afterDelete(detail.blockId, detail.index);
        if (final) { renderSelectionPanel(); renderCompartmentsPanel(); }
        else updatePointInputs();
        changed(final);
      },
      newId: (prefix) => newId(prefix),
      status: planStatus,
    });
  }
  $<HTMLInputElement>("#site-name")!.value = project.name;
  $<HTMLInputElement>("#site-engineer")!.value = project.engineer ?? "";
  setTool(tool);
  renderSelectionPanel();
  renderCompartmentsPanel();
  renderSettingsPanel();
  plan!.resize(planWidth());
  drawLegend($<HTMLCanvasElement>("#site-plan-legend")!, Math.min(640, planWidth()));
  renderSummary();
}

function setTool(t: PlanTool) {
  if (t !== tool) plan?.cancelDraft();
  tool = t;
  document.querySelectorAll<HTMLButtonElement>("[data-plan-tool]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.planTool === t)));
  const hint = $("#site-plan-hint");
  if (hint) hint.textContent = TOOL_HINTS[t];
  plan?.draw();
}

function compartmentOptions(selected: string): string {
  return project.compartments.map((c) => `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("");
}

function pointsTable(points: Point2[], minimum: number): string {
  return `<div class="table-scroll"><table class="data compact"><thead><tr><th>Point</th><th>x, east (metres)</th><th>y, north (metres)</th><th></th></tr></thead><tbody>
    ${points.map(([x, y], i) => `<tr><td>${i + 1}</td>
      <td><input class="num" type="number" step="0.1" data-pt="${i}" data-axis="0" value="${+x.toFixed(3)}" /></td>
      <td><input class="num" type="number" step="0.1" data-pt="${i}" data-axis="1" value="${+y.toFixed(3)}" /></td>
      <td><button class="button ghost small danger" data-del-pt="${i}" ${points.length <= minimum ? "disabled" : ""} aria-label="Delete point ${i + 1}">Delete</button></td></tr>`).join("")}
    </tbody></table></div>`;
}

function updatePointInputs() {
  const pts = selectedPoints();
  if (!pts) return;
  document.querySelectorAll<HTMLInputElement>("#site-selection-panel [data-pt]").forEach((input) => {
    if (document.activeElement === input) return;
    const v = pts[Number(input.dataset.pt)]?.[Number(input.dataset.axis)];
    if (v !== undefined) input.value = String(+v.toFixed(3));
  });
}

function selectedPoints(): Point2[] | null {
  if (selection?.kind === "block") return project.blocks.find((b) => b.id === selection!.id)?.footprint ?? null;
  if (selection?.kind === "boundary") return project.boundaries.find((b) => b.id === selection!.id)?.points ?? null;
  return null;
}

function renderSelectionPanel() {
  const el = $("#site-selection-panel");
  if (!el) return;
  const block = selection?.kind === "block" ? project.blocks.find((b) => b.id === selection!.id) : undefined;
  const boundary = selection?.kind === "boundary" ? project.boundaries.find((b) => b.id === selection!.id) : undefined;
  if (selection && !block && !boundary) selection = null;
  const chips = `
    <div class="eyebrow">Storey blocks</div>
    <div class="chips">${project.blocks.map((b) => `<button data-sel-block="${b.id}" aria-current="${b.id === block?.id}">${escapeHtml(b.name)}</button>`).join("") || `<span class="hint">None yet</span>`}</div>
    <div class="eyebrow">Boundaries</div>
    <div class="chips">${project.boundaries.map((b) => `<button data-sel-boundary="${b.id}" aria-current="${b.id === boundary?.id}">${escapeHtml(b.name)}</button>`).join("") || `<span class="hint">None yet</span>`}</div>`;
  let body = `<p class="hint">Select a block or boundary above or on the plan, or draw a new one with the tools above the plan.</p>`;
  if (block) {
    body = `
      <h3 style="margin:.6rem 0 .5rem">Storey block</h3>
      <div class="field"><label for="blk-name">Name</label><input id="blk-name" value="${escapeHtml(block.name)}" /></div>
      <div class="field"><label for="blk-comp">Fire compartment</label><select id="blk-comp">${compartmentOptions(block.compartmentId)}</select></div>
      <div class="row">
        <div class="field"><label for="blk-base">Base level (metres)</label><input id="blk-base" type="number" step="0.1" min="0" value="${block.base}" /></div>
        <div class="field"><label for="blk-storeys">Storeys</label><input id="blk-storeys" type="number" step="1" min="1" value="${block.storeys}" /></div>
      </div>
      <div class="row">
        <div class="field"><label for="blk-height">Floor-to-floor height (metres)</label><input id="blk-height" type="number" step="0.1" min="0.5" value="${block.storeyHeight}" /></div>
        <div class="field"><label>Top of block (metres)</label><input id="blk-top" disabled value="${fmt(blockTop(block))}" /></div>
      </div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;margin-bottom:.6rem">
        <button class="button secondary small" id="blk-above">Add block above</button>
        <button class="button secondary small" id="blk-dup">Duplicate</button>
        <button class="button secondary small" id="blk-walls">Edit wall openings</button>
        <button class="button ghost small danger" id="blk-del">Delete block</button>
      </div>
      <div class="eyebrow">Footprint</div>
      ${pointsTable(block.footprint, 3)}
      <button class="button ghost small" id="pt-add">Add point</button>`;
  } else if (boundary) {
    body = `
      <h3 style="margin:.6rem 0 .5rem">Boundary</h3>
      <div class="field"><label for="bnd-name">Name</label><input id="bnd-name" value="${escapeHtml(boundary.name)}" /></div>
      <div class="field"><label for="bnd-kind">Type</label><select id="bnd-kind">
        <option value="relevant" ${boundary.kind === "relevant" ? "selected" : ""}>Relevant boundary</option>
        <option value="notional" ${boundary.kind === "notional" ? "selected" : ""}>Notional boundary</option></select></div>
      <div class="eyebrow">Points</div>
      ${pointsTable(boundary.points, 2)}
      <div style="display:flex;gap:.4rem;flex-wrap:wrap">
        <button class="button ghost small" id="pt-add">Add point</button>
        <button class="button ghost small danger" id="bnd-del">Delete boundary</button>
      </div>`;
  }
  el.innerHTML = `<h2>Model</h2>${chips}${body}`;
  el.querySelectorAll<HTMLButtonElement>("[data-sel-block]").forEach((b) => b.addEventListener("click", () => {
    selection = { kind: "block", id: b.dataset.selBlock! }; project.activeBlockId = selection.id; renderSelectionPanel(); plan?.draw();
  }));
  el.querySelectorAll<HTMLButtonElement>("[data-sel-boundary]").forEach((b) => b.addEventListener("click", () => {
    selection = { kind: "boundary", id: b.dataset.selBoundary! }; project.activeBoundaryId = selection.id; renderSelectionPanel(); plan?.draw();
  }));
  const pts = block?.footprint ?? boundary?.points;
  el.querySelectorAll<HTMLInputElement>("[data-pt]").forEach((input) => input.addEventListener("change", () => {
    const v = parseFloat(input.value);
    if (!pts || !Number.isFinite(v)) return;
    pts[Number(input.dataset.pt)][Number(input.dataset.axis)] = v;
    changed();
  }));
  el.querySelectorAll<HTMLButtonElement>("[data-del-pt]").forEach((b) => b.addEventListener("click", () => {
    if (!pts) return;
    const i = Number(b.dataset.delPt);
    pts.splice(i, 1);
    if (block) afterDelete(block.id, i);
    renderSelectionPanel(); changed();
  }));
  el.querySelector("#pt-add")?.addEventListener("click", () => {
    if (!pts || !pts.length) return;
    const n = pts.length;
    if (block) {
      // Split the longest edge at its midpoint.
      let best = 0, len = -1;
      for (let i = 0; i < n; i++) { const a = pts[i], c = pts[(i + 1) % n]; const l = Math.hypot(c[0] - a[0], c[1] - a[1]); if (l > len) { len = l; best = i; } }
      const a = pts[best], c = pts[(best + 1) % n];
      pts.splice(best + 1, 0, [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2]);
      afterInsert(block.id, best);
    } else {
      const a = pts[n - 1], c = n > 1 ? pts[n - 2] : [a[0] - 5, a[1]];
      pts.push([a[0] + (a[0] - c[0]) * 0.5 || a[0] + 5, a[1] + (a[1] - c[1]) * 0.5]);
    }
    renderSelectionPanel(); changed();
  });
  if (block) {
    const num = (sel: string, apply: (v: number) => void) => $<HTMLInputElement>(sel)!.addEventListener("input", (e) => {
      const v = parseFloat((e.target as HTMLInputElement).value);
      if (!Number.isFinite(v)) return;
      apply(v);
      $<HTMLInputElement>("#blk-top")!.value = fmt(blockTop(block));
      changed(true, 500);
    });
    $<HTMLInputElement>("#blk-name")!.addEventListener("input", (e) => {
      block.name = (e.target as HTMLInputElement).value; save(); plan?.draw();
      const chip = el.querySelector(`[data-sel-block="${block.id}"]`); if (chip) chip.textContent = block.name;
    });
    $<HTMLSelectElement>("#blk-comp")!.addEventListener("change", (e) => { block.compartmentId = (e.target as HTMLSelectElement).value; renderCompartmentsPanel(); changed(); });
    num("#blk-base", (v) => { block.base = Math.max(0, v); });
    num("#blk-storeys", (v) => { block.storeys = Math.max(1, Math.round(v)); });
    num("#blk-height", (v) => { block.storeyHeight = Math.max(0.5, v); });
    $("#blk-above")!.addEventListener("click", () => {
      const id = newId("b");
      project.blocks.push({ ...JSON.parse(JSON.stringify(block)), id, name: `${block.name} upper`, base: blockTop(block), storeys: 1 } as Block);
      selection = { kind: "block", id }; project.activeBlockId = id;
      renderSelectionPanel(); renderCompartmentsPanel(); changed();
    });
    $("#blk-dup")!.addEventListener("click", () => {
      const id = newId("b");
      const copy = JSON.parse(JSON.stringify(block)) as Block;
      copy.id = id; copy.name = `${block.name} (copy)`;
      copy.footprint = copy.footprint.map(([x, y]) => [x + 5, y + 5]);
      project.blocks.push(copy);
      project.openings.filter((o) => o.wallId.startsWith(`${block.id}:`)).forEach((o) =>
        project.openings.push({ ...o, id: newId(), wallId: o.wallId.replace(`${block.id}:`, `${id}:`) }));
      selection = { kind: "block", id }; project.activeBlockId = id;
      renderSelectionPanel(); renderCompartmentsPanel(); changed();
    });
    $("#blk-walls")!.addEventListener("click", () => {
      project.activeWallId = wallsOfBlock(block)[0]?.id;
      document.querySelector<HTMLButtonElement>('#main-nav [data-tab="elevations"]')?.click();
    });
    $("#blk-del")!.addEventListener("click", () => {
      const count = project.openings.filter((o) => o.wallId.startsWith(`${block.id}:`)).length;
      if (!confirm(`Delete the block "${block.name}"${count ? ` and its ${count} opening(s)` : ""}?`)) return;
      project.blocks = project.blocks.filter((b) => b.id !== block.id);
      project.openings = project.openings.filter((o) => !o.wallId.startsWith(`${block.id}:`));
      selection = null; renderSelectionPanel(); renderCompartmentsPanel(); changed();
    });
  }
  if (boundary) {
    $<HTMLInputElement>("#bnd-name")!.addEventListener("input", (e) => {
      boundary.name = (e.target as HTMLInputElement).value; save(); plan?.draw();
      const chip = el.querySelector(`[data-sel-boundary="${boundary.id}"]`); if (chip) chip.textContent = boundary.name;
    });
    $<HTMLSelectElement>("#bnd-kind")!.addEventListener("change", (e) => { boundary.kind = (e.target as HTMLSelectElement).value as "relevant" | "notional"; changed(); });
    $("#bnd-del")!.addEventListener("click", () => {
      if (!confirm(`Delete the boundary "${boundary.name}"?`)) return;
      project.boundaries = project.boundaries.filter((b) => b.id !== boundary.id);
      selection = null; renderSelectionPanel(); changed();
    });
  }
}

function renderCompartmentsPanel() {
  const el = $("#site-compartments-panel");
  if (!el) return;
  const used = (id: string) => project.blocks.filter((b) => b.compartmentId === id).length;
  el.innerHTML = `<h2>Fire compartments</h2>
    <p class="hint">Each compartment burns on its own (Approved Document B, paragraph 13.1(a)). Assign blocks to compartments in the block panel.</p>
    <table class="data compact"><thead><tr><th>Name</th><th>Purpose group</th><th>Blocks</th><th></th></tr></thead><tbody>
    ${project.compartments.map((c) => `<tr data-comp="${c.id}">
      <td><input data-comp-name value="${escapeHtml(c.name)}" aria-label="Compartment name" /></td>
      <td><select data-comp-load aria-label="Purpose group">${(Object.keys(FIRE_LOAD_LABELS) as FireLoadCategory[]).map((k) =>
        `<option value="${k}" ${k === c.fireLoad ? "selected" : ""}>${FIRE_LOAD_LABELS[k]}</option>`).join("")}</select></td>
      <td class="num">${used(c.id)}</td>
      <td><button class="button ghost small danger" data-comp-del ${used(c.id) || project.compartments.length < 2 ? "disabled" : ""}>Delete</button></td></tr>`).join("")}
    </tbody></table>
    <button class="button ghost small" id="comp-add">Add compartment</button>`;
  el.querySelectorAll<HTMLTableRowElement>("tr[data-comp]").forEach((row) => {
    const c = project.compartments.find((x) => x.id === row.dataset.comp)!;
    row.querySelector<HTMLInputElement>("[data-comp-name]")!.addEventListener("change", (e) => { c.name = (e.target as HTMLInputElement).value; renderSelectionPanel(); changed(); });
    row.querySelector<HTMLSelectElement>("[data-comp-load]")!.addEventListener("change", (e) => { c.fireLoad = (e.target as HTMLSelectElement).value as FireLoadCategory; changed(); });
    row.querySelector<HTMLButtonElement>("[data-comp-del]")!.addEventListener("click", () => {
      project.compartments = project.compartments.filter((x) => x.id !== c.id); renderCompartmentsPanel(); renderSelectionPanel(); changed();
    });
  });
  $("#comp-add")!.addEventListener("click", () => {
    project.compartments.push({ id: newId("c"), name: `Compartment ${project.compartments.length + 1}`, fireLoad: "office" });
    renderCompartmentsPanel(); renderSelectionPanel(); save();
  });
}

function renderSettingsPanel() {
  const el = $("#site-settings-panel");
  if (!el) return;
  const s = project.settings;
  el.innerHTML = `<h2>Assessment settings</h2>
    <div class="two-col">
      <div>
        <div class="eyebrow">Receiver position</div>
        <div class="radio-group">
          ${(Object.keys(APPROACH_LABELS) as (keyof typeof APPROACH_LABELS)[]).map((k) => `<label class="check"><input type="radio" name="site-approach" value="${k}" ${s.approach === k ? "checked" : ""}/> ${APPROACH_LABELS[k]}</label>`).join("")}
        </div>
        <p class="hint">Mirror image: at each point of the boundary the receiver is the mirror image, across the local line of the boundary, of the wall point opposite (Approved Document B, paragraph 13.1(d)). For a straight parallel boundary this is exactly BR 187. Receiver on the boundary is the BR 187 limiting case and is much more onerous.</p>
        <div class="field"><label for="site-orientation">Receiver orientation</label><select id="site-orientation">
          ${(Object.keys(ORIENTATION_LABELS) as (keyof typeof ORIENTATION_LABELS)[]).map((k) => `<option value="${k}" ${s.orientation === k ? "selected" : ""}>${ORIENTATION_LABELS[k]}</option>`).join("")}</select></div>
        <div class="field"><label for="site-shielding">Shielding by the building</label><select id="site-shielding">
          <option value="ignore" ${s.shielding === "ignore" ? "selected" : ""}>Ignore shielding (conservative)</option>
          <option value="approximate" ${s.shielding === "approximate" ? "selected" : ""}>Approximate line of sight${SHIELDING_STATUS ? ` (${SHIELDING_STATUS})` : ""}</option></select></div>
        <label class="check"><input type="checkbox" id="site-smallareas" ${s.smallAreas ? "checked" : ""}/> Ignore small unprotected areas allowed by Diagram 13.5</label>
        <p class="hint">Off by default. When on, openings that meet the Diagram 13.5 size and spacing rules are left out of the calculation and marked in the openings table. Spacing of small areas from large openings on other walls is engineering judgement.</p>
      </div>
      <div>
        <label class="check"><input type="checkbox" id="site-sprinklered" ${s.sprinklered ? "checked" : ""}/> Fitted throughout with sprinklers</label>
        <div id="site-sprinkler-options" ${s.sprinklered ? "" : "hidden"}>
          <label class="check"><input type="radio" name="site-sprinkler" value="halveDistance" ${s.sprinklerOption !== "doubleArea" ? "checked" : ""}/> Halve the distance to the boundary (minimum 1 metre)</label>
          <label class="check"><input type="radio" name="site-sprinkler" value="doubleArea" ${s.sprinklerOption === "doubleArea" ? "checked" : ""}/> Double the permitted unprotected area</label>
          <p class="hint">Approved Document B, Volume 2, paragraph 13.22.</p>
        </div>
        <div class="row">
          <div class="field"><label for="site-station">Spacing along boundaries (metres)</label><input id="site-station" type="number" min="0.1" step="0.1" value="${s.stationSpacing}" /></div>
          <div class="field"><label for="site-height">Spacing in height (metres)</label><input id="site-height" type="number" min="0.1" step="0.1" value="${s.heightSpacing}" /></div>
        </div>
        <div class="field"><label for="site-snap">Plan grid snap (metres)</label><input id="site-snap" type="number" min="0" step="0.1" value="${s.snap}" /></div>
      </div>
    </div>`;
  el.querySelectorAll<HTMLInputElement>('input[name="site-approach"]').forEach((r) => r.addEventListener("change", () => { s.approach = r.value as typeof s.approach; changed(); }));
  el.querySelectorAll<HTMLInputElement>('input[name="site-sprinkler"]').forEach((r) => r.addEventListener("change", () => { s.sprinklerOption = r.value as typeof s.sprinklerOption; changed(); }));
  $<HTMLSelectElement>("#site-orientation")!.addEventListener("change", (e) => { s.orientation = (e.target as HTMLSelectElement).value as typeof s.orientation; changed(); });
  $<HTMLSelectElement>("#site-shielding")!.addEventListener("change", (e) => { s.shielding = (e.target as HTMLSelectElement).value as typeof s.shielding; changed(); });
  $<HTMLInputElement>("#site-smallareas")!.addEventListener("change", (e) => { s.smallAreas = (e.target as HTMLInputElement).checked; changed(); });
  $<HTMLInputElement>("#site-sprinklered")!.addEventListener("change", (e) => {
    s.sprinklered = (e.target as HTMLInputElement).checked; $("#site-sprinkler-options")!.hidden = !s.sprinklered; changed();
  });
  const num = (sel: string, min: number, apply: (v: number) => void, recalc = true) => $<HTMLInputElement>(sel)!.addEventListener("change", (e) => {
    const v = parseFloat((e.target as HTMLInputElement).value);
    if (!Number.isFinite(v)) return;
    apply(Math.max(min, v)); changed(recalc);
  });
  num("#site-station", 0.1, (v) => { s.stationSpacing = v; });
  num("#site-height", 0.1, (v) => { s.heightSpacing = v; });
  num("#site-snap", 0, (v) => { s.snap = v; }, false);
}

function compName(id: string | null | undefined): string { return project.compartments.find((c) => c.id === id)?.name ?? "none"; }
function boundaryName(id: string | null | undefined): string { return project.boundaries.find((b) => b.id === id)?.name ?? "none"; }

const ROUNDING_NOTE = "Rounding: intensities and distances are rounded up; scaling factors, percentages and permitted areas are rounded down, so every figure shown errs on the safe side.";

function verdictCard(r: SiteResults): string {
  const w = r.worst;
  const na = r.withinOneMetre.length > 0 && r.boundaries.every((b) => b.peak === 0 && b.withinOneMetre.length > 0);
  const cls = na ? "na" : r.passes ? "pass" : "fail";
  const title = na ? "Not applicable by calculation" : r.passes ? "Pass" : "Fail";
  return `<div class="verdict ${cls}"><div class="mark">${na ? "–" : r.passes ? "✓" : "✕"}</div><div><div class="title">${title}</div>
    <div class="sub">Highest received intensity ${up(w.peak)} kilowatts per square metre against a limit of ${fmt(r.limit, 1)}${r.withinOneMetre.length ? `; ${r.withinOneMetre.length} wall${r.withinOneMetre.length === 1 ? "" : "s"} within 1 metre of a boundary assessed under paragraph 13.8` : ""}.</div></div></div>`;
}

function reviewSections(r: SiteResults): string {
  const within = r.withinOneMetre.length ? `<h3 style="margin-top:.8rem">Walls within 1 metre of a boundary</h3>
    <p class="hint">Not applicable: within 1 metre of the boundary. ${escapeHtml(PARAGRAPH_13_8)} These walls are not passed or failed by calculation.</p>
    <div class="table-scroll"><table class="data"><thead><tr><th>Wall</th><th>Boundary</th><th>Distance (metres)</th><th>Diagram 13.5 conditions</th></tr></thead><tbody>
    ${r.withinOneMetre.map((x) => `<tr><td>${escapeHtml(x.label)}</td><td>${escapeHtml(boundaryName(x.boundaryId))}</td><td class="num">${fmtUp(x.distance, 2)}</td>
      <td>${x.diagram135 ? `<span class="badge pass">Openings meet the small-area rules</span>` : `<span class="badge na">Check</span> ${x.issues.map(escapeHtml).join("; ")}`}</td></tr>`).join("")}</tbody></table></div>` : "";
  const kinks = r.boundaries.flatMap((b) => b.kinks.map((k) => ({ b, k })));
  const kinkHtml = kinks.length ? `<h3 style="margin-top:.8rem">Kinks in the boundary (judgement point)</h3>
    <p class="hint">At a bend in the boundary the mirror image is not uniquely defined. The receiver-on-boundary result is shown beside the main result near each bend for the engineer to judge; it does not change the overall verdict.</p>
    <div class="table-scroll"><table class="data"><thead><tr><th>Boundary</th><th>Position (metres along)</th><th>Turn (degrees)</th><th>Main result (kilowatts per square metre)</th><th>Receiver on the boundary (kilowatts per square metre)</th><th>Receiver on the boundary against the limit</th></tr></thead><tbody>
    ${kinks.map(({ b, k }) => `<tr><td>${escapeHtml(b.name)}</td><td class="num">${fmt(k.chainage, 1)}</td><td class="num">${fmt(k.turn, 0)}</td><td class="num">${up(k.mirrorPeak)}</td><td class="num">${up(k.boundaryPeak)}</td><td><span class="badge ${k.passes ? "pass" : "na"}">${k.passes ? "Within the limit" : "Above the limit"}</span></td></tr>`).join("")}</tbody></table></div>` : "";
  const ov = r.overlaps.length ? `<h3 style="margin-top:.8rem">Overlapping openings</h3><p class="hint">Overlapping openings are merged and the overlap is counted once.</p><ul class="warnings">${r.overlaps.map((o) => `<li>${escapeHtml(openingLabel(o.a))} and ${escapeHtml(openingLabel(o.b))} overlap by ${fmt(o.area)} square metres.</li>`).join("")}</ul>` : "";
  const sa = r.smallAreas.length ? `<h3 style="margin-top:.8rem">Small unprotected areas (Diagram 13.5)</h3><p class="hint">${project.settings.smallAreas ? "The option is on: openings marked as excluded are left out of the calculation." : "The option is off: these openings are included in the calculation."}</p>
    <div class="table-scroll"><table class="data"><thead><tr><th>Opening</th><th>Classification</th><th>In the calculation</th><th>Reason</th></tr></thead><tbody>
    ${r.smallAreas.map((x) => `<tr><td>${escapeHtml(openingLabel(x.openingId))}</td><td>${x.kind === "a" ? "Small area, type a" : x.kind === "b" ? "Small area, type b" : escapeHtml(x.kind)}</td><td>${x.ignored ? `<span class="badge na">Excluded</span>` : "Included"}</td><td>${escapeHtml(x.reason)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const sh = project.settings.shielding === "approximate" && r.shieldingStatus ? `<p class="note">Shielding by the building is approximated and is ${escapeHtml(r.shieldingStatus)}.</p>` : "";
  return within + kinkHtml + ov + sa + sh + `<p class="hint" style="margin-top:.6rem">${ROUNDING_NOTE}</p>`;
}

function openingLabel(id: string): string {
  const o = project.openings.find((x) => x.id === id);
  if (!o) return id;
  const w = allWalls(project).find((x) => x.id === o.wallId);
  return `${OPENING_TYPES[o.type].label.toLowerCase()} at ${fmt(o.xMin, 1)} to ${fmt(o.xMax, 1)} metres, ${fmt(o.zMin, 1)} to ${fmt(o.zMax, 1)} metres up${w ? ` on ${wallDescription(project, w)}` : ""}`;
}

function renderSummary() {
  const el = $("#site-summary");
  if (!el) return;
  renderStatus();
  if (!results) { el.innerHTML = `<p class="hint">Calculating…</p>`; return; }
  const r = results, w = r.worst;
  const gb = r.boundaries.find((b) => b.id === w.boundaryId);
  const gc = r.compartments.find((c) => c.id === w.compartmentId);
  el.innerHTML = `
    ${isStale() ? `<p class="note">The model has changed; these results are being recalculated.</p>` : ""}
    ${verdictCard(r)}
    <div class="results-grid">
      <div class="stat"><div class="value ${w.peak > r.limit ? "fail" : ""}">${up(w.peak)}</div><div class="label">Highest received intensity (kilowatts per square metre)</div><div class="sub">Limit ${fmt(r.limit, 1)}</div></div>
      <div class="stat"><div class="value" style="font-size:1.1rem">${escapeHtml(compName(w.compartmentId))}</div><div class="label">Governing fire compartment</div>
        <div class="sub">${w.boundaryId ? `${escapeHtml(boundaryName(w.boundaryId))}, ${fmt(w.chainage, 1)} metres along, ${fmt(w.z, 1)} metres up` : "No receiver sees the building"}</div></div>
      <div class="stat"><div class="value" style="font-size:1.1rem">${gb ? escapeHtml(offsetText(gb.requiredOffset)) : "not applicable"}</div><div class="label">Governing boundary, uniform offset to just meet the limit</div></div>
      <div class="stat"><div class="value">${gc ? down(gc.scaling) : "not applicable"}</div><div class="label">Scaling factor for the governing compartment</div><div class="sub">${gc ? `Maximum unprotected area ${down(gc.permittedArea, 1)} square metres (now ${fmt(gc.unprotectedArea, 1)})` : ""}</div></div>
      <div class="stat"><div class="value">${r.compartments.filter((c) => !c.passes).length} of ${r.compartments.length}</div><div class="label">Compartments that fail</div><div class="sub">See the Results tab for each face</div></div>
    </div>
    <div class="legend">${compartmentLegend(r)}</div>
    ${r.boundaries.map((b, i) => `<h3 style="margin-top:.6rem">${escapeHtml(b.name)} <span class="badge ${b.passes ? "pass" : "fail"}">${b.passes ? "Pass" : "Fail"}</span> <small style="font-weight:400;color:var(--grey)">peak ${up(b.peak)} kilowatts per square metre; ${escapeHtml(offsetText(b.requiredOffset))}</small></h3>
      <canvas class="chart" id="site-profile-${i}"></canvas>`).join("")}
    ${reviewSections(r)}
    ${r.warnings.length ? `<h3 style="margin-top:.8rem">Warnings</h3><ul class="warnings">${r.warnings.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}`;
  const width = Math.max(320, el.clientWidth || 800);
  const names = Object.fromEntries(project.compartments.map((c) => [c.id, c.name]));
  r.boundaries.forEach((b, i) => drawBoundaryProfile($<HTMLCanvasElement>(`#site-profile-${i}`)!, r, b, names, width, 250));
}

// ---------------------------------------------------------------- elevations tab
function activeWall(): Wall | null {
  const walls = allWalls(project);
  let w = walls.find((x) => x.id === project.activeWallId);
  if (!w) {
    w = walls.find((x) => project.openings.some((o) => o.wallId === x.id)) ?? walls[0];
    project.activeWallId = w?.id;
  }
  return w ?? null;
}

function syncProxy() {
  if (!proxy) return;
  const id = proxy.id;
  proxy.openings.forEach((o) => { (o as SiteOpening).wallId = id; });
  project.openings = [...project.openings.filter((o) => o.wallId !== id), ...(proxy.openings as SiteOpening[])];
}

function makeProxy(w: Wall): Facade {
  return {
    id: w.id, name: wallDescription(project, w), width: +w.length.toFixed(6), height: +(w.top - w.base).toFixed(6),
    compartment: compName(w.compartmentId), fireLoad: project.compartments.find((c) => c.id === w.compartmentId)?.fireLoad ?? "office",
    openings: project.openings.filter((o) => o.wallId === w.id),
    boundaryDistance: undefined, sprinklered: false, sprinklerOption: "halveDistance",
  };
}

function renderElevationsTab() {
  const root = $("#tab-elevations")!;
  const w = activeWall();
  if (!w) {
    root.innerHTML = `<aside><div class="panel"><h2>Walls</h2><p class="hint">There are no blocks yet. Draw a block on the site plan first.</p></div></aside><div></div>`;
    return;
  }
  const block = project.blocks.find((b) => b.id === w.blockId)!;
  proxy = makeProxy(w);
  root.innerHTML = `
    <aside>
      <div class="panel">
        <h2>Walls</h2>
        <p class="hint">Walls are generated from the block footprints. Choose a wall to edit its openings.</p>
        <canvas class="chart" id="wall-locator"></canvas>
        <div class="wall-list" style="margin-top:.6rem">${project.blocks.map((b) => `<div class="eyebrow">${escapeHtml(b.name)}</div>
          ${wallsOfBlock(b).map((x) => {
            const n = project.openings.filter((o) => o.wallId === x.id).length;
            return `<button data-wall="${x.id}" aria-current="${x.id === w.id}">${escapeHtml(wallDescription(project, x).replace(`${b.name}, `, ""))}<small>${fmt(x.length, 1)} metres long; ${n} opening${n === 1 ? "" : "s"}</small></button>`;
          }).join("")}`).join("")}</div>
      </div>
    </aside>
    <div>
      <div class="panel">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;gap:1rem">
          <h2 style="margin:0">Elevation: ${escapeHtml(wallDescription(project, w))}</h2><div class="status site-status"></div>
        </div>
        <p class="hint" style="margin-bottom:.4rem">${fmt(w.length, 2)} metres long, ${fmt(w.top - w.base, 2)} metres high (from ${fmt(w.base, 2)} to ${fmt(w.top, 2)} metres above ground); fire compartment: ${escapeHtml(compName(w.compartmentId))}. Seen from outside; horizontal positions run from the left end of the wall.</p>
        <div class="tools" role="toolbar" aria-label="Opening type to draw">
          ${(Object.keys(OPENING_TYPES) as OpeningType[]).map((t) => `<button data-site-tool="${t}" aria-pressed="${t === openingTool}">
            <span class="swatch" style="background:${OPENING_STYLE[t].fill};border-color:${OPENING_STYLE[t].stroke}"></span>${OPENING_TYPES[t].label}${t === "combustibleCladding" ? " (half its area)" : ""}</button>`).join("")}
        </div>
        <p class="hint">Click and drag to draw an opening; drag to move it, drag a corner to resize it and press Delete to remove it. Dashed lines are floor levels.</p>
        <div class="editor-wrap"><canvas class="editor" id="site-elevation"></canvas></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:.9rem">
          <h3>Openings on this wall</h3>
          <button class="button primary small" id="site-add-opening">Add opening</button>
        </div>
        <div id="site-openings-table"></div>
      </div>
      <div class="panel"><h2>This wall in the results</h2><div id="site-wall-results"></div></div>
    </div>`;
  root.querySelectorAll<HTMLButtonElement>("[data-wall]").forEach((b) => b.addEventListener("click", () => {
    project.activeWallId = b.dataset.wall; selectedOpeningId = null; save(); renderElevationsTab();
  }));
  root.querySelectorAll<HTMLButtonElement>("[data-site-tool]").forEach((b) => b.addEventListener("click", () => {
    openingTool = b.dataset.siteTool as OpeningType;
    root.querySelectorAll<HTMLButtonElement>("[data-site-tool]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    const sel = proxy?.openings.find((o) => o.id === selectedOpeningId);
    if (sel) { sel.type = openingTool; syncProxy(); renderOpeningsTable(); elev?.draw(); changed(); }
  }));
  $("#site-add-opening")!.addEventListener("click", () => {
    if (!proxy) return;
    const f = proxy, ow = Math.min(2, f.width), oh = Math.min(2, f.height);
    const o: SiteOpening = { id: newId(), wallId: f.id, type: openingTool, xMin: 0, xMax: ow, zMin: 0, zMax: oh, setback: 0 };
    outer: for (let z = 1; z + oh <= f.height; z += 0.5) for (let x = 0.5; x + ow <= f.width; x += 0.5) {
      if (!f.openings.some((q) => x < q.xMax && x + ow > q.xMin && z < q.zMax && z + oh > q.zMin)) { Object.assign(o, { xMin: x, xMax: x + ow, zMin: z, zMax: z + oh }); break outer; }
    }
    f.openings.push(o); selectedOpeningId = o.id; syncProxy(); renderOpeningsTable(); elev?.draw(); changed();
  });
  const guides: { z: number; label: string }[] = [];
  for (let k = 1; k < block.storeys; k++) guides.push({ z: k * block.storeyHeight, label: `Floor ${k + 1}` });
  elev = new ElevationEditor($<HTMLCanvasElement>("#site-elevation")!, {
    getFacade: () => proxy!,
    getTool: () => openingTool,
    getSelected: () => selectedOpeningId,
    select: (id) => { selectedOpeningId = id; renderOpeningsTable(); },
    changed: (final) => { syncProxy(); if (final) { renderOpeningsTable(); changed(); refreshWallList(); } else scheduleTableValues(); },
    newId: () => newId(),
    getGuides: () => guides,
    axisLabels: { x: "Along the wall from its left end (metres)", z: "Height above the base of the block (metres)" },
  });
  elev.resize(Math.max(320, root.querySelector<HTMLElement>(".editor-wrap")!.clientWidth || 800));
  drawLocator(w);
  renderOpeningsTable();
  renderWallResults();
}

function refreshWallList() {
  document.querySelectorAll<HTMLButtonElement>("#tab-elevations [data-wall]").forEach((b) => {
    const x = allWalls(project).find((q) => q.id === b.dataset.wall);
    const small = b.querySelector("small");
    if (x && small) { const n = project.openings.filter((o) => o.wallId === x.id).length; small.textContent = `${fmt(x.length, 1)} metres long; ${n} opening${n === 1 ? "" : "s"}`; }
  });
}

function drawLocator(w: Wall) {
  const canvas = $<HTMLCanvasElement>("#wall-locator");
  if (!canvas) return;
  const width = Math.max(240, canvas.parentElement?.clientWidth ? canvas.parentElement.clientWidth - 2 : 290);
  const height = 220;
  const at = drawPlanStatic(canvas, project, null, width, height);
  const ctx = canvas.getContext("2d")!;
  const dpr = canvas.width / width;
  ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.strokeStyle = "#cc1f1d"; ctx.lineWidth = 4; ctx.lineCap = "round";
  const [sx, sy] = at(w.start[0], w.start[1]), [ex, ey] = at(w.end[0], w.end[1]);
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
  const mx = (w.start[0] + w.end[0]) / 2, my = (w.start[1] + w.end[1]) / 2;
  const [ax, ay] = at(mx, my), [bx, by] = at(mx + w.normal[0] * 3, my + w.normal[1] * 3);
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  ctx.restore();
}

let tableFrame = 0;
/** While dragging, update the numbers in the existing rows once per frame instead of rebuilding the table. */
function scheduleTableValues() {
  if (tableFrame) return;
  tableFrame = requestAnimationFrame(() => {
    tableFrame = 0;
    const el = $("#site-openings-table");
    if (!el || !proxy) return;
    const rows = el.querySelectorAll<HTMLTableRowElement>("tr[data-id]");
    if (rows.length !== proxy.openings.length) { renderOpeningsTable(); return; }
    proxy.openings.forEach((o, i) => {
      const row = rows[i];
      if (row.dataset.id !== o.id) return;
      row.querySelectorAll<HTMLInputElement>("input[data-field]").forEach((inp) => { const v = String(+(o as unknown as Record<string, number>)[inp.dataset.field!].toFixed(3)); if (inp.value !== v) inp.value = v; });
      const cells = row.querySelectorAll<HTMLTableCellElement>("td.area");
      if (cells[0]) cells[0].textContent = openingArea(o).toFixed(2);
      if (cells[1]) cells[1].textContent = (openingArea(o) * openingFraction(o)).toFixed(2);
    });
  });
}

function renderOpeningsTable() {
  const el = $("#site-openings-table");
  if (!el || !proxy) return;
  const f = proxy;
  if (!f.openings.length) { el.innerHTML = `<p class="hint">No openings on this wall. Draw one on the elevation or use the button above.</p>`; return; }
  const focusKey = (document.activeElement as HTMLElement | null)?.dataset.key;
  el.innerHTML = `<div class="table-scroll"><table class="data">
    <thead><tr><th>Type</th><th>Left edge (metres)</th><th>Right edge (metres)</th><th>Bottom (metres)</th><th>Top (metres)</th><th>Set back (metres)</th><th>Area (square metres)</th><th>Unprotected area (square metres)</th><th>Diagram 13.5</th><th></th></tr></thead>
    <tbody>${f.openings.map((o) => `
      <tr data-id="${o.id}" aria-selected="${o.id === selectedOpeningId}">
        <td><select data-key="${o.id}-type" data-field="type">${(Object.keys(OPENING_TYPES) as OpeningType[]).map((t) => `<option value="${t}" ${t === o.type ? "selected" : ""}>${OPENING_TYPES[t].label}</option>`).join("")}</select></td>
        ${(["xMin", "xMax", "zMin", "zMax", "setback"] as const).map((k) => `<td><input class="num" type="number" step="0.1" data-key="${o.id}-${k}" data-field="${k}" value="${+o[k].toFixed(3)}" /></td>`).join("")}
        <td class="num area">${openingArea(o).toFixed(2)}</td><td class="num area">${(openingArea(o) * openingFraction(o)).toFixed(2)}</td>
        <td>${smallAreaBadge(o.id)}</td>
        <td><button class="button ghost small danger" data-delete="${o.id}">Delete</button></td></tr>`).join("")}</tbody></table></div>`;
  el.querySelectorAll<HTMLTableRowElement>("tr[data-id]").forEach((row) => row.addEventListener("focusin", () => {
    if (selectedOpeningId !== row.dataset.id) {
      selectedOpeningId = row.dataset.id!;
      el.querySelectorAll("tr[data-id]").forEach((r) => r.setAttribute("aria-selected", String(r === row)));
      elev?.draw();
    }
  }));
  el.querySelectorAll<HTMLInputElement | HTMLSelectElement>("[data-field]").forEach((input) => input.addEventListener("change", () => {
    const o = f.openings.find((q) => q.id === input.closest("tr")!.dataset.id);
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
    syncProxy(); renderOpeningsTable(); elev?.draw(); changed();
  }));
  el.querySelectorAll<HTMLButtonElement>("[data-delete]").forEach((b) => b.addEventListener("click", () => {
    f.openings = f.openings.filter((o) => o.id !== b.dataset.delete);
    if (selectedOpeningId === b.dataset.delete) selectedOpeningId = null;
    syncProxy(); renderOpeningsTable(); elev?.draw(); changed(); refreshWallList();
  }));
  if (focusKey) el.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
}

function smallAreaBadge(id: string): string {
  const x = results?.smallAreas.find((q) => q.openingId === id);
  if (!x) return `<span class="hint">Counted</span>`;
  return x.ignored ? `<span class="badge na">Excluded (small area)</span><div class="hint">${escapeHtml(x.reason)}</div>` : `<span class="hint">Small area, counted: ${escapeHtml(x.reason)}</span>`;
}

function renderWallResults() {
  const el = $("#site-wall-results");
  if (!el) return;
  renderStatus();
  const w = activeWall();
  if (!results || !w) { el.innerHTML = `<p class="hint">Calculating…</p>`; return; }
  const c = results.compartments.find((x) => x.id === w.compartmentId);
  const face = c?.faces.find((f) => f.wallId === w.id);
  const share = results.worst.contributions.filter((x) => x.wallId === w.id).reduce((a, x) => a + x.share, 0);
  const near = results.withinOneMetre.find((x) => x.wallId === w.id);
  if (near) { el.innerHTML = `<div class="verdict na"><div class="mark">–</div><div><div class="title">Not applicable: within 1 metre of the boundary</div><div class="sub">${fmtUp(near.distance, 2)} metres from ${escapeHtml(boundaryName(near.boundaryId))}. ${escapeHtml(PARAGRAPH_13_8)} ${near.diagram135 ? "The openings on this wall meet the small-area rules." : escapeHtml(near.issues.join("; "))}</div></div></div>`; return; }
  el.innerHTML = face && c ? `<table class="data kv">
      <tr><th>Peak received intensity from this wall alone</th><td class="num">${up(face.peakAlone)} kilowatts per square metre</td></tr>
      <tr><th>Scaling factor for this wall alone</th><td class="num">${down(face.scalingAlone)}</td></tr>
      <tr><th>Peak for the whole compartment "${escapeHtml(c.name)}"</th><td class="num">${up(c.peak)} kilowatts per square metre (${c.passes ? "pass" : "fail"})</td></tr>
      <tr><th>Maximum unprotected area on this wall at the compartment scaling factor</th><td class="num">${down(face.permittedUniform)} square metres (now ${fmt(face.unprotectedArea)})</td></tr>
      <tr><th>Share of the governing intensity</th><td class="num">${(100 * share).toFixed(1)}%</td></tr>
    </table>${isStale() ? `<p class="hint">Recalculating…</p>` : ""}`
    : `<p class="hint">This wall has no openings, or no point on any boundary can see it.</p>`;
}

// ---------------------------------------------------------------- three-dimensional view
function render3DTab() {
  const root = $("#tab-site3d")!;
  if (!root.dataset.built) {
    root.dataset.built = "1";
    root.innerHTML = `<div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;gap:1rem">
        <h2 style="margin:0">Three-dimensional view</h2><div class="status site-status"></div></div>
      <p class="hint">Drag to orbit, right-drag to pan and scroll to zoom. On a touch screen, drag with one finger to orbit and pinch or drag with two fingers to zoom and pan. The vertical surface standing on each boundary is coloured by the worst received intensity at each point and height (over all fire compartments); pale grey means no receiver, for example above the roof in the mirror-image approach. The red sphere is the governing point on the boundary and the navy sphere the receiver used there.</p>
      <div id="site-view3d"></div>
      <canvas class="chart" id="site-view3d-legend" style="margin-top:.6rem"></canvas>
      <div class="view-legend">${SITE_VIEW_LEGEND.map((l) => `<span style="--c:${l.colour}">${l.label}</span>`).join("")}</div>
    </div>`;
    view3d = new SiteView3D($("#site-view3d")!);
    window.addEventListener("resize", () => { if (tab === "site3d") view3d?.resize(); });
  }
  view3d!.update(project, results, project.activeWallId);
  view3d!.resize();
  drawLegend($<HTMLCanvasElement>("#site-view3d-legend")!, Math.min(700, Math.max(320, root.clientWidth - 60)));
}

// ---------------------------------------------------------------- results tab
function renderResultsTab() {
  const root = $("#tab-results")!;
  renderStatus();
  if (!results) { root.innerHTML = `<div class="panel"><h2>Results</h2><p class="hint">Calculating…</p></div>`; return; }
  const r = results, w = r.worst;
  root.innerHTML = `
    <div class="panel">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:.5rem;gap:1rem"><h2 style="margin:0">Results</h2><div class="status site-status"></div></div>
      ${verdictCard(r)}
      <p>Highest intensity ${up(w.peak)} kilowatts per square metre against a limit of ${fmt(r.limit, 1)}, from "${escapeHtml(compName(w.compartmentId))}"${w.boundaryId ? ` on ${escapeHtml(boundaryName(w.boundaryId))}, ${fmt(w.chainage, 2)} metres from its first point and ${fmt(w.z, 2)} metres above ground` : ""}.</p>
      <p class="hint">${APPROACH_LABELS[r.approach]}; ${ORIENTATION_LABELS[r.orientation].toLowerCase()}; ${escapeHtml(sprinklerText(project).toLowerCase())}; shielding ${project.settings.shielding === "ignore" ? "ignored (conservative)" : `approximated${r.shieldingStatus ? ` (${escapeHtml(r.shieldingStatus)})` : ""}`}.</p>
      <h3 style="margin-top:.8rem">Boundaries</h3>
      <div class="table-scroll"><table class="data"><thead><tr><th>Boundary</th><th>Type</th><th>Peak (kilowatts per square metre)</th><th>Result</th><th>Uniform offset of the whole line to just meet the limit</th></tr></thead><tbody>
      ${r.boundaries.map((b) => `<tr><td>${escapeHtml(b.name)}</td><td>${b.kind === "relevant" ? "Relevant" : "Notional"}</td><td class="num">${up(b.peak)}</td><td><span class="badge ${b.passes ? "pass" : "fail"}">${b.passes ? "Pass" : "Fail"}</span></td><td>${escapeHtml(offsetText(b.requiredOffset))}</td></tr>`).join("")}</tbody></table>
      <h3 style="margin-top:.8rem">Fire compartments (each burns on its own)</h3>
      <div class="table-scroll"><table class="data"><thead><tr><th>Compartment</th><th>Source (kilowatts per square metre)</th><th>Unprotected area (square metres)</th><th>Peak (kilowatts per square metre)</th><th>Location of the peak</th><th>Scaling factor</th><th>Maximum unprotected area (square metres)</th><th>Result</th></tr></thead><tbody>
      ${r.compartments.map((c) => `<tr><td>${escapeHtml(c.name)}</td><td class="num">${c.sourceIntensity}</td><td class="num">${fmt(c.unprotectedArea)}</td><td class="num">${up(c.peak)}</td>
        <td>${c.location ? `${escapeHtml(boundaryName(c.location.boundaryId))}, ${fmt(c.location.chainage, 1)} metres along, ${fmt(c.location.z, 1)} metres up` : "not seen from any boundary"}</td>
        <td class="num">${down(c.scaling)}</td><td class="num">${down(c.permittedArea)}</td><td><span class="badge ${c.passes ? "pass" : "fail"}">${c.passes ? "Pass" : "Fail"}</span></td></tr>`).join("")}</tbody></table>
      <p class="hint">Scaling factor = limit ÷ peak. Every unprotected area of the compartment could be multiplied by this factor, keeping the layout, and just meet the limit.</p>
    </div>
    <div class="panel">
      <h2>Checks needing judgement</h2>${reviewSections(r)}
    </div>
    <div class="panel">
      <h2>Faces of each compartment</h2>
      ${r.compartments.map((c) => `<h3 style="margin-top:.6rem">${escapeHtml(c.name)}</h3>${c.faces.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>Face</th><th>Face area (square metres)</th><th>Unprotected area (square metres)</th><th>Peak from this face alone (kilowatts per square metre)</th><th>Scaling factor, this face alone</th><th>Maximum unprotected area at the compartment scaling (square metres)</th></tr></thead><tbody>
        ${c.faces.map((f) => f.withinOneMetre ? `<tr><td>${escapeHtml(f.label)}</td><td class="num">${fmt(f.faceArea, 1)}</td><td class="num">${fmt(f.unprotectedArea)}</td><td colspan="3">Not applicable: within 1 metre of the boundary (${fmtUp(f.withinOneMetre.distance, 2)} metres from ${escapeHtml(boundaryName(f.withinOneMetre.boundaryId))}); see paragraph 13.8</td></tr>` : `<tr><td>${escapeHtml(f.label)}</td><td class="num">${fmt(f.faceArea, 1)}</td><td class="num">${fmt(f.unprotectedArea)}</td><td class="num">${up(f.peakAlone)}</td><td class="num">${down(f.scalingAlone)}</td><td class="num">${down(f.permittedUniform)}</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">No openings.</p>`}`).join("")}
    </div>
    <div class="panel">
      <h2>Openings governing the highest intensity</h2>
      ${w.contributions.length ? `<div class="table-scroll"><table class="data"><thead><tr><th>Opening</th><th>Type</th><th>Contribution (kilowatts per square metre)</th><th>Share</th></tr></thead><tbody>
      ${w.contributions.slice(0, 15).map((c) => `<tr><td>${escapeHtml(c.label)}</td><td>${OPENING_TYPES[c.type as OpeningType]?.label ?? c.type}</td><td class="num">${up(c.intensity)}</td><td class="num">${(100 * c.share).toFixed(1)}%</td></tr>`).join("")}</tbody></table></div>` : `<p class="hint">None.</p>`}
      ${r.warnings.length ? `<h3 style="margin-top:.8rem">Warnings</h3><ul class="warnings">${r.warnings.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : ""}
    </div>`;
}

// ---------------------------------------------------------------- report
function chartUrl(draw: (c: HTMLCanvasElement) => void): string {
  const c = document.createElement("canvas");
  draw(c);
  return c.toDataURL("image/png");
}

function renderReportTab() {
  const root = $("#tab-report")!;
  const ready = !!results && !isStale() && !computing;
  let images = null;
  if (results) {
    const r = results;
    if (!snapView) {
      const host = document.createElement("div");
      host.style.cssText = "position:fixed;left:-10000px;top:0;width:960px;height:560px";
      document.body.appendChild(host);
      snapView = new SiteView3D(host);
    }
    const names = Object.fromEntries(project.compartments.map((c) => [c.id, c.name]));
    images = {
      plan: chartUrl((c) => drawPlanStatic(c, project, r, 900, 560)),
      view3d: snapView.snapshot(project, r, 960, 560),
      legend: chartUrl((c) => drawLegend(c, 820)),
      profiles: r.boundaries.map((b) => ({ name: b.name, url: chartUrl((c) => drawBoundaryProfile(c, r, b, names, 820, 260)) })),
      elevations: allWalls(project).filter((w) => project.openings.some((o) => o.wallId === w.id))
        .map((w) => ({ label: wallDescription(project, w), url: chartUrl((c) => drawElevationStatic(c, makeProxy(w), 820)) })),
    };
  }
  renderSiteReport(root, project, results, ready, images, () => window.print());
}

window.addEventListener("resize", () => {
  if (tab === "plan" && !$("#tab-plan")!.hidden) { plan?.resize(planWidth()); renderSummary(); }
  if (tab === "elevations" && !$("#tab-elevations")!.hidden && proxy) elev?.resize(Math.max(320, $("#tab-elevations .editor-wrap")?.clientWidth ?? 800));
});

scheduleCompute(0);
