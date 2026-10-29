/** Simple three-dimensional view: façade, openings, boundary plane, receiving plane with heat map, and the required-distance zone. */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Facade } from "../engine/model";
import { FacadeResults } from "../compute";
import { heatMapImage } from "./charts";
import { PALETTE } from "./colours";

const OPENING_COLOURS: Record<string, number> = {
  window: 0x6ad1e3, door: 0x656969, nonFireResistingWall: 0xb2b4b4, combustibleCladding: 0xcedc00,
};

export class View3D {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 0.1, 2000);
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
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(-20, 40, 30);
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

  update(facade: Facade, results: FacadeResults | null) {
    const key = JSON.stringify([facade, results?.key, results?.grid.peak]);
    if (key === this.lastKey) { this.resize(); return; }
    this.lastKey = key;
    this.content.clear();
    const d = Math.max(0.1, facade.boundaryDistance ?? 1);
    const W = facade.width, H = facade.height, cx = W / 2;
    // ground
    const groundSize = Math.max(W, 4 * d) + 30;
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(groundSize, groundSize),
      new THREE.MeshLambertMaterial({ color: 0xe9ecec }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(cx, -0.01, d);
    this.content.add(ground);
    const grid = new THREE.GridHelper(groundSize, Math.round(groundSize), 0xd9dad9, 0xe3e5e5);
    grid.position.set(cx, 0, d);
    this.content.add(grid);
    // façade wall (thickness 0.3 metres behind the plane of reference) and a simple building block
    const depth = Math.max(8, W * 0.5);
    const building = new THREE.Mesh(new THREE.BoxGeometry(W, H, depth), new THREE.MeshLambertMaterial({ color: 0xffffff }));
    building.position.set(cx, H / 2, -depth / 2);
    this.content.add(building);
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(building.geometry), new THREE.LineBasicMaterial({ color: 0x3f4443 }));
    edges.position.copy(building.position);
    this.content.add(edges);
    for (const o of facade.openings) {
      const w = o.xMax - o.xMin, h = o.zMax - o.zMin;
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h),
        new THREE.MeshLambertMaterial({ color: OPENING_COLOURS[o.type], side: THREE.DoubleSide }));
      mesh.position.set(o.xMin + w / 2, o.zMin + h / 2, o.setback > 0 ? -o.setback : 0.02);
      this.content.add(mesh);
      if (o.setback > 0) {
        // recess reveal
        const reveal = new THREE.Mesh(new THREE.BoxGeometry(w, h, o.setback), new THREE.MeshLambertMaterial({ color: 0xd9dad9, side: THREE.BackSide }));
        reveal.position.set(o.xMin + w / 2, o.zMin + h / 2, -o.setback / 2 + 0.01);
        this.content.add(reveal);
      }
      const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.PlaneGeometry(w, h)), new THREE.LineBasicMaterial({ color: 0x002b49 }));
      outline.position.copy(mesh.position);
      outline.position.z += 0.01;
      this.content.add(outline);
    }
    // boundary plane at the entered boundary distance
    const planeWidth = W + 12;
    const boundary = new THREE.Mesh(new THREE.PlaneGeometry(planeWidth, H + 2),
      new THREE.MeshBasicMaterial({ color: 0x006ba6, transparent: true, opacity: 0.12, side: THREE.DoubleSide, depthWrite: false }));
    boundary.position.set(cx, (H + 2) / 2, d);
    this.content.add(boundary);
    const boundaryEdges = new THREE.LineSegments(new THREE.EdgesGeometry(boundary.geometry), new THREE.LineBasicMaterial({ color: 0x006ba6 }));
    boundaryEdges.position.copy(boundary.position);
    this.content.add(boundaryEdges);
    const boundaryLine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(cx - planeWidth / 2, 0.03, d), new THREE.Vector3(cx + planeWidth / 2, 0.03, d)]),
      new THREE.LineDashedMaterial({ color: 0x002b49, dashSize: 0.6, gapSize: 0.4 }));
    boundaryLine.computeLineDistances();
    this.content.add(boundaryLine);
    // receiving plane (mirror-image building face) at twice the boundary distance, with the heat map
    if (results && !results.empty) {
      const g = results.grid;
      const gw = g.x[g.x.length - 1] - g.x[0], gh = g.z[g.z.length - 1] - g.z[0];
      const texture = new THREE.CanvasTexture(heatMapImage(results, true, 4));
      texture.colorSpace = THREE.SRGBColorSpace;
      const receiving = new THREE.Mesh(new THREE.PlaneGeometry(gw, Math.max(0.1, gh)),
        new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, opacity: 0.95 }));
      receiving.position.set(g.x[0] + gw / 2, g.z[0] + gh / 2, 2 * d);
      receiving.rotation.y = Math.PI; // face back towards the burning façade
      receiving.scale.x = -1;          // keep left and right as seen from the façade
      this.content.add(receiving);
      const frame = new THREE.LineSegments(new THREE.EdgesGeometry(receiving.geometry), new THREE.LineBasicMaterial({ color: 0x3f4443 }));
      frame.position.copy(receiving.position);
      this.content.add(frame);
      // required-distance zone on the ground (plan)
      const pts = results.profile.x.map((x, i) => new THREE.Vector3(x, 0.05, results.profile.distance[i]));
      const zone = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xcc1f1d, linewidth: 2 }));
      this.content.add(zone);
      const shape = new THREE.Shape();
      shape.moveTo(results.profile.x[0], 0);
      results.profile.x.forEach((x, i) => shape.lineTo(x, results.profile.distance[i]));
      shape.lineTo(results.profile.x[results.profile.x.length - 1], 0);
      const fill = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: 0xcc1f1d, transparent: true, opacity: 0.15, side: THREE.DoubleSide, depthWrite: false }));
      fill.rotation.x = Math.PI / 2;
      fill.position.y = 0.04;
      this.content.add(fill);
    }
    const frameKey = `${W}-${H}-${d.toFixed(2)}`;
    if (frameKey !== this.framed) {
      this.framed = frameKey;
      const span = Math.max(W, 2 * d, H) * 1.25;
      this.camera.position.set(cx + span * 0.75, H * 0.9 + span * 0.45, 2 * d + span * 0.85);
      this.controls.target.set(cx, H * 0.4, d);
      this.controls.update();
    }
    this.resize();
  }

  /** Image of a façade's view at a fixed size, for the printed report. */
  snapshotFor(facade: Facade, results: FacadeResults | null): string {
    this.update(facade, results);
    const size = new THREE.Vector2();
    this.renderer.getSize(size);
    this.renderer.setSize(960, 520, false);
    this.camera.aspect = 960 / 520;
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

export const VIEW_LEGEND = [
  { colour: PALETTE.cyan, label: "Windows" },
  { colour: PALETTE.grey, label: "Doors" },
  { colour: PALETTE.greyMid, label: "Non-fire-resisting wall" },
  { colour: PALETTE.lime, label: "Combustible cladding" },
  { colour: PALETTE.blue, label: "Boundary plane at the entered boundary distance" },
  { colour: PALETTE.red, label: "Required boundary distance along the boundary (on plan)" },
];

/** Pointer capture can throw NotFoundError in Safari when the pointer has already ended; ignore it rather than break the gesture. */
function safePointerCapture(el: HTMLElement): void {
  for (const name of ["setPointerCapture", "releasePointerCapture"] as const) {
    const original = el[name].bind(el);
    el[name] = (id: number) => { try { original(id); } catch { /* Pointer no longer active. */ } };
  }
}
