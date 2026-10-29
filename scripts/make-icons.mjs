import { chromium } from "playwright"; import { readFileSync } from "node:fs";
const svg = readFileSync("public/icon.svg", "utf8"); const b = await chromium.launch();
for (const [n, size, pad] of [["icon-192.png",192,0],["icon-512.png",512,0],["icon-512-maskable.png",512,0.1],["apple-touch-icon.png",180,0]]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<body style="margin:0;background:#0b2545"><div style="padding:${size*pad}px">${svg.replace("<svg ", `<svg width="${size*(1-2*pad)}" height="${size*(1-2*pad)}" `)}</div></body>`);
  await p.screenshot({ path: `public/${n}` }); await p.close(); }
await b.close();
