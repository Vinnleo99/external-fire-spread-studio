/** Charts for the site assessment: peak intensity along each boundary. */
import { BoundaryResult, SiteResults } from "../engine/siteAssessment";
import { setupCanvas } from "../ui/charts";
import { PALETTE } from "../ui/colours";

const FONT = "Inter, 'Helvetica Neue', Arial, sans-serif";
export const COMPARTMENT_COLOURS = [PALETTE.blue, "#7d8500", "#8a5a9e", "#e07b24", PALETTE.cyan, PALETTE.charcoal];

/** Peak intensity (over all heights) against distance along the boundary, per compartment, with the limit. */
export function drawBoundaryProfile(canvas: HTMLCanvasElement, r: SiteResults, b: BoundaryResult, names: Record<string, string>, width: number, height = 260) {
  const ctx = setupCanvas(canvas, width, height);
  const pad = { left: 56, right: 16, top: 16, bottom: 40 };
  const W = width - pad.left - pad.right, H = height - pad.top - pad.bottom;
  ctx.clearRect(0, 0, width, height);
  // Collapse fan stations (same chainage) to their maximum.
  const xs: number[] = [], idx: number[][] = [];
  b.stations.forEach((s, i) => {
    if (xs.length && Math.abs(xs[xs.length - 1] - s.chainage) < 1e-9) idx[idx.length - 1].push(i);
    else { xs.push(s.chainage); idx.push([i]); }
  });
  const series = (vals: number[]) => idx.map((list) => Math.max(...list.map((i) => vals[i])));
  const worst = series(b.stationPeak);
  const comps = Object.entries(b.stationPeakByCompartment).map(([id, v]) => ({ id, v: series(v) }));
  const xMax = Math.max(1, xs[xs.length - 1] ?? 1);
  const yMax = Math.max(r.limit * 1.25, ...worst) * 1.05;
  const X = (x: number) => pad.left + (x / xMax) * W, Y = (y: number) => pad.top + H - (y / yMax) * H;
  ctx.fillStyle = "#fbfcfc"; ctx.fillRect(pad.left, pad.top, W, H);
  ctx.strokeStyle = "#e6e8e8"; ctx.lineWidth = 1;
  const yStep = yMax > 60 ? 10 : yMax > 30 ? 5 : 2;
  ctx.font = `11px ${FONT}`; ctx.fillStyle = PALETTE.grey; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  for (let y = 0; y <= yMax; y += yStep) { ctx.beginPath(); ctx.moveTo(pad.left, Y(y)); ctx.lineTo(pad.left + W, Y(y)); ctx.stroke(); ctx.fillText(String(y), pad.left - 6, Y(y)); }
  const xStep = xMax > 100 ? 20 : xMax > 40 ? 10 : 5;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  for (let x = 0; x <= xMax + 1e-9; x += xStep) { ctx.beginPath(); ctx.moveTo(X(x), pad.top); ctx.lineTo(X(x), pad.top + H); ctx.stroke(); ctx.fillText(String(x), X(x), pad.top + H + 5); }
  // Exceedance shading.
  ctx.fillStyle = "rgba(204,31,29,0.18)";
  for (let i = 0; i + 1 < xs.length; i++) if (worst[i] > r.limit || worst[i + 1] > r.limit) ctx.fillRect(X(xs[i]), pad.top, X(xs[i + 1]) - X(xs[i]), H);
  // Per compartment.
  comps.forEach((c, k) => {
    ctx.strokeStyle = COMPARTMENT_COLOURS[k % COMPARTMENT_COLOURS.length]; ctx.lineWidth = 1.8;
    ctx.beginPath(); c.v.forEach((v, i) => (i ? ctx.lineTo(X(xs[i]), Y(v)) : ctx.moveTo(X(xs[i]), Y(v)))); ctx.stroke();
  });
  // Limit.
  ctx.strokeStyle = PALETTE.red; ctx.setLineDash([6, 4]); ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(pad.left, Y(r.limit)); ctx.lineTo(pad.left + W, Y(r.limit)); ctx.stroke(); ctx.setLineDash([]);
  ctx.fillStyle = PALETTE.red; ctx.textAlign = "left"; ctx.textBaseline = "bottom";
  ctx.fillText(`Limit ${r.limit.toFixed(1)}`, pad.left + 6, Y(r.limit) - 2);
  ctx.strokeStyle = PALETTE.charcoal; ctx.strokeRect(pad.left, pad.top, W, H);
  ctx.fillStyle = PALETTE.charcoal; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText("Distance along the boundary from its first point (metres)", pad.left + W / 2, height - 2);
  ctx.save(); ctx.translate(12, pad.top + H / 2); ctx.rotate(-Math.PI / 2); ctx.textBaseline = "top";
  ctx.fillText("Peak (kilowatts per square metre)", 0, 0); ctx.restore();
  void names;
}

export function compartmentLegend(r: SiteResults): string {
  return r.compartments.map((c, k) => `<span><i style="background:${COMPARTMENT_COLOURS[k % COMPARTMENT_COLOURS.length]};height:3px"></i>${escapeHtml(c.name)}</span>`).join("")
    + `<span><i style="border-top:3px dashed ${PALETTE.red}"></i>Acceptance limit</span><span><i style="background:rgba(204,31,29,.25);height:.8rem"></i>Limit exceeded</span>`;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
