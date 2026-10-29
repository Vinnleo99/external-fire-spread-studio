/**
 * Site plan editor: pan and zoom, grid snapping, drawing boundary lines and block footprints, dragging and inserting
 * vertices, and the results strip along each boundary.
 */
import { BoundaryLine, Point2, SiteProject, blockTop, wallsOfBlock } from "../engine/site";
import { SiteResults } from "../engine/siteAssessment";
import { setupCanvas } from "../ui/charts";
import { PALETTE, heatColour } from "../ui/colours";

export type PlanTool = "select" | "boundary" | "notional" | "block" | "rectangle";
export type Selection = { kind: "block" | "boundary"; id: string } | null;

export interface PlanCallbacks {
  getProject(): SiteProject;
  getResults(): SiteResults | null;
  getTool(): PlanTool;
  setTool(t: PlanTool): void;
  getSelection(): Selection;
  select(s: Selection): void;
  /** Geometry changed; `final` is true when the gesture ends. */
  changed(final: boolean, detail?: { kind: "insertVertex" | "deleteVertex"; blockId: string; index: number }): void;
  newId(prefix: string): string;
  status(text: string): void;
}

const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";
const BLOCK_FILLS = ["rgba(0,43,73,0.10)", "rgba(0,107,166,0.16)", "rgba(0,107,166,0.26)", "rgba(0,43,73,0.30)", "rgba(0,43,73,0.40)"];

type Drag =
  | { kind: "none" }
  | { kind: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { kind: "vertex"; target: "block" | "boundary"; id: string; index: number }
  | { kind: "rectangle"; x0: number; y0: number; x1: number; y1: number };

export class PlanEditor {
  private ctx!: CanvasRenderingContext2D;
  private width = 800;
  private height = 560;
  private scale = 10; // pixels per metre
  private ox = 400; // screen position of world x = 0
  private oy = 300; // screen position of world y = 0
  private drag: Drag = { kind: "none" };
  private draft: Point2[] = [];
  private hover: Point2 | null = null;
  private selectedVertex: { target: "block" | "boundary"; id: string; index: number } | null = null;
  private fitted = false;
  /** Larger hit targets for a finger than for a mouse. */
  private touchScale = 1;
  /** Active touch points, for two-finger pinch and pan. */
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch: { dist: number; cx: number; cy: number; scale: number; ox: number; oy: number } | null = null;
  private lastTap = { t: 0, x: 0, y: 0 };

  constructor(private canvas: HTMLCanvasElement, private cb: PlanCallbacks) {
    canvas.tabIndex = 0;
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
    canvas.addEventListener("dblclick", (e) => this.dbl(e));
    canvas.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("keydown", (e) => this.key(e));
  }

  resize(width: number, height = Math.max(420, Math.min(680, width * 0.62))) {
    this.width = width; this.height = height;
    this.ctx = setupCanvas(this.canvas, width, height);
    if (!this.fitted) this.fit();
    this.draw();
  }

  /** Frame all blocks and boundaries. */
  fit() {
    const p = this.cb.getProject();
    const pts: Point2[] = [...p.blocks.flatMap((b) => b.footprint), ...p.boundaries.flatMap((b) => b.points)];
    if (!pts.length) pts.push([0, 0], [30, 20]);
    const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const w = Math.max(10, maxX - minX), h = Math.max(10, maxY - minY);
    this.scale = Math.min((this.width - 80) / w, (this.height - 80) / h);
    this.ox = this.width / 2 - ((minX + maxX) / 2) * this.scale;
    this.oy = this.height / 2 + ((minY + maxY) / 2) * this.scale;
    this.fitted = true;
    this.draw();
  }

  cancelDraft() { this.draft = []; this.draw(); }

  /** Screen position (CSS pixels) of a world point. */
  screenOf(x: number, y: number): [number, number] { return this.toScreen(x, y); }

  private toScreen(x: number, y: number): [number, number] { return [this.ox + x * this.scale, this.oy - y * this.scale]; }
  private toWorld(e: PointerEvent | MouseEvent | WheelEvent): [number, number] {
    const r = this.canvas.getBoundingClientRect();
    return [(e.clientX - r.left - this.ox) / this.scale, (this.oy - (e.clientY - r.top)) / this.scale];
  }
  private snap(p: [number, number], e: { altKey: boolean }): Point2 {
    const s = this.cb.getProject().settings.snap;
    if (e.altKey || !(s > 0)) return [round(p[0]), round(p[1])];
    return [round(Math.round(p[0] / s) * s), round(Math.round(p[1] / s) * s)];
  }

  private vertexAt(x: number, y: number): { target: "block" | "boundary"; id: string; index: number } | null {
    const p = this.cb.getProject();
    const tol = (8 * this.touchScale) / this.scale;
    const sel = this.cb.getSelection();
    const lists: { target: "block" | "boundary"; id: string; pts: Point2[] }[] = [];
    // The selected object first, then everything else.
    if (sel?.kind === "block") { const b = p.blocks.find((q) => q.id === sel.id); if (b) lists.push({ target: "block", id: b.id, pts: b.footprint }); }
    if (sel?.kind === "boundary") { const b = p.boundaries.find((q) => q.id === sel.id); if (b) lists.push({ target: "boundary", id: b.id, pts: b.points }); }
    for (const l of lists) for (let i = 0; i < l.pts.length; i++) {
      if (Math.hypot(l.pts[i][0] - x, l.pts[i][1] - y) < tol) return { target: l.target, id: l.id, index: i };
    }
    return null;
  }

  private objectAt(x: number, y: number): Selection {
    const p = this.cb.getProject();
    const tol = (6 * this.touchScale) / this.scale;
    for (const b of p.boundaries) for (let i = 0; i + 1 < b.points.length; i++) {
      if (distanceToSegment([x, y], b.points[i], b.points[i + 1]) < tol) return { kind: "boundary", id: b.id };
    }
    const blocks = [...p.blocks].sort((a, b) => blockTop(b) - blockTop(a));
    for (const b of blocks) if (pointInPolygon(x, y, b.footprint)) return { kind: "block", id: b.id };
    return null;
  }

  private down(e: PointerEvent) {
    this.canvas.focus();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* Not an active pointer (for example a synthetic event). */ }
    this.touchScale = e.pointerType === "touch" ? 2.5 : 1;
    if (e.pointerType === "touch") {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pointers.size === 2) {
        // A second finger: cancel any single-finger action and start a pinch.
        if (this.drag.kind === "rectangle" || this.drag.kind === "vertex") this.cb.changed(true);
        this.drag = { kind: "none" };
        const [a, b] = [...this.pointers.values()];
        const r = this.canvas.getBoundingClientRect();
        this.pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2 - r.left, cy: (a.y + b.y) / 2 - r.top, scale: this.scale, ox: this.ox, oy: this.oy };
        return;
      }
      // Double tap acts as a double-click (finish a line, or add a point on the selected item).
      const now = performance.now();
      if (now - this.lastTap.t < 350 && Math.hypot(e.clientX - this.lastTap.x, e.clientY - this.lastTap.y) < 24) {
        this.lastTap.t = 0;
        this.dbl(e);
        return;
      }
      this.lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
    const tool = this.cb.getTool();
    const [x, y] = this.toWorld(e);
    if (e.button === 1 || e.button === 2 || (e.button === 0 && e.shiftKey && tool === "select")) {
      this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: this.ox, oy: this.oy };
      return;
    }
    if (tool === "select") {
      const v = this.vertexAt(x, y);
      if (v) { this.selectedVertex = v; this.drag = { kind: "vertex", ...v }; this.draw(); return; }
      this.selectedVertex = null;
      const hit = this.objectAt(x, y);
      this.cb.select(hit);
      if (!hit) this.drag = { kind: "pan", sx: e.clientX, sy: e.clientY, ox: this.ox, oy: this.oy };
      this.draw();
      return;
    }
    const pt = this.snap([x, y], e);
    if (tool === "rectangle") { this.drag = { kind: "rectangle", x0: pt[0], y0: pt[1], x1: pt[0], y1: pt[1] }; return; }
    // Polyline or polygon drawing: add a point per click.
    const last = this.draft[this.draft.length - 1];
    if (!last || Math.hypot(last[0] - pt[0], last[1] - pt[1]) > 1e-9) this.draft.push(pt);
    if (tool === "block" && this.draft.length >= 3) {
      const first = this.draft[0];
      if (Math.hypot(first[0] - pt[0], first[1] - pt[1]) < 1e-9 && this.draft.length > 3) { this.draft.pop(); this.finish(); return; }
    }
    this.cb.status(this.drawHint());
    this.draw();
  }

  private drawHint(): string {
    const tool = this.cb.getTool();
    const n = this.draft.length;
    if (tool === "block") return n < 3 ? `Footprint: ${n} point${n === 1 ? "" : "s"}. Click to add corners; double-click (double-tap on a touch screen) or press Enter to close.` : `Footprint: ${n} points. Double-click, press Enter or click the first point to close.`;
    return `Line: ${n} point${n === 1 ? "" : "s"}. Click to add points; double-click (double-tap on a touch screen) or press Enter to finish; Escape cancels.`;
  }

  private move(e: PointerEvent) {
    if (e.pointerType === "touch" && this.pointers.has(e.pointerId)) {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.pinch && this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const r = this.canvas.getBoundingClientRect();
        const pc = this.pinch;
        const scale = Math.min(200, Math.max(1, pc.scale * Math.hypot(a.x - b.x, a.y - b.y) / pc.dist));
        const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
        // Keep the world point under the starting centre under the current centre.
        const wx = (pc.cx - pc.ox) / pc.scale, wy = (pc.oy - pc.cy) / pc.scale;
        this.scale = scale; this.ox = cx - wx * scale; this.oy = cy + wy * scale;
        this.draw();
        return;
      }
    }
    const [x, y] = this.toWorld(e);
    this.hover = this.snap([x, y], e);
    const d = this.drag;
    if (d.kind === "pan") {
      this.ox = d.ox + (e.clientX - d.sx); this.oy = d.oy + (e.clientY - d.sy);
    } else if (d.kind === "vertex") {
      const p = this.cb.getProject();
      const pts = d.target === "block" ? p.blocks.find((b) => b.id === d.id)?.footprint : p.boundaries.find((b) => b.id === d.id)?.points;
      if (pts) { pts[d.index] = this.snap([x, y], e); this.cb.changed(false); }
    } else if (d.kind === "rectangle") {
      const pt = this.snap([x, y], e); d.x1 = pt[0]; d.y1 = pt[1];
    } else {
      const tool = this.cb.getTool();
      this.canvas.style.cursor = tool === "select" ? (this.vertexAt(x, y) ? "move" : this.objectAt(x, y) ? "pointer" : "grab") : "crosshair";
    }
    this.draw();
  }

  private up(e: PointerEvent) {
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    this.pointers.delete(e.pointerId);
    if (this.pinch) { if (this.pointers.size < 2) this.pinch = null; this.drag = { kind: "none" }; this.draw(); return; }
    const d = this.drag;
    this.drag = { kind: "none" };
    if (d.kind === "vertex") this.cb.changed(true);
    if (d.kind === "rectangle") {
      const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1), y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
      if (x1 - x0 >= 1 && y1 - y0 >= 1) {
        this.draft = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
        this.finish("block");
      }
    }
    this.draw();
  }

  private dbl(e: MouseEvent) {
    const tool = this.cb.getTool();
    if (tool === "boundary" || tool === "notional" || tool === "block") { this.finish(); return; }
    // Select tool: double-click on an edge of the selected object inserts a vertex.
    const sel = this.cb.getSelection();
    if (!sel) return;
    const [x, y] = this.toWorld(e);
    const pt = this.snap([x, y], e);
    const p = this.cb.getProject();
    const closed = sel.kind === "block";
    const pts = sel.kind === "block" ? p.blocks.find((b) => b.id === sel.id)?.footprint : p.boundaries.find((b) => b.id === sel.id)?.points;
    if (!pts) return;
    const tol = (8 * this.touchScale) / this.scale;
    const n = closed ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (distanceToSegment([x, y], a, b) < tol) {
        pts.splice(i + 1, 0, pt);
        this.selectedVertex = { target: sel.kind, id: sel.id, index: i + 1 };
        this.cb.changed(true, sel.kind === "block" ? { kind: "insertVertex", blockId: sel.id, index: i } : undefined);
        this.draw();
        return;
      }
    }
  }

  private finish(forced?: "block") {
    const tool = forced ?? this.cb.getTool();
    const p = this.cb.getProject();
    // A double-click adds the same point twice; remove repeats.
    const pts = this.draft.filter((q, i, arr) => i === 0 || Math.hypot(q[0] - arr[i - 1][0], q[1] - arr[i - 1][1]) > 1e-9);
    this.draft = [];
    if (tool === "block" || tool === "rectangle") {
      if (pts.length >= 3) {
        const id = this.cb.newId("b");
        const base = p.blocks.find((b) => b.id === this.cb.getSelection()?.id);
        p.blocks.push({ id, name: `Block ${p.blocks.length + 1}`, footprint: pts, base: 0, storeys: 1, storeyHeight: base?.storeyHeight ?? 3.5,
          compartmentId: base?.compartmentId ?? p.compartments[0]?.id ?? "" });
        this.cb.select({ kind: "block", id });
        this.cb.changed(true);
      }
    } else if (tool === "boundary" || tool === "notional") {
      if (pts.length >= 2) {
        const id = this.cb.newId("l");
        const line: BoundaryLine = { id, name: tool === "notional" ? `Notional boundary ${p.boundaries.filter((b) => b.kind === "notional").length + 1}` : `Relevant boundary ${p.boundaries.filter((b) => b.kind === "relevant").length + 1}`,
          kind: tool === "notional" ? "notional" : "relevant", points: pts };
        p.boundaries.push(line);
        this.cb.select({ kind: "boundary", id });
        this.cb.changed(true);
      }
    }
    this.cb.setTool("select");
    this.cb.status("");
    this.draw();
  }

  private wheel(e: WheelEvent) {
    e.preventDefault();
    const [x, y] = this.toWorld(e);
    const factor = Math.exp(-e.deltaY * 0.0015);
    this.scale = Math.min(200, Math.max(1, this.scale * factor));
    const r = this.canvas.getBoundingClientRect();
    this.ox = e.clientX - r.left - x * this.scale;
    this.oy = e.clientY - r.top + y * this.scale;
    this.draw();
  }

  private key(e: KeyboardEvent) {
    if (e.key === "Escape") { this.draft = []; this.cb.setTool("select"); this.cb.status(""); this.draw(); return; }
    if (e.key === "Enter") { this.finish(); e.preventDefault(); return; }
    if ((e.key === "Delete" || e.key === "Backspace") && this.selectedVertex) {
      const v = this.selectedVertex;
      const p = this.cb.getProject();
      const pts = v.target === "block" ? p.blocks.find((b) => b.id === v.id)?.footprint : p.boundaries.find((b) => b.id === v.id)?.points;
      const min = v.target === "block" ? 3 : 2;
      if (pts && pts.length > min) {
        pts.splice(v.index, 1);
        this.selectedVertex = null;
        this.cb.changed(true, v.target === "block" ? { kind: "deleteVertex", blockId: v.id, index: v.index } : undefined);
      } else this.cb.status(`A ${v.target === "block" ? "footprint needs at least three" : "line needs at least two"} points.`);
      e.preventDefault();
      this.draw();
    }
  }

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx, p = this.cb.getProject(), r = this.cb.getResults(), sel = this.cb.getSelection();
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.fillStyle = "#fbfcfc"; ctx.fillRect(0, 0, this.width, this.height);
    // Grid.
    const step = this.scale >= 12 ? 1 : this.scale >= 4 ? 5 : 10;
    const major = step === 1 ? 5 : step * 5;
    const [wx0, wy1] = [(0 - this.ox) / this.scale, (this.oy - 0) / this.scale];
    const [wx1, wy0] = [(this.width - this.ox) / this.scale, (this.oy - this.height) / this.scale];
    ctx.lineWidth = 1;
    for (let x = Math.floor(wx0 / step) * step; x <= wx1; x += step) {
      const [sx] = this.toScreen(x, 0);
      ctx.strokeStyle = Math.abs(x % major) < 1e-9 ? "#dfe2e2" : "#eef0f0";
      ctx.beginPath(); ctx.moveTo(Math.round(sx) + 0.5, 0); ctx.lineTo(Math.round(sx) + 0.5, this.height); ctx.stroke();
    }
    for (let y = Math.floor(wy0 / step) * step; y <= wy1; y += step) {
      const [, sy] = this.toScreen(0, y);
      ctx.strokeStyle = Math.abs(y % major) < 1e-9 ? "#dfe2e2" : "#eef0f0";
      ctx.beginPath(); ctx.moveTo(0, Math.round(sy) + 0.5); ctx.lineTo(this.width, Math.round(sy) + 0.5); ctx.stroke();
    }
    // Blocks, lowest first.
    const blocks = [...p.blocks].sort((a, b) => a.base - b.base || blockTop(a) - blockTop(b));
    blocks.forEach((b) => {
      if (b.footprint.length < 2) return;
      const level = Math.min(BLOCK_FILLS.length - 1, p.blocks.filter((q) => q.base < b.base - 1e-9).length > 0 ? 1 + blocks.filter((q) => q.base < b.base - 1e-9).length : 0);
      ctx.beginPath();
      b.footprint.forEach(([x, y], i) => { const [sx, sy] = this.toScreen(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      ctx.closePath();
      ctx.fillStyle = BLOCK_FILLS[level];
      ctx.fill();
      const selected = sel?.kind === "block" && sel.id === b.id;
      ctx.strokeStyle = selected ? PALETTE.blue : PALETTE.charcoal;
      ctx.lineWidth = selected ? 2.5 : 1.2;
      ctx.stroke();
    });
    // Openings as thick ticks on their walls, so that it is clear which faces have unprotected areas.
    for (const b of p.blocks) for (const w of wallsOfBlock(b)) {
      for (const o of p.openings.filter((q) => q.wallId === w.id)) {
        const s0 = Math.max(0, o.xMin), s1 = Math.min(w.length, o.xMax);
        const a = this.toScreen(w.start[0] + w.tangent[0] * s0 + w.normal[0] * 0.15, w.start[1] + w.tangent[1] * s0 + w.normal[1] * 0.15);
        const c = this.toScreen(w.start[0] + w.tangent[0] * s1 + w.normal[0] * 0.15, w.start[1] + w.tangent[1] * s1 + w.normal[1] * 0.15);
        ctx.strokeStyle = o.type === "combustibleCladding" ? "#9aa300" : o.type === "door" ? PALETTE.grey : PALETTE.blue;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.stroke();
      }
    }
    // Labels: block names and wall numbers of the selected block.
    ctx.font = `600 12px ${FONT}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (const b of p.blocks) {
      if (b.footprint.length < 3) continue;
      const [cx, cy] = centroid(b.footprint);
      const [sx, sy] = this.toScreen(cx, cy);
      ctx.fillStyle = PALETTE.navy;
      ctx.fillText(b.name, sx, sy - 7);
      ctx.font = `400 11px ${FONT}`; ctx.fillStyle = PALETTE.grey;
      ctx.fillText(`${b.base.toFixed(1)} to ${blockTop(b).toFixed(1)} metres`, sx, sy + 8);
      ctx.font = `600 12px ${FONT}`;
    }
    if (sel?.kind === "block") {
      const b = p.blocks.find((q) => q.id === sel.id);
      if (b) for (const w of wallsOfBlock(b)) {
        const mx = (w.start[0] + w.end[0]) / 2 + w.normal[0] * (14 / this.scale), my = (w.start[1] + w.end[1]) / 2 + w.normal[1] * (14 / this.scale);
        const [sx, sy] = this.toScreen(mx, my);
        ctx.fillStyle = PALETTE.blue; ctx.beginPath(); ctx.arc(sx, sy, 9, 0, 2 * Math.PI); ctx.fill();
        ctx.fillStyle = "#fff"; ctx.font = `600 10px ${FONT}`; ctx.fillText(String(w.edge + 1), sx, sy + 0.5);
      }
    }
    // Result strips along the boundaries.
    if (r) for (const br of r.boundaries) {
      const st = br.stations;
      for (let i = 0; i + 1 < st.length; i++) {
        if (Math.hypot(st[i + 1].x - st[i].x, st[i + 1].y - st[i].y) < 1e-9) continue;
        const v = Math.max(br.stationPeak[i], br.stationPeak[i + 1]);
        const [cr, cg, cb] = heatColour(v);
        const a = this.toScreen(st[i].x, st[i].y), c = this.toScreen(st[i + 1].x, st[i + 1].y);
        // Offset the strip to the far side of the line from the building.
        const ox = -st[i].nx * 7, oy = st[i].ny * 7;
        ctx.strokeStyle = `rgb(${cr},${cg},${cb})`; ctx.lineWidth = 8; ctx.lineCap = "butt";
        ctx.beginPath(); ctx.moveTo(a[0] + ox, a[1] + oy); ctx.lineTo(c[0] + ox, c[1] + oy); ctx.stroke();
      }
    }
    // Boundary lines.
    for (const b of p.boundaries) {
      const selected = sel?.kind === "boundary" && sel.id === b.id;
      ctx.strokeStyle = selected ? PALETTE.blue : b.kind === "notional" ? PALETTE.charcoal : PALETTE.navy;
      ctx.lineWidth = selected ? 3 : 2;
      ctx.setLineDash(b.kind === "notional" ? [8, 5] : []);
      ctx.beginPath();
      b.points.forEach(([x, y], i) => { const [sx, sy] = this.toScreen(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      ctx.stroke();
      ctx.setLineDash([]);
      if (b.points.length) {
        const [sx, sy] = this.toScreen(b.points[0][0], b.points[0][1]);
        ctx.font = `600 11px ${FONT}`; ctx.textAlign = "left"; ctx.fillStyle = selected ? PALETTE.blue : PALETTE.navy;
        ctx.fillText(b.name, sx + 6, sy - 10);
        ctx.textAlign = "center";
      }
    }
    // Vertex handles of the selected object.
    const handles = sel?.kind === "block" ? p.blocks.find((b) => b.id === sel.id)?.footprint : sel?.kind === "boundary" ? p.boundaries.find((b) => b.id === sel.id)?.points : undefined;
    handles?.forEach(([x, y], i) => {
      const [sx, sy] = this.toScreen(x, y);
      const active = this.selectedVertex && this.selectedVertex.id === sel!.id && this.selectedVertex.index === i;
      ctx.fillStyle = active ? PALETTE.blue : "#fff"; ctx.strokeStyle = PALETTE.blue; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.rect(sx - 4.5, sy - 4.5, 9, 9); ctx.fill(); ctx.stroke();
    });
    // Governing point.
    if (r?.worst.boundaryPoint) {
      const [sx, sy] = this.toScreen(r.worst.boundaryPoint[0], r.worst.boundaryPoint[1]);
      ctx.strokeStyle = PALETTE.red; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(sx - 7, sy - 7); ctx.lineTo(sx + 7, sy + 7); ctx.moveTo(sx + 7, sy - 7); ctx.lineTo(sx - 7, sy + 7); ctx.stroke();
    }
    // Drafts.
    const tool = this.cb.getTool();
    if (this.draft.length) {
      ctx.strokeStyle = PALETTE.blue; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
      ctx.beginPath();
      [...this.draft, ...(this.hover ? [this.hover] : [])].forEach(([x, y], i) => { const [sx, sy] = this.toScreen(x, y); if (i) ctx.lineTo(sx, sy); else ctx.moveTo(sx, sy); });
      if (tool === "block") ctx.closePath();
      ctx.stroke(); ctx.setLineDash([]);
      this.draft.forEach(([x, y]) => { const [sx, sy] = this.toScreen(x, y); ctx.fillStyle = PALETTE.blue; ctx.fillRect(sx - 3, sy - 3, 6, 6); });
    }
    if (this.drag.kind === "rectangle") {
      const d = this.drag;
      const [ax, ay] = this.toScreen(d.x0, d.y0), [bx, by] = this.toScreen(d.x1, d.y1);
      ctx.strokeStyle = PALETTE.blue; ctx.setLineDash([5, 4]); ctx.lineWidth = 2;
      ctx.strokeRect(Math.min(ax, bx), Math.min(ay, by), Math.abs(bx - ax), Math.abs(by - ay)); ctx.setLineDash([]);
    }
    // Cursor read-out, north arrow and scale bar.
    ctx.font = `400 11px ${FONT}`; ctx.textAlign = "left"; ctx.fillStyle = PALETTE.grey;
    if (this.hover) ctx.fillText(`x ${this.hover[0].toFixed(2)} metres, y ${this.hover[1].toFixed(2)} metres`, 10, this.height - 12);
    const nx = this.width - 30, ny = 34;
    ctx.fillStyle = PALETTE.navy; ctx.beginPath(); ctx.moveTo(nx, ny - 16); ctx.lineTo(nx + 7, ny + 4); ctx.lineTo(nx, ny); ctx.lineTo(nx - 7, ny + 4); ctx.closePath(); ctx.fill();
    ctx.textAlign = "center"; ctx.font = `600 11px ${FONT}`; ctx.fillText("North", nx, ny + 17);
    const bar = [1, 2, 5, 10, 20, 50].find((m) => m * this.scale >= 60) ?? 50;
    const bx = this.width - 30 - bar * this.scale, by = this.height - 16;
    ctx.strokeStyle = PALETTE.charcoal; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bar * this.scale, by); ctx.moveTo(bx, by - 4); ctx.lineTo(bx, by + 4); ctx.moveTo(bx + bar * this.scale, by - 4); ctx.lineTo(bx + bar * this.scale, by + 4); ctx.stroke();
    ctx.font = `400 11px ${FONT}`; ctx.fillStyle = PALETTE.charcoal;
    ctx.fillText(`${bar} metre${bar === 1 ? "" : "s"}`, bx + (bar * this.scale) / 2, by - 8);
  }
}

/** Static plan drawing for the printed report. */
export function drawPlanStatic(canvas: HTMLCanvasElement, p: SiteProject, r: SiteResults | null, width: number, height: number): (x: number, y: number) => [number, number] {
  const cb: PlanCallbacks = {
    getProject: () => p, getResults: () => r, getTool: () => "select", setTool: () => undefined, getSelection: () => null,
    select: () => undefined, changed: () => undefined, newId: () => "x", status: () => undefined,
  };
  const ed = new PlanEditor(canvas, cb);
  ed.resize(width, height);
  ed.fit();
  return (x, y) => ed.screenOf(x, y);
}

function round(v: number) { return Math.round(v * 1000) / 1000; }

export function pointInPolygon(x: number, y: number, poly: Point2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function distanceToSegment(p: Point2, a: Point2, b: Point2): number {
  const ex = b[0] - a[0], ey = b[1] - a[1];
  const l2 = ex * ex + ey * ey || 1;
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l2));
  return Math.hypot(a[0] + t * ex - p[0], a[1] + t * ey - p[1]);
}

export function centroid(poly: Point2[]): Point2 {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  if (Math.abs(a) < 1e-12) return [poly.reduce((s, q) => s + q[0], 0) / poly.length, poly.reduce((s, q) => s + q[1], 0) / poly.length];
  return [cx / (3 * a), cy / (3 * a)];
}
