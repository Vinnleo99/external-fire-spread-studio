/** Two-dimensional elevation editor: click and drag to draw openings; drag to move; corner handles to resize. */
import { Facade, Opening, OpeningType, OPENING_TYPES } from "../engine/model";
import { OPENING_STYLE, PALETTE } from "./colours";
import { setupCanvas } from "./charts";

type Mode = { kind: "idle" } | { kind: "draw"; x0: number; z0: number; x1: number; z1: number }
  | { kind: "move"; id: string; dx: number; dz: number; start: Opening }
  | { kind: "resize"; id: string; corner: "nw" | "ne" | "sw" | "se" };

const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

export interface ElevationCallbacks {
  getFacade(): Facade;
  getTool(): OpeningType;
  getSelected(): string | null;
  select(id: string | null): void;
  /** Called when the geometry changes; `final` is true when the gesture ends. */
  changed(final: boolean): void;
  newId(): string;
  /** Optional horizontal guide lines (for example floor levels) and axis captions. */
  getGuides?(): { z: number; label: string }[];
  axisLabels?: { x: string; z: string };
}

export class ElevationEditor {
  private ctx!: CanvasRenderingContext2D;
  private scale = 1;
  private pad = { left: 52, right: 20, top: 20, bottom: 42 };
  private mode: Mode = { kind: "idle" };
  private cssWidth = 800;
  private cssHeight = 360;
  readonly snap = 0.1;

  constructor(private canvas: HTMLCanvasElement, private cb: ElevationCallbacks) {
    canvas.addEventListener("pointerdown", (e) => this.down(e));
    canvas.addEventListener("pointermove", (e) => this.move(e));
    canvas.addEventListener("pointerup", (e) => this.up(e));
    canvas.addEventListener("pointercancel", (e) => this.up(e));
    canvas.addEventListener("pointerleave", () => { if (this.mode.kind === "idle") this.canvas.style.cursor = "crosshair"; });
    canvas.tabIndex = 0;
    canvas.addEventListener("keydown", (e) => {
      const id = this.cb.getSelected();
      if (!id) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        const facade = this.cb.getFacade();
        facade.openings = facade.openings.filter((o) => o.id !== id);
        this.cb.select(null);
        this.cb.changed(true);
        e.preventDefault();
      }
    });
  }

  resize(width: number) {
    this.cssWidth = width;
    const facade = this.cb.getFacade();
    const usable = width - this.pad.left - this.pad.right;
    this.scale = Math.min(usable / facade.width, 380 / facade.height);
    this.cssHeight = facade.height * this.scale + this.pad.top + this.pad.bottom;
    this.ctx = setupCanvas(this.canvas, width, this.cssHeight);
    this.draw();
  }

  private toWorld(e: PointerEvent): [number, number] {
    const rect = this.canvas.getBoundingClientRect();
    const facade = this.cb.getFacade();
    const x = (e.clientX - rect.left - this.pad.left) / this.scale;
    const z = facade.height - (e.clientY - rect.top - this.pad.top) / this.scale;
    return [x, z];
  }

  private snapValue(v: number, max: number): number {
    return Math.min(max, Math.max(0, Math.round(v / this.snap) * this.snap));
  }

  private hit(x: number, z: number): { opening: Opening; corner?: "nw" | "ne" | "sw" | "se" } | null {
    const facade = this.cb.getFacade();
    const tolerance = (7 * this.touchScale) / this.scale;
    const selected = this.cb.getSelected();
    for (const o of [...facade.openings].reverse()) {
      if (o.id === selected) {
        const corners: [("nw" | "ne" | "sw" | "se"), number, number][] = [["nw", o.xMin, o.zMax], ["ne", o.xMax, o.zMax], ["sw", o.xMin, o.zMin], ["se", o.xMax, o.zMin]];
        for (const [name, cx, cz] of corners) if (Math.abs(x - cx) < tolerance && Math.abs(z - cz) < tolerance) return { opening: o, corner: name };
      }
    }
    for (const o of [...facade.openings].reverse()) {
      if (x >= o.xMin && x <= o.xMax && z >= o.zMin && z <= o.zMax) return { opening: o };
    }
    return null;
  }

  /** Larger corner handles for a finger than for a mouse. */
  private touchScale = 1;

  private down(e: PointerEvent) {
    this.touchScale = e.pointerType === "touch" ? 2.5 : 1;
    this.canvas.focus();
    try { this.canvas.setPointerCapture(e.pointerId); } catch { /* Not an active pointer (for example a synthetic event). */ }
    const facade = this.cb.getFacade();
    const [x, z] = this.toWorld(e);
    const hit = this.hit(x, z);
    if (hit?.corner) {
      this.mode = { kind: "resize", id: hit.opening.id, corner: hit.corner };
    } else if (hit) {
      this.cb.select(hit.opening.id);
      this.mode = { kind: "move", id: hit.opening.id, dx: x - hit.opening.xMin, dz: z - hit.opening.zMin, start: { ...hit.opening } };
    } else {
      const sx = this.snapValue(x, facade.width), sz = this.snapValue(z, facade.height);
      this.cb.select(null);
      this.mode = { kind: "draw", x0: sx, z0: sz, x1: sx, z1: sz };
    }
    this.draw();
  }

  private move(e: PointerEvent) {
    const facade = this.cb.getFacade();
    const [x, z] = this.toWorld(e);
    if (this.mode.kind === "idle") {
      const hit = this.hit(x, z);
      this.canvas.style.cursor = hit?.corner ? (hit.corner === "nw" || hit.corner === "se" ? "nwse-resize" : "nesw-resize") : hit ? "move" : "crosshair";
      return;
    }
    if (this.mode.kind === "draw") {
      this.mode.x1 = this.snapValue(x, facade.width);
      this.mode.z1 = this.snapValue(z, facade.height);
    } else if (this.mode.kind === "move") {
      const mode = this.mode;
      const o = facade.openings.find((p) => p.id === mode.id);
      if (!o) return;
      const w = mode.start.xMax - mode.start.xMin, h = mode.start.zMax - mode.start.zMin;
      const nx = Math.min(facade.width - w, Math.max(0, Math.round((x - mode.dx) / this.snap) * this.snap));
      const nz = Math.min(facade.height - h, Math.max(0, Math.round((z - mode.dz) / this.snap) * this.snap));
      o.xMin = round(nx); o.xMax = round(nx + w); o.zMin = round(nz); o.zMax = round(nz + h);
      this.cb.changed(false);
    } else if (this.mode.kind === "resize") {
      const mode = this.mode;
      const o = facade.openings.find((p) => p.id === mode.id);
      if (!o) return;
      const sx = this.snapValue(x, facade.width), sz = this.snapValue(z, facade.height);
      const min = 0.2;
      if (mode.corner.includes("w")) o.xMin = round(Math.min(sx, o.xMax - min)); else o.xMax = round(Math.max(sx, o.xMin + min));
      if (mode.corner.includes("s")) o.zMin = round(Math.min(sz, o.zMax - min)); else o.zMax = round(Math.max(sz, o.zMin + min));
      this.cb.changed(false);
    }
    this.draw();
  }

  private up(e: PointerEvent) {
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    const facade = this.cb.getFacade();
    if (this.mode.kind === "draw") {
      const { x0, z0, x1, z1 } = this.mode;
      if (Math.abs(x1 - x0) >= 0.2 && Math.abs(z1 - z0) >= 0.2) {
        const opening: Opening = { id: this.cb.newId(), type: this.cb.getTool(), xMin: round(Math.min(x0, x1)), xMax: round(Math.max(x0, x1)),
          zMin: round(Math.min(z0, z1)), zMax: round(Math.max(z0, z1)), setback: 0 };
        facade.openings.push(opening);
        this.mode = { kind: "idle" };
        this.cb.select(opening.id);
        this.cb.changed(true);
      }
    } else if (this.mode.kind === "move" || this.mode.kind === "resize") {
      this.cb.changed(true);
    }
    this.mode = { kind: "idle" };
    this.draw();
  }

  draw() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const facade = this.cb.getFacade();
    const s = this.scale, { left, top } = this.pad;
    const W = facade.width * s, H = facade.height * s;
    ctx.clearRect(0, 0, this.cssWidth, this.cssHeight);
    // façade
    ctx.fillStyle = "#f7f8f8"; ctx.fillRect(left, top, W, H);
    ctx.strokeStyle = "rgba(63,68,67,0.08)"; ctx.lineWidth = 1;
    for (let x = 1; x < facade.width; x++) { ctx.beginPath(); ctx.moveTo(left + x * s, top); ctx.lineTo(left + x * s, top + H); ctx.stroke(); }
    for (let z = 1; z < facade.height; z++) { ctx.beginPath(); ctx.moveTo(left, top + H - z * s); ctx.lineTo(left + W, top + H - z * s); ctx.stroke(); }
    ctx.strokeStyle = PALETTE.charcoal; ctx.lineWidth = 1.5; ctx.strokeRect(left, top, W, H);
    // ground line
    ctx.strokeStyle = PALETTE.navy; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(left - 10, top + H); ctx.lineTo(left + W + 10, top + H); ctx.stroke();
    // axis labels
    ctx.font = `11px ${FONT}`; ctx.fillStyle = PALETTE.grey; ctx.textAlign = "center"; ctx.textBaseline = "top";
    const step = facade.width > 40 ? 5 : facade.width > 16 ? 2 : 1;
    for (let x = 0; x <= facade.width + 1e-9; x += step) ctx.fillText(String(x), left + x * s, top + H + 6);
    ctx.textAlign = "right"; ctx.textBaseline = "middle";
    const zStep = facade.height > 20 ? 5 : facade.height > 8 ? 2 : 1;
    for (let z = 0; z <= facade.height + 1e-9; z += zStep) ctx.fillText(String(z), left - 8, top + H - z * s);
    ctx.textAlign = "center"; ctx.textBaseline = "bottom"; ctx.fillStyle = PALETTE.charcoal;
    ctx.fillText(this.cb.axisLabels?.x ?? "Position along the façade (metres)", left + W / 2, this.cssHeight - 2);
    ctx.save(); ctx.translate(14, top + H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "top";
    ctx.fillText(this.cb.axisLabels?.z ?? "Height (metres)", 0, 0); ctx.restore();
    for (const g of this.cb.getGuides?.() ?? []) {
      const gy = top + H - g.z * s;
      ctx.strokeStyle = "rgba(0,43,73,0.35)"; ctx.setLineDash([6, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, gy); ctx.lineTo(left + W, gy); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = PALETTE.navy; ctx.font = `10px ${FONT}`; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      ctx.fillText(g.label, left + W - 4, gy - 2);
    }
    // openings
    const selected = this.cb.getSelected();
    for (const o of facade.openings) {
      const style = OPENING_STYLE[o.type];
      const x = left + o.xMin * s, y = top + H - o.zMax * s, w = (o.xMax - o.xMin) * s, h = (o.zMax - o.zMin) * s;
      ctx.fillStyle = style.fill; ctx.fillRect(x, y, w, h);
      if (style.hatch) {
        ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip();
        ctx.strokeStyle = style.stroke; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
        for (let k = -h; k < w; k += 8) { ctx.beginPath(); ctx.moveTo(x + k, y + h); ctx.lineTo(x + k + h, y); ctx.stroke(); }
        ctx.restore();
      }
      ctx.setLineDash(o.setback > 0 ? [5, 3] : []);
      ctx.strokeStyle = o.id === selected ? PALETTE.navy : style.stroke;
      ctx.lineWidth = o.id === selected ? 2.5 : 1.5;
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      if (w > 60 && h > 18) {
        ctx.fillStyle = PALETTE.charcoal; ctx.font = `11px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "top";
        ctx.fillText(OPENING_TYPES[o.type].label, x + 5, y + 4);
      }
      if (o.id === selected) {
        ctx.fillStyle = PALETTE.white; ctx.strokeStyle = PALETTE.navy; ctx.lineWidth = 1.5;
        for (const [cx, cy] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
          ctx.beginPath(); ctx.rect(cx - 4, cy - 4, 8, 8); ctx.fill(); ctx.stroke();
        }
      }
    }
    if (this.mode.kind === "draw") {
      const { x0, z0, x1, z1 } = this.mode;
      const style = OPENING_STYLE[this.cb.getTool()];
      const x = left + Math.min(x0, x1) * s, y = top + H - Math.max(z0, z1) * s;
      ctx.fillStyle = style.fill; ctx.strokeStyle = PALETTE.navy; ctx.setLineDash([4, 3]);
      ctx.fillRect(x, y, Math.abs(x1 - x0) * s, Math.abs(z1 - z0) * s);
      ctx.strokeRect(x, y, Math.abs(x1 - x0) * s, Math.abs(z1 - z0) * s);
      ctx.setLineDash([]);
      ctx.fillStyle = PALETTE.navy; ctx.font = `12px ${FONT}`; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
      ctx.fillText(`${Math.abs(x1 - x0).toFixed(1)} by ${Math.abs(z1 - z0).toFixed(1)} metres`, x, y - 4);
    }
  }
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}
