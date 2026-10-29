/** Application shell: top bar, main tabs and the containers for each view. Imported first so the containers exist. */
const app = document.querySelector<HTMLDivElement>("#app")!;
app.innerHTML = `
  <header class="topbar">
    <div class="brand"><strong>External Fire Spread Studio</strong><span>Radiant heat and boundary distance</span></div>
    <nav id="main-nav" aria-label="Views">
      <button data-tab="plan" aria-current="page">Site plan</button>
      <button data-tab="elevations">Elevations</button>
      <button data-tab="site3d">Three-dimensional view</button>
      <button data-tab="results">Results</button>
      <button data-tab="report">Report</button>
      <button data-tab="simple">Simple elevation</button>
    </nav>
    <div class="actions">
      <button class="button secondary small ghost-light" id="new-project">New project</button>
      <button class="button secondary small ghost-light" id="open-project">Open project file</button>
      <button class="button primary small" id="save-project">Save project file</button>
      <input type="file" id="file-input" accept=".json,application/json" hidden />
    </div>
  </header>
  <main>
    <section id="tab-plan" class="layout site-layout"></section>
    <section id="tab-elevations" class="layout site-layout" hidden></section>
    <section id="tab-site3d" class="layout single" hidden></section>
    <section id="tab-results" class="layout single" hidden></section>
    <section id="tab-report" hidden style="padding:1rem 1.25rem 2rem"></section>
    <section id="simple-root" hidden></section>
  </main>`;
export {};
