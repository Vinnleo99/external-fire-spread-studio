// Usage: node scripts/ipad-check.mjs <html file or URL> <output folder>
// Playwright WebKit with iPad emulation (touch, iPad user agent) in portrait and landscape at 1024 x 1366 and 1366 x 1024.
// Screenshots every tab and checks layout, a one-finger drag of an opening, a two-finger pinch on the site plan,
// one-finger orbit and two-finger pinch in the three-dimensional view, and console errors.
import { webkit, devices } from "playwright";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
const arg = process.argv[2] ?? "dist-public/index.html";
const url = /^https?:/.test(arg) ? arg : "file://" + resolve(arg);
const out = resolve(process.argv[3] ?? "screenshots/ipad");
mkdirSync(out, { recursive: true });
const browser = await webkit.launch();
const TABS = ["plan", "elevations", "site3d", "results", "report", "simple"];
const report = { url, orientations: {} };
let failures = 0;
const check = (r, name, ok, detail = "") => { r.checks.push({ name, ok, detail }); if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"}  ${r.label}: ${name}${detail ? ` (${detail})` : ""}`); };

// Synthetic touch pointer events: WebKit in Playwright has no touch-drag API, so the app's pointer handlers are driven directly.
const touch = (page, sel, steps) => page.evaluate(async ([sel, steps]) => {
  const el = document.querySelector(sel);
  const fire = (type, id, x, y) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: "touch", isPrimary: id === 1, clientX: x, clientY: y, bubbles: true, cancelable: true, button: 0, buttons: type === "pointerup" ? 0 : 1 }));
  for (const s of steps) { for (const [type, id, x, y] of s) fire(type, id, x, y); await new Promise((r) => requestAnimationFrame(() => r())); }
}, [sel, steps]);
const canvasHash = (page, sel) => page.locator(sel).screenshot().then((b) => b.toString("base64").length + ":" + b.subarray(b.length / 2, b.length / 2 + 64).toString("hex"));

for (const [label, w, h] of [["portrait", 1024, 1366], ["landscape", 1366, 1024]]) {
  const r = { label, viewport: [w, h], checks: [], screenshots: [] };
  const ctx = await browser.newContext({ ...devices["iPad Pro 11"], viewport: { width: w, height: h }, screen: { width: w, height: h }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message + " @ " + (e.stack || "").split("\n").slice(0, 3).join(" < ")));
  page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });
  page.on("dialog", (d) => d.accept());
  await page.goto(url);
  const ready = () => page.waitForFunction(() => { const r = window.studio?.siteResults; return !!r && [...document.querySelectorAll(".site-status")].some((e) => e.offsetParent && /up to date/i.test(e.textContent)); }, null, { timeout: 120000 });
  await ready();
  const vp = await page.evaluate(() => document.querySelector('meta[name="viewport"]')?.content ?? "");
  check(r, "viewport meta", /width=device-width/.test(vp), vp);
  check(r, "web app manifest linked", await page.evaluate(() => !!document.querySelector('link[rel="manifest"]') && !!document.querySelector('link[rel="apple-touch-icon"]')));
  for (const tab of TABS) {
    await page.evaluate((t) => window.studio.showTab(t), tab);
    await page.waitForTimeout(tab === "site3d" ? 1500 : tab === "report" ? 2500 : 600);
    const p = `${out}/${label}-${tab}.png`;
    await page.screenshot({ path: p });
    r.screenshots.push(p);
    const a = await page.evaluate(() => {
      const vis = (e) => e.offsetParent !== null && e.getBoundingClientRect().width > 0;
      const W = window.innerWidth;
      const overflow = [...document.querySelectorAll("body *")].filter(vis).filter((e) => { const b = e.getBoundingClientRect(); return b.right > W + 1 && !e.closest(".table-scroll") && getComputedStyle(e).position !== "fixed"; }).map((e) => e.id || e.className || e.tagName).slice(0, 5);
      const small = [...document.querySelectorAll("button, select, input, [role=button]")].filter(vis).filter((e) => { const b = e.getBoundingClientRect(); return b.height < 28 && !e.closest("table") && !["checkbox", "radio"].includes(e.type); }).map((e) => e.id || e.textContent.trim().slice(0, 20) || e.tagName).slice(0, 8);
      const clipped = [...document.querySelectorAll("select")].filter(vis).filter((s) => { const c = document.createElement("canvas").getContext("2d"); const cs = getComputedStyle(s); c.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`; return c.measureText(s.options[s.selectedIndex]?.text ?? "").width > s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) + 1; }).map((s) => (s.id || s.dataset.field || s.name || "?") + ":" + (s.options[s.selectedIndex]?.text ?? "") + "@" + s.clientWidth);
      return { horizontalScroll: document.documentElement.scrollWidth > W + 1, overflow, smallTargets: small, clippedSelects: clipped };
    });
    check(r, `${tab}: no sideways scrolling or overflow`, !a.horizontalScroll && a.overflow.length === 0, a.overflow.join(", "));
    check(r, `${tab}: no clipped menus`, a.clippedSelects.length === 0, a.clippedSelects.join(", "));
    check(r, `${tab}: controls at least 28 pixels high`, a.smallTargets.length === 0, a.smallTargets.join(", "));
  }
  // One-finger drag of an opening on the site elevation.
  await page.evaluate(() => window.studio.showTab("elevations"));
  await page.waitForTimeout(700);
  const eb = await page.locator("#site-elevation").boundingBox();
  let found = null;
  for (let fy = 0.15; fy < 0.9 && !found; fy += 0.05) for (let fx = 0.08; fx < 0.92 && !found; fx += 0.03) {
    await page.mouse.move(eb.x + eb.width * fx, eb.y + eb.height * fy);
    const c = await page.evaluate(() => getComputedStyle(document.querySelector("#site-elevation")).cursor);
    if (c === "move") found = [eb.x + eb.width * fx, eb.y + eb.height * fy];
  }
  const before = await page.evaluate(() => JSON.stringify(window.studio.site.openings));
  if (found) {
    const [x, y] = found; const steps = [[["pointerdown", 1, x, y]]];
    for (let i = 1; i <= 20; i++) steps.push([["pointermove", 1, x + 4 * i, y]]);
    steps.push([["pointerup", 1, x + 80, y]]);
    await touch(page, "#site-elevation", steps);
  }
  check(r, "one-finger drag moves an opening", !!found && before !== (await page.evaluate(() => JSON.stringify(window.studio.site.openings))), found ? "" : "no opening found");
  await ready();
  // Two-finger pinch on the site plan.
  await page.evaluate(() => window.studio.showTab("plan"));
  await page.waitForTimeout(700);
  const pb = await page.locator("#site-plan").boundingBox();
  const cx = pb.x + pb.width / 2, cy = pb.y + pb.height / 2;
  const planBefore = await canvasHash(page, "#site-plan");
  const geo = () => page.evaluate(() => JSON.stringify({ ...window.studio.site, activeBlockId: undefined }));
  const siteBefore = await geo();
  const pinch = [[["pointerdown", 1, cx - 40, cy], ["pointerdown", 2, cx + 40, cy]]];
  for (let i = 1; i <= 15; i++) pinch.push([["pointermove", 1, cx - 40 - 6 * i, cy], ["pointermove", 2, cx + 40 + 6 * i, cy]]);
  pinch.push([["pointerup", 1, cx - 130, cy], ["pointerup", 2, cx + 130, cy]]);
  await touch(page, "#site-plan", pinch);
  await page.waitForTimeout(300);
  check(r, "two-finger pinch zooms the site plan", planBefore !== (await canvasHash(page, "#site-plan")));
  check(r, "pinch does not edit the model", siteBefore === (await geo()));
  // Three-dimensional view: one-finger orbit and two-finger pinch.
  await page.evaluate(() => window.studio.showTab("site3d"));
  await page.waitForTimeout(1500);
  const sel3d = "#site-view3d > canvas";
  const vb = await page.locator(sel3d).first().boundingBox();
  const vx = vb.x + vb.width / 2, vy = vb.y + vb.height / 2;
  let h3 = await canvasHash(page, sel3d);
  const orbit = [[["pointerdown", 1, vx, vy]]];
  for (let i = 1; i <= 20; i++) orbit.push([["pointermove", 1, vx + 8 * i, vy + 2 * i]]);
  orbit.push([["pointerup", 1, vx + 160, vy + 40]]);
  await touch(page, sel3d, orbit); await page.waitForTimeout(400);
  const h3b = await canvasHash(page, sel3d);
  check(r, "one-finger orbit turns the three-dimensional view", h3 !== h3b);
  const pin3 = [[["pointerdown", 1, vx - 40, vy], ["pointerdown", 2, vx + 40, vy]]];
  for (let i = 1; i <= 15; i++) pin3.push([["pointermove", 1, vx - 40 - 6 * i, vy], ["pointermove", 2, vx + 40 + 6 * i, vy]]);
  pin3.push([["pointerup", 1, vx - 130, vy], ["pointerup", 2, vx + 130, vy]]);
  await touch(page, sel3d, pin3); await page.waitForTimeout(400);
  check(r, "two-finger pinch zooms the three-dimensional view", h3b !== (await canvasHash(page, sel3d)));
  const p3 = `${out}/${label}-site3d-after-touch.png`; await page.screenshot({ path: p3 }); r.screenshots.push(p3);
  check(r, "no console errors or warnings", errors.length === 0, errors.slice(0, 3).join(" | "));
  report.orientations[label] = r;
  await ctx.close();
}
await browser.close();
writeFileSync(`${out}/ipad-check.json`, JSON.stringify(report, null, 2));
console.log(failures ? `${failures} check(s) failed` : "All iPad checks passed");
process.exit(failures ? 1 : 0);
