/** Three-dimensional view of the site: storey blocks, openings, boundary lines and the heat map along each boundary. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { SiteProject, allWalls, blockTop } from "../engine/site";
import { SiteResults } from "../engine/siteAssessment";
import { heatColour, PALETTE } from "../ui/colours";

const OPENING_COLOURS: Record<string, number> = {
  window: 0x6ad1e3, door: 0x656969, nonFireResistingWall: 0xb2b4b4, combustibleCladding: 0xcedc00,
};
const BLOCK_COLOURS = [0xffffff, 0xf4f6f6, 0xe9f6f8, 0xf7f8e6, 0xeef1f1];

/** World (x east, y north, z up) to scene (x, y up, z towards the viewer = south). */
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

export class SiteView3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 5000);
  private controls: OrbitControls;
  private content = new THREE.Group();
  private lastKey = "";
  private framed = "";

  constructor(private host: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.renderer.setClearColor(0xf4f6f6);
    host.appendChild(this.renderer.domElement);
    safePointerCapture(this.renderer.domElement);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.addEventListener("change", () => this.requestRender());
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0xb2b4b4, 2.2));
    const sun = new THREE.DirectionalLight(0xffffff, 1.5);
    sun.position.set(-30, 60, 40);
    this.scene.add(sun);
    this.scene.add(this.content);
    const loop = () => { requestAnimationFrame(loop); this.controls.update(); if (this.dirty) { this.dirty = false; this.renderer.render(this.scene, this.camera); } };
    loop();
  }

  resize() {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.render();
  }

  private dirty = true;
  /** Ask for one render on the next frame; several requests in a frame give one render. */
  requestRender() { this.dirty = true; }
  render() { this.dirty = false; this.renderer.render(this.scene, this.camera); }

  update(p: SiteProject, r: SiteResults | null, highlightWallId?: string | null) {
    const key = JSON.stringify([p.blocks, p.openings, p.boundaries, r?.key, r?.worst.peak, highlightWallId]);
    if (key === this.lastKey) { this.resize(); return; }
    this.lastKey = key;
    this.content.clear();
    // Extent of the model on plan.
    const xs: number[] = [], ys: number[] = [];
    p.blocks.forEach((b) => b.footprint.forEach(([x, y]) => { xs.push(x); ys.push(y); }));
    p.boundaries.forEach((b) => b.points.forEach(([x, y]) => { xs.push(x); ys.push(y); }));
    if (!xs.length) { xs.push(0, 20); ys.push(0, 20); }
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY, 10);
    const top = Math.max(1, ...p.blocks.map(blockTop));
    // Ground and grid.
    const size = Math.ceil(span * 1.6 + 20);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: 0xe9ecec }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.copy(V(cx, cy, -0.02));
    this.content.add(ground);
    const grid = new THREE.GridHelper(size, size, 0xd9dad9, 0xe3e5e5);
    grid.position.copy(V(cx, cy, 0));
    this.content.add(grid);
    // Blocks: walls as one extruded prism each, with edges.
    p.blocks.forEach((b, i) => {
      if (b.footprint.length < 3) return;
      const shape = new THREE.Shape(b.footprint.map(([x, y]) => new THREE.Vector2(x, y)));
      const h = blockTop(b) - b.base;
      const geo = new THREE.ExtrudeGeometry(shape, { depth: h, bevelEnabled: false });
      // Extrude runs along +z of the shape plane; rotate so that it rises along the scene's y.
      geo.rotateX(-Math.PI / 2);
      geo.translate(0, b.base, 0);
      const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: BLOCK_COLOURS[i % BLOCK_COLOURS.length], polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      this.content.add(mesh);
      this.content.add(new THREE.LineSegments(new THREE.EdgesGeometry(geo, 20), new THREE.LineBasicMaterial({ color: 0x3f4443 })));
      // Storey lines.
      for (let s = 1; s < b.storeys; s++) {
        const z = b.base + s * b.storeyHeight;
        const pts = [...b.footprint, b.footprint[0]].map(([x, y]) => V(x, y, z));
        this.content.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xb2b4b4 })));
      }
    });
    // Openings on their walls.
    const walls = new Map(allWalls(p).map((w) => [w.id, w]));
    for (const o of p.openings) {
      const w = walls.get(o.wallId);
      if (!w) continue;
      const x0 = Math.max(0, o.xMin), x1 = Math.min(w.length, o.xMax);
      const z0 = w.base + Math.max(0, o.zMin), z1 = Math.min(w.top, w.base + o.zMax);
      if (x1 <= x0 || z1 <= z0) continue;
      const out = o.setback > 0 ? -o.setback : 0.03;
      const P = (s: number, z: number) => V(w.start[0] + w.tangent[0] * s + w.normal[0] * out, w.start[1] + w.tangent[1] * s + w.normal[1] * out, z);
      const corners = [P(x0, z0), P(x1, z0), P(x1, z1), P(x0, z1)];
      const geo = new THREE.BufferGeometry().setFromPoints([corners[0], corners[1], corners[2], corners[0], corners[2], corners[3]]);
      geo.computeVertexNormals();
      this.content.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: OPENING_COLOURS[o.type], side: THREE.DoubleSide })));
      this.content.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(corners), new THREE.LineBasicMaterial({ color: 0x002b49 })));
    }
    if (highlightWallId) {
      const w = walls.get(highlightWallId);
      if (w) {
        const pts = [V(w.start[0], w.start[1], w.base), V(w.end[0], w.end[1], w.base), V(w.end[0], w.end[1], w.top), V(w.start[0], w.start[1], w.top)];
        this.content.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x006ba6 })));
      }
    }
    // Boundary lines on the ground, and the heat map on a vertical surface along each boundary.
    for (const b of p.boundaries) {
      if (b.points.length < 2) continue;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(b.points.map(([x, y]) => V(x, y, 0.04))),
        b.kind === "notional" ? new THREE.LineDashedMaterial({ color: 0x3f4443, dashSize: 0.8, gapSize: 0.5 }) : new THREE.LineBasicMaterial({ color: 0x002b49 }));
      line.computeLineDistances();
      this.content.add(line);
    }
    if (r) {
      for (const br of r.boundaries) {
        const ns = br.stations.length, nz = br.heights.length;
        if (ns < 2 || nz < 2) continue;
        const positions: number[] = [], colours: number[] = [], index: number[] = [];
        br.stations.forEach((st) => br.heights.forEach((z) => { const v = V(st.x, st.y, z); positions.push(v.x, v.y, v.z); }));
        br.grid.forEach((val) => {
          if (val < 0) { colours.push(0.85, 0.86, 0.85, 0.18); return; }
          const [cr, cg, cb] = heatColour(val);
          colours.push(cr / 255, cg / 255, cb / 255, 0.92);
        });
        for (let i = 0; i + 1 < ns; i++) {
          if (Math.hypot(br.stations[i + 1].x - br.stations[i].x, br.stations[i + 1].y - br.stations[i].y) < 1e-6) continue; // fan stations at a corner
          for (let k = 0; k + 1 < nz; k++) {
            const a = i * nz + k, b2 = (i + 1) * nz + k;
            index.push(a, b2, b2 + 1, a, b2 + 1, a + 1);
          }
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute("color", new THREE.Float32BufferAttribute(colours, 4));
        geo.setIndex(index);
        this.content.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false })));
        // Frame along the top of the surface.
        const topLine = br.stations.map((st) => V(st.x, st.y, br.heights[nz - 1]));
        this.content.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(topLine), new THREE.LineBasicMaterial({ color: 0x3f4443 })));
      }
      if (r.worst.boundaryPoint && r.worst.receiver) {
        const bp = r.worst.boundaryPoint, rp = r.worst.receiver;
        const marker = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.25, span / 120), 16, 12), new THREE.MeshBasicMaterial({ color: 0xcc1f1d }));
        marker.position.copy(V(bp[0], bp[1], bp[2]));
        this.content.add(marker);
        if (Math.hypot(rp[0] - bp[0], rp[1] - bp[1]) > 1e-3) {
          const ring = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.2, span / 160), 16, 12), new THREE.MeshBasicMaterial({ color: 0x002b49 }));
          ring.position.copy(V(rp[0], rp[1], rp[2]));
          this.content.add(ring);
          const dash = new THREE.Line(new THREE.BufferGeometry().setFromPoints([V(bp[0], bp[1], bp[2]), V(rp[0], rp[1], rp[2])]),
            new THREE.LineDashedMaterial({ color: 0x002b49, dashSize: 0.4, gapSize: 0.3 }));
          dash.computeLineDistances();
          this.content.add(dash);
        }
      }
    }
    const frameKey = `${minX.toFixed(0)}|${maxX.toFixed(0)}|${minY.toFixed(0)}|${maxY.toFixed(0)}|${top.toFixed(0)}`;
    if (frameKey !== this.framed) {
      this.framed = frameKey;
      const dist = Math.max(span, top) * 1.35;
      this.camera.position.copy(V(cx + dist * 0.55, cy - dist * 0.95, top * 0.8 + dist * 0.55));
      this.controls.target.copy(V(cx, cy, top * 0.3));
      this.controls.update();
    }
    this.resize();
  }

  snapshot(p: SiteProject, r: SiteResults | null, width = 960, height = 560): string {
    this.update(p, r);
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.render();
    const url = this.renderer.domElement.toDataURL("image/png");
    if (size.x > 0 && size.y > 0) {
      this.renderer.setSize(size.x, size.y);
      this.camera.aspect = size.x / size.y;
      this.camera.updateProjectionMatrix();
      this.render();
    }
    return url;
  }
}

export const SITE_VIEW_LEGEND = [
  { colour: PALETTE.cyan, label: "Windows" },
  { colour: PALETTE.grey, label: "Doors" },
  { colour: PALETTE.greyMid, label: "Non-fire-resisting wall" },
  { colour: PALETTE.lime, label: "Combustible cladding" },
  { colour: PALETTE.navy, label: "Relevant boundary (solid) and notional boundary (dashed)" },
  { colour: PALETTE.red, label: "Governing point on the boundary" },
];

/** Pointer capture can throw NotFoundError in Safari when the pointer has already ended; ignore it rather than break the gesture. */
function safePointerCapture(el: HTMLElement): void {
  for (const name of ["setPointerCapture", "releasePointerCapture"] as const) {
    const original = el[name].bind(el);
    el[name] = (id: number) => { try { original(id); } catch { /* Pointer no longer active. */ } };
  }
}
