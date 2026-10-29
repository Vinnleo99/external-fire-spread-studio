import { ACCEPTANCE_LIMIT, Facade } from "../engine/model";
import { FacadeResults } from "../compute";
import { OPENING_STYLE, PALETTE, SCALE_MAXIMUM, heatColour } from "./colours";

export function setupCanvas(canvas: HTMLCanvasElement, cssWidth: number, cssHeight: number): CanvasRenderingContext2D {
  const ratio = window.devicePixelRatio || 1;
  canvas.style.width = `${cssWidth}px`;
  canvas.style.height = `${cssHeight}px`;
  canvas.width = Math.round(cssWidth * ratio);
  canvas.height = Math.round(cssHeight * ratio);
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return ctx;
}

const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";

/** Marching squares: line segments of the contour at `level` on a regular grid. */
export function contourSegments(x: number[], z: number[], v: number[][], level: number): [number, number, number, number][] {
  const segments: [number, number, number, number][] = [];
  const interp = (a: number, b: number, va: number, vb: number) => a + ((level - va) / (vb - va)) * (b - a);
  for (let j = 0; j < z.length - 1; j++) {
    for (let i = 0; i < x.length - 1; i++) {
      const v00 = v[j][i], v10 = v[j][i + 1], v01 = v[j + 1][i], v11 = v[j + 1][i + 1];
      const points: [number, number][] = [];
      if ((v00 > level) !== (v10 > level)) points.push([interp(x[i], x[i + 1], v00, v10), z[j]]);
      if ((v10 > level) !== (v11 > level)) points.push([x[i + 1], interp(z[j], z[j + 1], v10, v11)]);
      if ((v01 > level) !== (v11 > level)) points.push([interp(x[i], x[i + 1], v01, v11), z[j + 1]]);
      if ((v00 > level) !== (v01 > level)) points.push([x[i], interp(z[j], z[j + 1], v00, v01)]);
      if (points.length === 2) segments.push([points[0][0], points[0][1], points[1][0], points[1][1]]);
      if (points.length === 4) {
        segments.push([points[0][0], points[0][1], points[1][0], points[1][1]]);
        segments.push([points[2][0], points[2][1], points[3][0], points[3][1]]);
      }
    }
  }
  return segments;
}

/** Heat map image (one pixel per grid cell) for use as a canvas source or three-dimensional texture. */
export function heatMapImage(results: FacadeResults, withContour = true, scale = 4): HTMLCanvasElement {
  const { x, z, intensity } = results.grid;
  const canvas = document.createElement("canvas");
  canvas.width = x.length * scale;
  canvas.height = z.length * scale;
  const ctx = canvas.getContext("2d")!;
  const image = ctx.createImageData(x.length, z.length);
  for (let j = 0; j < z.length; j++) {
    for (let i = 0; i < x.length; i++) {
      const [r, g, b] = heatColour(intensity[z.length - 1 - j][i]);
      const k = 4 * (j * x.length + i);
      image.data[k] = r; image.data[k + 1] = g; image.data[k + 2] = b; image.data[k + 3] = 255;
    }
  }
  const small = document.createElement("canvas");
  small.width = x.length; small.height = z.length;
  small.getContext("2d")!.putImageData(image, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(small, 0, 0, canvas.width, canvas.height);
  if (withContour) {
    const sx = (xx: number) => ((xx - x[0]) / (x[x.length - 1] - x[0])) * canvas.width;
    const sz = (zz: number) => canvas.height - ((zz - z[0]) / (z[z.length - 1] - z[0])) * canvas.height;
    ctx.strokeStyle = PALETTE.ink;
    ctx.lineWidth = Math.max(2, scale * 0.6);
    ctx.beginPath();
    for (const [x0, z0, x1, z1] of contourSegments(x, z, intensity, ACCEPTANCE_LIMIT)) {
      ctx.moveTo(sx(x0), sz(z0)); ctx.lineTo(sx(x1), sz(z1));
    }
    ctx.stroke();
  }
  return canvas;
}

interface Frame { left: number; top: number; width: number; height: number; x0: number; x1: number; y0: number; y1: number }

function toPixel(f: Frame, x: number, y: number): [number, number] {
  return [f.left + ((x - f.x0) / (f.x1 - f.x0)) * f.width, f.top + f.height - ((y - f.y0) / (f.y1 - f.y0)) * f.height];
}

function niceStep(range: number, target = 8): number {
  const raw = range / target;
  const power = 10 ** Math.floor(Math.log10(raw));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * power) return m * power;
  return 10 * power;
}

function axes(ctx: CanvasRenderingContext2D, f: Frame, xLabel: string, yLabel: string) {
  ctx.save();
  ctx.font = `11px ${FONT}`;
  ctx.fillStyle = PALETTE.grey;
  ctx.strokeStyle = "rgba(63,68,67,0.12)";
  ctx.lineWidth = 1;
  const xs = niceStep(f.x1 - f.x0), ys = niceStep(f.y1 - f.y0, 5);
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let v = Math.ceil(f.x0 / xs) * xs; v <= f.x1 + 1e-9; v += xs) {
    const [px] = toPixel(f, v, f.y0);
    ctx.beginPath(); ctx.moveTo(px, f.top); ctx.lineTo(px, f.top + f.height); ctx.stroke();
    ctx.fillText(String(Math.round(v * 100) / 100), px, f.top + f.height + 6);
  }
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let v = Math.ceil(f.y0 / ys) * ys; v <= f.y1 + 1e-9; v += ys) {
    const [, py] = toPixel(f, f.x0, v);
    ctx.beginPath(); ctx.moveTo(f.left, py); ctx.lineTo(f.left + f.width, py); ctx.stroke();
    ctx.fillText(String(Math.round(v * 100) / 100), f.left - 6, py);
  }
  ctx.fillStyle = PALETTE.charcoal;
  ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText(xLabel, f.left + f.width / 2, f.top + f.height + 38);
  ctx.translate(f.left - 42, f.top + f.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textBaseline = "top";
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();
}

export function drawHeatMap(canvas: HTMLCanvasElement, facade: Facade, results: FacadeResults, cssWidth: number) {
  const { x, z } = results.grid;
  const left = 58, right = 16, top = 14, bottom = 50;
  const plotWidth = cssWidth - left - right;
  const aspect = (z[z.length - 1] - z[0]) / Math.max(1e-6, x[x.length - 1] - x[0]);
  const plotHeight = Math.max(120, Math.min(340, plotWidth * aspect));
  const ctx = setupCanvas(canvas, cssWidth, plotHeight + top + bottom);
  ctx.clearRect(0, 0, cssWidth, plotHeight + top + bottom);
  const f: Frame = { left, top, width: plotWidth, height: plotHeight, x0: x[0], x1: x[x.length - 1], y0: z[0], y1: z[z.length - 1] };
  if (results.empty) {
    ctx.fillStyle = PALETTE.grey; ctx.font = `14px ${FONT}`;
    ctx.fillText("Add openings to see the received intensity.", left + 10, top + 30);
    return;
  }
  ctx.drawImage(heatMapImage(results, false, 1), left, top, plotWidth, plotHeight);
  // façade openings for orientation
  ctx.save();
  ctx.beginPath(); ctx.rect(left, top, plotWidth, plotHeight); ctx.clip();
  for (const o of facade.openings) {
    const [ax, ay] = toPixel(f, o.xMin, o.zMax);
    const [bx, by] = toPixel(f, o.xMax, o.zMin);
    ctx.setLineDash(o.setback > 0 ? [4, 3] : []);
    ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineWidth = 1;
    ctx.strokeRect(ax, ay, bx - ax, by - ay);
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath();
  for (const [x0, z0, x1, z1] of contourSegments(x, z, results.grid.intensity, ACCEPTANCE_LIMIT)) {
    const [p0x, p0y] = toPixel(f, x0, z0); const [p1x, p1y] = toPixel(f, x1, z1);
    ctx.moveTo(p0x, p0y); ctx.lineTo(p1x, p1y);
  }
  ctx.stroke();
  const [px, py] = toPixel(f, results.grid.peakX, results.grid.peakZ);
  ctx.strokeStyle = PALETTE.ink; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(px - 7, py); ctx.lineTo(px + 7, py); ctx.moveTo(px, py - 7); ctx.lineTo(px, py + 7); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = PALETTE.greyLight; ctx.strokeRect(left, top, plotWidth, plotHeight);
  axes(ctx, f, "Position along the façade (metres)", "Height (metres)");
}

export function drawLegend(canvas: HTMLCanvasElement, cssWidth: number) {
  const ctx = setupCanvas(canvas, cssWidth, 44);
  const left = 58, width = cssWidth - left - 16;
  for (let i = 0; i < width; i++) {
    const [r, g, b] = heatColour((i / width) * SCALE_MAXIMUM);
    ctx.fillStyle = `rgb(${r},${g},${b})`;
    ctx.fillRect(left + i, 4, 1, 12);
  }
  ctx.font = `11px ${FONT}`; ctx.fillStyle = PALETTE.grey; ctx.textBaseline = "top";
  for (const v of [0, 6.3, 12.6, 18.9, 25.2]) {
    const px = left + (v / SCALE_MAXIMUM) * width;
    ctx.textAlign = v === 0 ? "left" : v === 25.2 ? "right" : "center";
    ctx.fillText(v === 25.2 ? "25.2 or more" : String(v), px, 20);
  }
  ctx.textAlign = "left";
  ctx.fillText("Received intensity (kilowatts per square metre)", left, 32);
}

export function drawProfile(canvas: HTMLCanvasElement, results: FacadeResults, cssWidth: number) {
  const left = 58, right = 16, top = 14, bottom = 50, height = 230;
  const ctx = setupCanvas(canvas, cssWidth, height + top + bottom);
  ctx.clearRect(0, 0, cssWidth, height + top + bottom);
  if (results.empty || !results.individual) return;
  const { x, distance } = results.profile;
  const yMax = Math.max(1, ...distance, results.boundaryDistance, results.enclosingExact) * 1.25;
  const f: Frame = { left, top, width: cssWidth - left - right, height, x0: x[0], x1: x[x.length - 1], y0: 0, y1: yMax };
  axes(ctx, f, "Position along the boundary (metres)", "Required distance (metres)");
  // shade where the requirement exceeds the entered distance
  const entered = results.boundaryDistance;
  ctx.fillStyle = "rgba(204, 31, 29, 0.14)";
  for (let i = 0; i < x.length - 1; i++) {
    if (Math.max(distance[i], distance[i + 1]) > entered) {
      const [ax] = toPixel(f, x[i], 0); const [bx] = toPixel(f, x[i + 1], 0);
      ctx.fillRect(ax, top, bx - ax, height);
    }
  }
  const hline = (y: number, colour: string, dash: number[], width = 1.5) => {
    const [, py] = toPixel(f, 0, y);
    ctx.save(); ctx.strokeStyle = colour; ctx.setLineDash(dash); ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(left, py); ctx.lineTo(left + f.width, py); ctx.stroke(); ctx.restore();
  };
  hline(results.enclosingExact, PALETTE.lime, [7, 4], 2);
  hline(entered, PALETTE.navy, [2, 3], 2);
  ctx.strokeStyle = PALETTE.blue; ctx.lineWidth = 2.5; ctx.beginPath();
  x.forEach((xx, i) => { const [px, py] = toPixel(f, xx, distance[i]); if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py); });
  ctx.stroke();
  ctx.strokeStyle = PALETTE.greyLight; ctx.lineWidth = 1; ctx.strokeRect(left, top, f.width, height);
}

export function drawElevationStatic(canvas: HTMLCanvasElement, facade: Facade, cssWidth: number) {
  const pad = 40;
  const scale = Math.min((cssWidth - 2 * pad) / facade.width, 260 / facade.height);
  const h = facade.height * scale + 2 * pad;
  const ctx = setupCanvas(canvas, cssWidth, h);
  ctx.fillStyle = "#f7f8f8"; ctx.fillRect(pad, pad, facade.width * scale, facade.height * scale);
  ctx.strokeStyle = PALETTE.charcoal; ctx.strokeRect(pad, pad, facade.width * scale, facade.height * scale);
  for (const o of facade.openings) {
    const style = OPENING_STYLE[o.type];
    const x = pad + o.xMin * scale, y = pad + (facade.height - o.zMax) * scale;
    const w = (o.xMax - o.xMin) * scale, hh = (o.zMax - o.zMin) * scale;
    ctx.fillStyle = style.fill; ctx.fillRect(x, y, w, hh);
    ctx.strokeStyle = style.stroke; ctx.setLineDash(o.setback > 0 ? [4, 3] : []); ctx.strokeRect(x, y, w, hh);
  }
  ctx.setLineDash([]);
  ctx.font = `11px ${FONT}`; ctx.fillStyle = PALETTE.grey;
  ctx.fillText(`${facade.width} metres wide by ${facade.height} metres high`, pad, h - 14);
}
