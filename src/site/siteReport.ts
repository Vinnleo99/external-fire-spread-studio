/** Printable report for the site model: inputs, method, results per boundary, compartment and face, validation, limitations. */
import { FIRE_LOAD_LABELS, fmtDown, fmtUp, OPENING_TYPES, openingArea, openingFraction, sourceIntensity } from "../engine/model";
import { SiteProject, allWalls, blockTop } from "../engine/site";
import { SiteResults, wallDescription } from "../engine/siteAssessment";
import { PARAGRAPH_13_8 } from "../engine/siteChecks";
import validation from "../data/site_validation.json";

export interface SiteReportImages {
  plan: string;
  view3d: string;
  legend: string;
  profiles: { name: string; url: string }[];
  elevations: { label: string; url: string }[];
}

const esc = (t: string) => t.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
export const up = (v: number | null | undefined, n = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "not applicable" : fmtUp(v, n));
export const down = (v: number | null | undefined, n = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "no limit" : fmtDown(v, n));
const fmt = (v: number | null | undefined, n = 2) => (v === null || v === undefined || !Number.isFinite(v) ? "not applicable" : v.toFixed(n));
const verdict = (pass: boolean) => `<strong style="color:${pass ? "#1e7a1e" : "#cc1f1d"}">${pass ? "Pass" : "Fail"}</strong>`;

export const SOURCES = {
  adb: "https://assets.publishing.service.gov.uk/media/6aa3bb7492e72b8ac437f145/AD_B2_2026.pdf",
  br187: "https://architecturemalaysia.com/Files/Pool/101_170905_1031313131_brreport187externalfirespread.pdf",
  bre2014: "https://bregroup.com/documents/311572/1990118/327394.pdf/6ecf35f8-1d3b-06cf-2e27-8d2a955abad5?t=1732261836581&version=1.0",
};

export const APPROACH_LABELS = {
  mirror: "Mirror image across the boundary (default)",
  boundary: "Receiver on the boundary (limiting condition)",
} as const;
export const ORIENTATION_LABELS = {
  mirrorFace: "Facing the mirrored wall (default)",
  boundaryNormal: "Facing square to the boundary",
  mostOnerous: "Most onerous orientation at each point",
} as const;

export function offsetText(o: { offset: number; status: string }): string {
  if (o.status === "noOpenings") return "0 metres (no openings)";
  if (o.status === "notSolved") return "not calculated";
  if (o.status === "belowRange") return "meets the limit even when moved close to the building";
  // Distances the boundary must move away are rounded up; distances it could move closer are rounded down.
  if (o.offset > 0) return `move ${fmtUp(o.offset)} metres further away`;
  return `could move ${fmtDown(-o.offset, 2)} metres closer`;
}

export function sprinklerText(p: SiteProject): string {
  if (!p.settings.sprinklered) return "No sprinkler allowance";
  return p.settings.sprinklerOption === "doubleArea"
    ? "Sprinklers: permitted unprotected area doubled (acceptance limit 25.2 kilowatts per square metre)"
    : "Sprinklers: distance from the building to the boundary halved, minimum 1 metre";
}

export function renderSiteReport(root: HTMLElement, p: SiteProject, r: SiteResults | null, ready: boolean,
                                 images: SiteReportImages | null, print: () => void) {
  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const walls = allWalls(p);
  const wallMap = new Map(walls.map((w) => [w.id, w]));
  const compName = (id: string | null) => p.compartments.find((c) => c.id === id)?.name ?? "none";
  const boundaryName = (id: string | null) => p.boundaries.find((b) => b.id === id)?.name ?? "none";
  const v = validation as unknown as Record<string, { n: number; worstAbs: number; worstRel: number }>;

  const compartmentsInput = p.compartments.map((c) => `<tr><td>${esc(c.name)}</td><td>${FIRE_LOAD_LABELS[c.fireLoad]}</td><td class="num">${sourceIntensity(c.fireLoad)}</td></tr>`).join("");
  const blocksInput = p.blocks.map((b) => `<tr><td>${esc(b.name)}</td><td>${esc(compName(b.compartmentId))}</td><td class="num">${fmt(b.base)}</td>
    <td class="num">${b.storeys} × ${fmt(b.storeyHeight)}</td><td class="num">${fmt(blockTop(b))}</td>
    <td style="font-size:.75rem">${b.footprint.map(([x, y]) => `(${fmt(x, 1)}, ${fmt(y, 1)})`).join(" ")}</td></tr>`).join("");
  const boundaryInput = p.boundaries.map((b) => `<tr><td>${esc(b.name)}</td><td>${b.kind === "relevant" ? "Relevant boundary" : "Notional boundary"}</td>
    <td style="font-size:.75rem">${b.points.map(([x, y]) => `(${fmt(x, 1)}, ${fmt(y, 1)})`).join(" ")}</td></tr>`).join("");
  const openingRows = walls.flatMap((w) => p.openings.filter((o) => o.wallId === w.id).map((o, i) => `<tr><td>${i === 0 ? esc(wallDescription(p, w)) : ""}</td>
    <td>${OPENING_TYPES[o.type].label}</td><td class="num">${fmt(o.xMin)} to ${fmt(o.xMax)}</td><td class="num">${fmt(o.zMin)} to ${fmt(o.zMax)}</td>
    <td class="num">${fmt(o.setback)}</td><td class="num">${fmt(openingArea(o))}</td><td class="num">${fmt(openingArea(o) * openingFraction(o))}</td></tr>`)).join("");
  const orphan = p.openings.filter((o) => !wallMap.has(o.wallId)).length;

  let results = `<p>Calculating…</p>`;
  if (r) {
    const w = r.worst;
    const gb = r.boundaries.find((b) => b.id === w.boundaryId);
    const boundaryRows = r.boundaries.map((b) => `<tr><td>${esc(b.name)}</td><td>${b.kind === "relevant" ? "Relevant" : "Notional"}</td>
      <td class="num">${up(b.peak)}</td><td>${verdict(b.passes)}</td><td>${offsetText(b.requiredOffset)}</td></tr>`).join("");
    const compRows = r.compartments.map((c) => `<tr><td>${esc(c.name)}</td><td class="num">${c.sourceIntensity}</td><td class="num">${fmt(c.unprotectedArea)}</td>
      <td class="num">${up(c.peak)}</td><td>${c.location ? `${esc(boundaryName(c.location.boundaryId))}, ${fmt(c.location.chainage, 1)} metres along, ${fmt(c.location.z, 1)} metres up` : "no receiver sees this compartment"}</td>
      <td class="num">${down(c.scaling)}</td><td class="num">${down(c.permittedArea)}</td><td>${verdict(c.passes)}</td></tr>`).join("");
    const faceSections = r.compartments.map((c) => c.faces.length ? `<h3>${esc(c.name)}: faces with openings</h3>
      <table><tr><th>Face</th><th class="num">Face area (square metres)</th><th class="num">Unprotected area (square metres)</th><th class="num">Peak from this face alone (kilowatts per square metre)</th><th class="num">Scaling factor, this face alone</th><th class="num">Maximum unprotected area at the compartment scaling (square metres)</th></tr>
      ${c.faces.map((f) => `<tr><td>${esc(f.label)}</td><td class="num">${fmt(f.faceArea, 1)}</td><td class="num">${fmt(f.unprotectedArea)}</td><td class="num">${up(f.peakAlone)}</td><td class="num">${down(f.scalingAlone)}</td><td class="num">${down(f.permittedUniform)}</td></tr>`).join("")}</table>` : "").join("");
    const contributions = w.contributions.slice(0, 12).map((c) => `<tr><td>${esc(c.label)}</td><td>${OPENING_TYPES[c.type as keyof typeof OPENING_TYPES]?.label ?? c.type}</td>
      <td class="num">${up(c.intensity)}</td><td class="num">${(100 * c.share).toFixed(1)}%</td></tr>`).join("");
    results = `
      <table>
        <tr><th>Overall result</th><td>${verdict(r.passes)}</td></tr>
        <tr><th>Highest received intensity</th><td>${up(w.peak)} kilowatts per square metre against a limit of ${fmt(r.limit, 1)}</td></tr>
        <tr><th>Governing fire compartment</th><td>${esc(compName(w.compartmentId))}</td></tr>
        <tr><th>Where</th><td>${w.boundaryId ? `${esc(boundaryName(w.boundaryId))}, ${fmt(w.chainage, 2)} metres from its first point, ${fmt(w.z, 2)} metres above ground` : "no receiver"}</td></tr>
        <tr><th>Governing boundary</th><td>${gb ? offsetText(gb.requiredOffset) : "not applicable"}</td></tr>
      </table>
      <h3>Boundaries</h3>
      <table><tr><th>Boundary</th><th>Type</th><th class="num">Peak (kilowatts per square metre)</th><th>Result</th><th>Uniform offset of the whole line to just meet the limit</th></tr>${boundaryRows}</table>
      <h3>Fire compartments (each burns on its own)</h3>
      <table><tr><th>Compartment</th><th class="num">Source (kilowatts per square metre)</th><th class="num">Unprotected area (square metres)</th><th class="num">Peak (kilowatts per square metre)</th><th>Location of the peak</th><th class="num">Scaling factor</th><th class="num">Maximum unprotected area (square metres)</th><th>Result</th></tr>${compRows}</table>
      <p style="font-size:.8125rem">The scaling factor is the limit divided by the peak: every unprotected area of the compartment could be scaled by this factor, keeping the layout, and just meet the limit. The maximum unprotected area is the present unprotected area multiplied by the scaling factor.</p>
      ${faceSections}
      <h3>Openings governing the highest intensity</h3>
      ${contributions ? `<table><tr><th>Opening</th><th>Type</th><th class="num">Contribution (kilowatts per square metre)</th><th class="num">Share</th></tr>${contributions}</table>` : "<p>None.</p>"}
      ${images ? images.profiles.map((pr) => `<figure class="keep"><h3>Peak intensity along ${esc(pr.name)}</h3><img class="shot" alt="Profile along ${esc(pr.name)}" src="${pr.url}" /></figure>`).join("") : ""}
      ${r.warnings.length ? `<h3>Warnings</h3><ul>${r.warnings.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}`;
  }

  root.innerHTML = `
    <div class="no-print" style="max-width:920px;margin:0 auto 1rem;display:flex;justify-content:space-between;align-items:center">
      <p class="hint" style="margin:0">${ready ? "The report is up to date. Use your browser's print dialogue to print it or save it as a document." : "The results are still being calculated; the report will refresh automatically."}</p>
      <button class="button primary" id="site-print-report" ${ready ? "" : "disabled"}>Print or save the report</button>
    </div>
    <article class="report">
      <header>
        <div><h1>${esc(p.name || "Untitled project")}</h1><div>External fire spread: radiant heat to the site boundary</div></div>
        <div class="mark" style="text-align:right">External Fire Spread Studio<small>Site calculation report, ${today}${p.engineer ? `<br/>Prepared by ${esc(p.engineer)}` : ""}</small></div>
      </header>
      <section>
        <h2>1. Summary</h2>
        ${r ? `<p>Overall: ${verdict(r.passes)}. The highest received intensity is <strong>${up(r.worst.peak)}</strong> kilowatts per square metre against a limit of ${fmt(r.limit, 1)}, from the fire compartment "${esc(compName(r.worst.compartmentId))}".</p>` : "<p>Calculating…</p>"}
        <table>
          <tr><th>Receiver position</th><td>${APPROACH_LABELS[p.settings.approach]}</td></tr>
          <tr><th>Receiver orientation</th><td>${ORIENTATION_LABELS[p.settings.orientation]}</td></tr>
          <tr><th>Sprinklers</th><td>${sprinklerText(p)}</td></tr>
          <tr><th>Shielding by the building</th><td>${p.settings.shielding === "ignore" ? "Ignored (conservative)" : "Approximated by line of sight to emitter cells of about 1 metre"}</td></tr>
          <tr><th>Sampling</th><td>Every ${fmt(p.settings.stationSpacing, 2)} metres along each boundary and every ${fmt(p.settings.heightSpacing, 2)} metres in height, then refined by local search</td></tr>
        </table>
      </section>
      <section class="flow">
        <h2>2. Site plan and model</h2>
        ${images ? `<figure class="keep"><img class="shot" alt="Site plan with the peak intensity strip along each boundary" src="${images.plan}" />
          <p style="font-size:.8125rem">Plan. The coloured strip outside each boundary shows the peak received intensity at that point over all heights and compartments; grey means no building is opposite. The cross marks the governing point.</p></figure>
          <figure class="keep"><img class="shot" alt="Three-dimensional view with the heat map on the boundary" src="${images.view3d}" />
          <img class="shot" style="border:0;margin-top:0" alt="Colour scale" src="${images.legend}" />
          <p style="font-size:.8125rem">Three-dimensional view. The vertical surface standing on each boundary is coloured by the worst received intensity at each point and height.</p></figure>` : ""}
      </section>
      <section class="flow">
        <h2>3. Inputs</h2>
        <h3>Fire compartments</h3>
        <table><tr><th>Compartment</th><th>Purpose group</th><th class="num">Source intensity (kilowatts per square metre)</th></tr>${compartmentsInput}</table>
        <h3>Storey blocks</h3>
        <table><tr><th>Block</th><th>Compartment</th><th class="num">Base (metres)</th><th class="num">Storeys × height (metres)</th><th class="num">Top (metres)</th><th>Footprint (x east, y north, metres)</th></tr>${blocksInput}</table>
        <h3>Boundaries</h3>
        <table><tr><th>Boundary</th><th>Type</th><th>Points (metres)</th></tr>${boundaryInput}</table>
        <h3>Openings</h3>
        <p style="font-size:.8125rem">Horizontal positions are measured along the wall from its left end as seen from outside; heights are above the base of the block.</p>
        <table><tr><th>Wall</th><th>Type</th><th class="num">Along the wall (metres)</th><th class="num">Height (metres)</th><th class="num">Set back (metres)</th><th class="num">Area (square metres)</th><th class="num">Unprotected area (square metres)</th></tr>${openingRows}</table>
        ${orphan ? `<p>${orphan} opening(s) refer to walls that no longer exist and are ignored.</p>` : ""}
        ${images ? images.elevations.map((e) => `<figure class="keep"><h3>${esc(e.label)}</h3><img class="shot" alt="Elevation of ${esc(e.label)}" src="${e.url}" /></figure>`).join("") : ""}
      </section>
      <section class="flow">
        <h2>4. Results</h2>
        ${results}
      </section>
      <section class="flow">
        <h2>5. Method summary</h2>
        <p><strong>Radiation.</strong> Each unprotected area is a uniform rectangular radiator at 84 kilowatts per square metre (residential, office, assembly and recreation) or 168 kilowatts per square metre (shop and commercial, industrial, storage and other non-residential), as BR 187. Combustible cladding counts at half its area. The received intensity is the sum over the openings of one compartment of source intensity × unprotected fraction × configuration factor. Compartments burn one at a time; the worst compartment governs.</p>
        <p><strong>Configuration factor.</strong> For any rectangle at any position and orientation the factor to a receiving point is calculated exactly with the contour-integral (Stokes) form, after clipping the rectangle to the half-space in front of the receiver. A point behind the plane of an opening receives nothing from it, so openings on faces turned away from a boundary contribute nothing. For a receiver parallel to the façade this reproduces the BR 187 corner formula to rounding error.</p>
        <p><strong>Receiver position (engineering judgement built on the standard rule).</strong> Approved Document B, Volume 2, paragraph 13.1(d), assumes a mirror-image building on the far side of the boundary; BR 187 makes the same assumption, so the separation is twice the distance to the boundary. For a boundary that is not parallel to a façade there is no published rule for where the mirror receiver sits. This assessment takes each point on the boundary, finds the first wall met by a horizontal line drawn square to the boundary at that height, and places the receiver at the mirror image of that wall point across the local line of the boundary, facing the mirror image of the wall. For a straight parallel boundary this is exactly BR 187. The alternative setting puts the receiver on the boundary itself, which BR 187 Part 2 describes as the limiting and absolutely safe condition and which is much more onerous. Above the roof, or where no wall is opposite, the mirror approach places no receiver.</p>
        <p><strong>Notional boundaries.</strong> Approved Document B paragraph 13.5(c) and Diagram 13.3 set a notional boundary between buildings on the same site; it is assessed in the same way as a relevant boundary.</p>
        <p><strong>Sprinklers.</strong> Approved Document B paragraph 13.22: either the distance to the boundary is halved (minimum 1 metre), applied at each point, or the permitted unprotected area is doubled, which is the same as doubling the acceptance limit to 25.2 kilowatts per square metre.</p>
        <p><strong>Uniform offset.</strong> For each boundary the whole line is moved outwards (positive) or inwards (negative) by the same distance, with mitred corners, and the offset at which the peak just reaches the limit is found by bracketing and Brent's method.</p>
        <p>Sources: Approved Document B, Volume 2 (2019 edition incorporating the 2020, 2022, 2025 and 2026 amendments), ${SOURCES.adb}; BR 187 (1991), ${SOURCES.br187}; BR 187 (2014) preview, ${SOURCES.bre2014}.</p>
      </section>
      <section>
        <h2>6. Validation</h2>
        <table><tr><th>Check</th><th class="num">Cases</th><th class="num">Largest absolute difference</th><th class="num">Largest relative difference</th></tr>
        ${Object.entries(v).map(([k, x]) => `<tr><td>${esc(k.charAt(0).toUpperCase() + k.slice(1))}</td><td class="num">${x.n.toLocaleString("en-GB")}</td><td class="num">${x.worstAbs.toExponential(2)}</td><td class="num">${x.worstRel.toExponential(2)}</td></tr>`).join("")}</table>
        <p style="font-size:.8125rem">Configuration factors are dimensionless; distances are in metres; intensities in kilowatts per square metre. The previous single-façade engine was itself validated against all 1,440 entries of BR 187 (1991) Table 1. Oblique configuration factors were checked against independent numerical integration (Gauss–Legendre quadrature) and the perpendicular case against BR 187 equation A5. The requirement was agreement within 1 millimetre or 0.1%.</p>
      </section>
      <section class="flow">
        <h2>7. What is and is not modelled</h2>
        <ul>
          <li>Modelled: any polyline boundary; notional boundaries; storey blocks with their own footprints (setbacks and stepped floors); openings on any wall; compartments burning separately; sprinkler allowances; receivers behind an opening's plane receive nothing.</li>
          <li>Shielding of one part of the building by another is ${p.settings.shielding === "ignore" ? "ignored, which can only overstate the intensity" : `approximated by line of sight from each receiver to five points on each emitter cell of about 1 metre; a cell counts in full if any point is visible${r && r.shieldingStatus ? `. This approximation is ${r.shieldingStatus}` : ""}`}.</li>
          <li>Not modelled: flame projection from openings, reveals and projections such as balconies, atmospheric absorption, roofs as radiators, and radiation reflected from the ground.</li>
          <li>The mirror receiver for a non-parallel boundary, the fan of directions at convex corners of the boundary, and placing no receiver above the roof are engineering judgement, not published rules.</li>
          <li>Walls on or within 1 metre of a boundary are not passed or failed by calculation; they are reported as not applicable, with paragraph 13.8 of Approved Document B: ${esc(PARAGRAPH_13_8)}${r && r.withinOneMetre.length ? ` Walls affected: ${r.withinOneMetre.map((x) => `${esc(x.label)} (${fmtUp(x.distance, 2)} metres from ${esc(boundaryName(x.boundaryId))}${x.diagram135 ? ", openings meet the small-area rules" : `; ${esc(x.issues.join("; "))}`})`).join("; ")}.` : ""}</li>
          <li>Small unprotected areas allowed by Diagram 13.5 are ${p.settings.smallAreas ? "left out of the calculation" : "included in the calculation (the option to leave them out is off)"}${r && r.smallAreas.some((x) => x.ignored) ? `; excluded: ${r.smallAreas.filter((x) => x.ignored).length} opening(s)` : ""}. Spacing of small areas from large openings on other walls is engineering judgement.</li>
          <li>Overlapping openings on a wall are merged so that the overlap is counted once${r && r.overlaps.length ? ` (${r.overlaps.length} overlap(s) found)` : ""}. Overlapping blocks are not checked.</li>
          ${r && r.boundaries.some((b) => b.kinks.length) ? `<li>Kinks in the boundary (judgement point): ${r.boundaries.flatMap((b) => b.kinks.map((k) => `${esc(b.name)} at ${fmt(k.chainage, 1)} metres, main result ${up(k.mirrorPeak)}, receiver on the boundary ${up(k.boundaryPeak)} kilowatts per square metre`)).join("; ")}.</li>` : ""}
          <li>Rounding: intensities and distances are rounded up; scaling factors, percentages and permitted areas are rounded down.</li>
          <li>Building control bodies will expect the standard BR 187 or Approved Document B route; this calculation is best presented alongside it.</li>
        </ul>
      </section>
      <footer>Prepared with External Fire Spread Studio, version 2. The calculation follows BRE Report 187 and Approved Document B as described above and does not replace professional judgement.</footer>
    </article>`;
  root.querySelector<HTMLButtonElement>("#site-print-report")?.addEventListener("click", print);
}
