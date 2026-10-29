import "./style.css";
import "./shell";
import * as simple from "./simple/simpleApp";
import * as site from "./site/siteApp";
import { Project } from "./engine/model";
import { SiteProject } from "./engine/site";

type Tab = site.SiteTab | "simple";
let current: Tab = "plan";

function showTab(tab: Tab) {
  current = tab;
  document.querySelectorAll<HTMLButtonElement>("#main-nav button").forEach((b) => {
    if (b.dataset.tab === tab) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current");
  });
  const simpleRoot = document.querySelector<HTMLElement>("#simple-root")!;
  if (tab === "simple") { site.hideSite(); simpleRoot.hidden = false; simple.activate(); }
  else { simpleRoot.hidden = true; site.showSiteTab(tab); }
}

document.querySelectorAll<HTMLButtonElement>("#main-nav button").forEach((b) =>
  b.addEventListener("click", () => showTab(b.dataset.tab as Tab)));

// ---------------------------------------------------------------- project files
interface StudioFile { format: "external-fire-spread-studio-file"; version: 2; site: SiteProject; simple: Project }

document.querySelector("#save-project")!.addEventListener("click", () => {
  const file: StudioFile = { format: "external-fire-spread-studio-file", version: 2, site: site.getSiteProject(), simple: simple.getProject() };
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const name = (site.getSiteProject().name || "project").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "project";
  a.download = `${name}.efs.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

const fileInput = document.querySelector<HTMLInputElement>("#file-input")!;
document.querySelector("#open-project")!.addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", async () => {
  const f = fileInput.files?.[0];
  fileInput.value = "";
  if (!f) return;
  try { openData(JSON.parse(await f.text())); }
  catch (e) { alert(`That file could not be opened: ${String(e)}`); }
});

function openData(data: unknown) {
  const d = data as { format?: string };
  if (d?.format === "external-fire-spread-studio-file") {
    const file = data as StudioFile;
    if (file.site) site.replaceSiteProject(file.site);
    if (file.simple) simple.replaceProject(file.simple);
    showTab(current === "simple" ? "plan" : current);
  } else if (d?.format === "external-fire-spread-studio-site") {
    site.replaceSiteProject(data as SiteProject);
    showTab(current === "simple" ? "plan" : current);
  } else if (d?.format === "external-fire-spread-studio-project") {
    simple.replaceProject(data as Project);
    showTab("simple");
  } else throw new Error("not an External Fire Spread Studio project file");
}

document.querySelector("#new-project")!.addEventListener("click", () => {
  if (!confirm("Start a new, empty project? Unsaved changes to the site model and the simple elevation will be lost.")) return;
  site.replaceSiteProject(site.blankSiteProject());
  simple.replaceProject(simple.blankSimpleProject());
  showTab(current);
});

(window as unknown as { studio: unknown }).studio = {
  get site() { return site.getSiteProject(); },
  get siteResults() { return site.getSiteResults(); },
  get simple() { return simple.getProject(); },
  simpleResults: simple.simpleResults,
  showTab,
  openData,
  loadSite: (p: SiteProject) => site.replaceSiteProject(p),
};

showTab("plan");
