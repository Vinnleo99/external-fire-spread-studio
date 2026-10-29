/** Printable report: inputs, method summary, results and validation note. */
import { PARAGRAPH_13_8 } from "../engine/siteChecks";
import { FacadeResults, facadeKey } from "../compute";
import { FIRE_LOAD_LABELS, Facade, OPENING_TYPES, Project, openingArea, fmtDown, fmtUp, openingFraction, sourceIntensity } from "../engine/model";
import validation from "../data/validation_summary.json";

export interface ReportImages {
  elevation(f: Facade): string;
  heatMap(f: Facade, r: FacadeResults): string;
  legend(): string;
  profile(r: FacadeResults): string;
  view3d(f: Facade, r: FacadeResults): string;
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const fmt = (v: number | null | undefined, n = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "not applicable" : v.toFixed(n));
const pct = (v: number) => `${(100 * v).toFixed(1)}%`;

function sprinklerLabel(f: Facade): string {
  if (!f.sprinklered) return "No";
  return f.sprinklerOption === "doubleArea" ? "Yes: permitted unprotected area doubled" : "Yes: boundary distance halved, minimum 1 metre";
}

export function renderReport(root: HTMLElement, project: Project, results: Map<string, FacadeResults>,
                             images: ReportImages, print: () => void) {
  const ready = project.facades.every((f) => results.get(f.id)?.key === facadeKey(f));
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const v = validation as unknown as { finite_widths: Record<string, number>; all_rows: Record<string, number> & { largest_difference_case: Record<string, number | string> } };
  const largest = v.all_rows.largest_difference_case;

  const summaryRows = project.facades.map((f) => {
    const r = results.get(f.id);
    if (!r || r.empty) return `<tr><td>${esc(f.name)}</td><td>${esc(f.compartment)}</td><td class="num">${fmt(f.boundaryDistance)}</td><td colspan="4">${r?.empty ? "No openings: 0 metres, pass" : "Calculating"}</td></tr>`;
    return `<tr><td>${esc(f.name)}</td><td>${esc(f.compartment)}</td><td class="num">${fmt(r.boundaryDistance)}</td>
      <td class="num">${fmtUp(r.requiredDistance)}</td><td class="num">${fmtUp(r.enclosingRequiredDistance)}</td>
      <td class="num">${fmt(r.enclosing?.percentage, 1)}%</td><td>${f.boundaryDistance !== undefined && f.boundaryDistance < 1 ? "Not applicable: within 1 metre of the boundary" : `<strong style="color:${r.atEntered.passes ? "#1e7a1e" : "#cc1f1d"}">${r.atEntered.passes ? "Pass" : "Fail"}</strong>`}</td></tr>`;
  }).join("");

  const sections = project.facades.map((f, index) => {
    const r = results.get(f.id);
    const openings = f.openings.map((o, i) => `<tr><td>${i + 1}</td><td>${OPENING_TYPES[o.type].label}</td>
      <td class="num">${fmt(o.xMin)} to ${fmt(o.xMax)}</td><td class="num">${fmt(o.zMin)} to ${fmt(o.zMax)}</td>
      <td class="num">${fmt(o.setback)}</td><td class="num">${fmt(openingArea(o))}</td><td class="num">${openingFraction(o)}</td>
      <td class="num">${fmt(openingArea(o) * openingFraction(o))}</td></tr>`).join("");
    let resultHtml = `<p>Calculating…</p>`;
    if (r && r.empty) resultHtml = `<p>This façade has no openings, so no boundary distance is needed for radiation.</p>`;
    else if (r && r.individual && r.enclosing) {
      resultHtml = `
        <table>
          <tr><th>Quantity</th><th class="num">Value</th></tr>
          <tr><td>Enclosing rectangle</td><td class="num">${fmt(r.enclosing.width)} by ${fmt(r.enclosing.height)} metres</td></tr>
          <tr><td>Unprotected area (combustible cladding at half its area)</td><td class="num">${fmtUp(r.enclosing.unprotectedArea)} square metres, ${fmtUp(r.enclosing.percentage, 1)}%</td></tr>
          <tr><td>Minimum boundary distance, each opening calculated separately (before any sprinkler allowance)</td><td class="num">${fmtUp(r.individual.boundaryDistance)} metres</td></tr>
          <tr><td>Location of the worst point on the receiving plane</td><td class="num">${fmt(r.individual.peakX, 1)} metres along, ${fmt(r.individual.peakZ, 1)} metres up</td></tr>
          <tr><td>Minimum boundary distance, single enclosing rectangle, exact (before any sprinkler allowance)</td><td class="num">${fmtUp(r.enclosingExact)} metres</td></tr>
          <tr><td>BR 187 (1991) Table 1 for the enclosing rectangle (interpolated; next column)</td><td class="num">${__PUBLIC_BUILD__ ? "Table values not included in this public version" : r.enclosingTable === null ? "outside the table" : `${fmt(r.enclosingTable)}; ${fmt(r.enclosingTableColumn, 1)} metres`}</td></tr>
          <tr><td>Required boundary distance after the sprinkler allowance, each opening separately</td><td class="num">${fmtUp(r.requiredDistance)} metres</td></tr>
          <tr><td>Entered boundary distance</td><td class="num">${fmt(r.boundaryDistance)} metres</td></tr>
          <tr><td>Peak received intensity at the entered distance</td><td class="num">${fmtUp(r.atEntered.peakIntensity, 1)} kilowatts per square metre</td></tr>
          <tr><td>Maximum unprotected area at the entered distance, same layout${r.sprinklered && r.sprinklerOption === "doubleArea" ? " (doubled for sprinklers)" : ""}</td><td class="num">${fmtDown(r.atEntered.permittedArea, 1)} square metres, ${fmtDown(r.atEntered.permittedPercentage, 1)}%</td></tr>
          <tr><td><strong>Result at the entered distance</strong></td><td class="num"><strong style="color:${r.atEntered.passes ? "#1e7a1e" : "#cc1f1d"}">${r.atEntered.passes ? "Pass" : "Fail"}</strong></td></tr>
        </table>
        <figure class="keep"><h3>Received intensity on the receiving plane at ${fmt(2 * r.boundaryDistance)} metres</h3>
        <img class="shot" alt="Heat map of received intensity" src="${images.heatMap(f, r)}" />
        <img class="shot" style="border:0;margin-top:0" alt="Colour scale" src="${images.legend()}" /></figure>
        <figure class="keep"><h3>Required boundary distance along the boundary</h3>
        <p style="font-size:.8125rem">Blue: each opening calculated separately. Lime: single enclosing rectangle. Dotted navy: entered boundary distance. Shaded: requirement exceeds the entered distance.</p>
        <img class="shot" alt="Required boundary distance along the boundary" src="${images.profile(r)}" /></figure>
        <figure class="keep"><h3>Three-dimensional view</h3>
        <img class="shot" alt="Three-dimensional view of the façade, boundary and receiving plane" src="${images.view3d(f, r)}" />
        <p style="font-size:.8125rem">The translucent blue plane is the boundary; the heat map is drawn on the receiving plane at twice the boundary distance.</p></figure>`;
    }
    return `<section>
      <h2>${index + 1}. ${esc(f.name)}</h2>
      <table>
        <tr><th>Fire compartment</th><td>${esc(f.compartment)}</td><th>Façade size</th><td>${fmt(f.width, 1)} by ${fmt(f.height, 1)} metres</td></tr>
        <tr><th>Purpose group</th><td>${FIRE_LOAD_LABELS[f.fireLoad]}</td><th>Source intensity</th><td>${sourceIntensity(f.fireLoad)} kilowatts per square metre</td></tr>
        <tr><th>Boundary distance entered</th><td>${fmt(f.boundaryDistance)} metres</td><th>Sprinklers</th><td>${sprinklerLabel(f)}</td></tr>
      </table>
      <img class="shot" alt="Elevation" src="${images.elevation(f)}" />
      <h3>Openings</h3>
      <table><tr><th>Number</th><th>Type</th><th class="num">Horizontal extent (metres)</th><th class="num">Vertical extent (metres)</th><th class="num">Set back (metres)</th><th class="num">Area (square metres)</th><th class="num">Unprotected fraction</th><th class="num">Unprotected area (square metres)</th></tr>${openings || `<tr><td colspan="8">None</td></tr>`}</table>
      <h3>Results</h3>
      ${resultHtml}
    </section>`;
  }).join("");

  root.innerHTML = `
    <div class="no-print" style="max-width:920px;margin:0 auto 1rem;display:flex;justify-content:space-between;align-items:center">
      <p class="hint" style="margin:0">${ready ? "The report is up to date. Use your browser's print dialogue to print it or save it as a document." : "Some results are still being calculated; the report will refresh automatically."}</p>
      <button class="button primary" id="print-report" ${ready ? "" : "disabled"}>Print or save the report</button>
    </div>
    <article class="report">
      <header>
        <div><h1>${esc(project.name || "Untitled project")}</h1><div>External fire spread: radiant heat and boundary distance</div></div>
        <div class="mark" style="text-align:right">External Fire Spread Studio<small>Calculation report, ${today}${project.engineer ? `<br/>Prepared by ${esc(project.engineer)}` : ""}</small></div>
      </header>
      <section>
        <h2>Summary</h2>
        <table><tr><th>Façade</th><th>Fire compartment</th><th class="num">Entered distance (metres)</th><th class="num">Required, each opening (metres)</th><th class="num">Required, enclosing rectangle (metres)</th><th class="num">Unprotected area</th><th>Result</th></tr>${summaryRows}</table>
        <p style="font-size:.8125rem">Required distances include the sprinkler allowance where one is selected.</p>
      </section>
      ${sections}
      <section>
        <h2>Method summary</h2>
        <p>Each unprotected area is treated as a uniform rectangular radiator at 84 kilowatts per square metre (residential, office, assembly and recreation) or 168 kilowatts per square metre (shop and commercial, industrial, storage and other non-residential), as stated in Approved Document B, Volume 2, paragraph 13.17. Combustible cladding more than 1 millimetre thick on an otherwise fire-resisting wall counts as half its area (paragraph 13.7).</p>
        <p>The configuration factor from each opening to a receiving point on a plane parallel to the façade is calculated exactly from the formula for a point opposite one corner of a rectangle. Rectangles are added and subtracted so that the receiving point may be anywhere, including outside the opening. The received intensity is the source intensity multiplied by the sum over all openings of configuration factor times unprotected fraction. Openings set back behind the face of the wall are treated as further away; shielding by the reveals is ignored.</p>
        <p>Following BR 187, the building opposite is assumed to be a mirror image, so the separation distance is twice the boundary distance. The minimum boundary distance is the smallest distance beyond which the peak received intensity anywhere on the receiving plane never exceeds 12.6 kilowatts per square metre. The peak is found by a grid search refined by local optimisation, and the distance by bracketing the outermost crossing of the limit and refining it with Brent's method. The single enclosing rectangle result uses the same physics with the whole enclosing rectangle radiating uniformly at the average unprotected fraction and the receiver opposite its centre. With sprinklers, Approved Document B paragraph 13.22 allows either the boundary distance to be halved (to a minimum of 1 metre) or the unprotected area to be doubled.</p>
      </section>
      <section>
        <h2>Validation note</h2>
        <p>The calculation engine was validated against all ${v.all_rows.count.toLocaleString("en-GB")} published boundary distances in BR 187 (1991, first edition) Table 1, both fire load categories, using a receiver opposite the centre of the enclosing rectangle. For the ${v.finite_widths.count.toLocaleString("en-GB")} entries with a stated width, ${pct(v.finite_widths.share_within_0_5_m)} agree within 0.5 metres and ${pct(v.finite_widths.share_within_1_0_m)} within 1.0 metre; the mean difference is ${fmt(v.finite_widths.mean_difference_m)} metres. The largest difference in the whole table is ${fmt(v.all_rows.largest_absolute_difference_m)} metres (${largest.height_m} metres high by ${largest.width_m} metres wide, ${largest.unprotected_percentage}% unprotected). The differences are explained by the table's rounding to 0.5 metres and its derivation from graphical methods. The engine also reproduces the worked examples in Part 2 of the 1991 report to within 2.5%.</p>
        <p>The browser calculation is a direct port of the validated reference engine and is tested against it: for every table entry and for the example façades, distances and percentages agree to within one micrometre (the requirement was 1 millimetre or 0.1%).</p>
        <p>The 2014 second edition of BR 187 states that its Tables A to J are the first edition's Table 1 split into pages; the second edition values were not available to check directly. The detailed calculation with separate openings rests on the same verified formula but has no independent published multi-opening result to compare with.</p>
      </section>
      <section>
        <h2>Limitations</h2>
        <ul>
          <li>The receiving plane is parallel to the façade. Boundaries at an angle, return walls and roofs are not yet modelled.</li>
          <li>Flame projection from openings, shielding by projections or reveals, and atmospheric absorption are not modelled, as in the BR 187 tables.</li>
          <li>Overlapping openings are merged so that the overlap is counted once.</li>
          <li>A façade less than 1 metre from the boundary is not passed or failed by calculation; Approved Document B paragraph 13.8 applies: ${esc(PARAGRAPH_13_8)}</li>
          <li>A façade with no openings needs a boundary distance of 0 metres and passes.</li>
          <li>Rounding: distances and intensities are rounded up; percentages and permitted areas are rounded down.</li>
          <li>Building control bodies will expect the standard BR 187 or Approved Document B route; this detailed calculation is best presented alongside it.</li>
        </ul>
      </section>
      <footer>Prepared with External Fire Spread Studio, version 0.1. The calculation follows BRE Report 187 and Approved Document B as described above and does not replace professional judgement.</footer>
    </article>`;
  root.querySelector<HTMLButtonElement>("#print-report")?.addEventListener("click", print);
}
