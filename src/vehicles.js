// Véhicules : berline modélisée (carrosserie extrudée arrondie, vitrage, roues détaillées) + circulation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

/** Fusionne les meshes d'un groupe par matériau (une voiture passe de ~60 à ~10 appels de rendu). */
function mergeByMaterial(group, skip = () => false) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(), remove = [];
  group.traverse(o => {
    if (!o.isMesh || skip(o)) return;
    const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone());
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    if (!buckets.has(o.material)) buckets.set(o.material, []);
    buckets.get(o.material).push(g); remove.push(o);
  });
  remove.forEach(o => o.parent.remove(o));
  for (const [mat, geos] of buckets) { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = true; m.receiveShadow = true; group.add(m); }
}

const glass = new THREE.MeshPhysicalMaterial({ color: '#0e1416', roughness: 0.05, metalness: 0.1, clearcoat: 1, transparent: true, opacity: 0.88 });
const rubber = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.9 });
const rimMat = new THREE.MeshStandardMaterial({ color: '#b9bcc0', roughness: 0.25, metalness: 0.9 });
const chrome = new THREE.MeshStandardMaterial({ color: '#d8d8d8', roughness: 0.15, metalness: 1 });
const blackTrim = new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.6 });
const plateMat = new THREE.MeshStandardMaterial({ color: '#f2f2ee', roughness: 0.5 });
export const headMat = new THREE.MeshStandardMaterial({ color: '#f4f1e6', emissive: '#fff4d6', emissiveIntensity: 0, roughness: 0.1 });
export const tailMat = new THREE.MeshStandardMaterial({ color: '#7a0d0d', emissive: '#ff2a1a', emissiveIntensity: 0.2, roughness: 0.2 });

function profileShape(pts) {
  const s = new THREE.Shape();
  s.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) {
    const p = pts[i];
    if (p.length === 4) s.quadraticCurveTo(p[0], p[1], p[2], p[3]); else s.lineTo(p[0], p[1]);
  }
  return s;
}
function extrude(shape, width, bevel = 0.07, seg = 6) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: width - bevel * 2, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: seg, curveSegments: 18 });
  g.translate(0, 0, -(width - bevel * 2) / 2);
  return g;
}

function wheel(r = 0.31, w = 0.21) {
  const g = new THREE.Group();
  // pneu (profil arrondi)
  const pts = [];
  for (let i = 0; i <= 12; i++) { const a = -Math.PI / 2 + i / 12 * Math.PI; pts.push(new THREE.Vector2(r - 0.07 + Math.cos(a) * 0.07, Math.sin(a) * w / 2)); }
  const tire = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), rubber); tire.rotation.x = Math.PI / 2; g.add(tire);
  const side = new THREE.Mesh(new THREE.CylinderGeometry(r - 0.075, r - 0.075, w * 0.92, 28), rubber); side.rotation.x = Math.PI / 2; g.add(side);
  // jante à rayons
  const rim = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.66, r * 0.66, 0.02, 24), rimMat); rim.rotation.x = Math.PI / 2; rim.position.z = w / 2 - 0.005; g.add(rim);
  for (let i = 0; i < 5; i++) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.035, r * 0.6, 0.025), rimMat);
    sp.position.set(0, 0, w / 2 + 0.006); sp.rotation.z = i / 5 * Math.PI * 2; sp.translateY(r * 0.3); g.add(sp);
  }
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.04, 12), chrome); hub.rotation.x = Math.PI / 2; hub.position.z = w / 2 + 0.01; g.add(hub);
  mergeByMaterial(g);
  return g;
}

/** Berline type Corolla, très répandue à Abidjan (taxis compteurs, véhicules particuliers). */
export function makeSedan({ color = '#c9cdd1', taxi = false } = {}) {
  const paint = new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, metalness: taxi ? 0.15 : 0.55, clearcoat: 1, clearcoatRoughness: 0.08 });
  const car = new THREE.Group();
  const W = 1.74;
  // caisse basse : pare-chocs, capot, coffre
  const lower = profileShape([[-2.2, 0.3], [2.18, 0.3], [2.25, 0.42, 2.24, 0.6], [2.2, 0.78], [1.5, 0.86, 1.0, 0.92], [-1.6, 0.94], [-2.15, 0.92, -2.22, 0.75], [-2.24, 0.45, -2.2, 0.3]]);
  const body = new THREE.Mesh(extrude(lower, W, 0.1, 8), paint); body.castShadow = body.receiveShadow = true; car.add(body);
  // habitacle vitré
  const cabin = profileShape([[1.05, 0.9], [0.32, 1.38, 0.05, 1.42], [-0.95, 1.42], [-1.25, 1.38, -1.62, 0.92]]);
  const cab = new THREE.Mesh(extrude(cabin, W - 0.22, 0.09, 6), glass); cab.castShadow = true; car.add(cab);
  // toit et montants peints
  const roofS = profileShape([[0.12, 1.405], [0.05, 1.445], [-0.95, 1.445], [-1.05, 1.405]]);
  const roof = new THREE.Mesh(extrude(roofS, W - 0.2, 0.05, 4), paint); roof.position.y = 0.012; car.add(roof);
  for (const side of [-1, 1]) {
    const z = side * (W / 2 - 0.105);
    const pillar = (x0, y0, x1, y1, t = 0.07) => {
      const len = Math.hypot(x1 - x0, y1 - y0);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, t, 0.04), paint);
      m.position.set((x0 + x1) / 2, (y0 + y1) / 2, z); m.rotation.z = Math.atan2(y1 - y0, x1 - x0); car.add(m);
    };
    pillar(1.03, 0.92, 0.25, 1.4);             // montant A
    pillar(-0.32, 0.93, -0.32, 1.43, 0.09);    // montant B
    pillar(-1.6, 0.94, -1.0, 1.41, 0.1);       // montant C
    // poignées, rétroviseur, joints de portières
    for (const hx of [0.05, -0.85]) { const hdl = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), chrome); hdl.position.set(hx, 0.86, side * (W / 2 + 0.01)); car.add(hdl); }
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.18), paint); mir.position.set(0.85, 1.0, side * (W / 2 + 0.06)); car.add(mir);
    for (const x of [0.98, -0.32, -1.5]) { const j = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.5, 0.005), blackTrim); j.position.set(x, 0.62, side * (W / 2 + 0.002)); car.add(j); }
    const sk = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, 0.03), blackTrim); sk.position.set(-0.25, 0.36, side * (W / 2 - 0.005)); car.add(sk);
  }
  // optiques et calandre
  for (const s of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.1, 0.36), headMat); hl.position.set(2.2, 0.72, s * 0.58); hl.rotation.y = s * 0.15; car.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.11, 0.34), tailMat); tl.position.set(-2.23, 0.78, s * 0.6); car.add(tl);
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.62), blackTrim); grille.position.set(2.24, 0.6, 0); car.add(grille);
  for (const x of [2.24, -2.25]) { const pl = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.11, 0.42), plateMat); pl.position.set(x, 0.45, 0); car.add(pl); }
  // passages de roues sombres + roues
  car.wheels = [];
  for (const [x, z] of [[1.33, 1], [1.33, -1], [-1.38, 1], [-1.38, -1]]) {
    const arch = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.2, 20, 1, false, 0, Math.PI), blackTrim);
    arch.rotation.x = Math.PI / 2; arch.position.set(x, 0.33, z * (W / 2 - 0.08)); car.add(arch);
    const wh = wheel(); wh.position.set(x, 0.31, z * (W / 2 - 0.12)); if (z < 0) wh.rotation.y = Math.PI; car.add(wh); car.wheels.push(wh);
  }
  if (taxi) {
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.13, 0.16), new THREE.MeshStandardMaterial({ color: '#f5f0dc', emissive: '#ffe9a0', emissiveIntensity: 0.4, roughness: 0.4 }));
    sign.position.set(-0.45, 1.53, 0); car.add(sign);
    const band = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.06, W + 0.012), new THREE.MeshStandardMaterial({ color: '#1b1b1b', roughness: 0.5 }));
    band.position.set(-0.2, 0.7, 0); car.add(band);
  }
  const wheelParts = new Set(); car.wheels.forEach(w => w.traverse(o => wheelParts.add(o)));
  mergeByMaterial(car, o => wheelParts.has(o));
  car.userData.paint = paint;
  return car;
}

/* ---------------- circulation ---------------- */
export class Traffic {
  constructor(scene, opts) {
    this.scene = scene; this.cars = [];
    this.isObstacle = opts.isObstacle; // (x, z) → true si un piéton/obstacle est là
    this.onHonk = opts.onHonk || (() => {});
    const specs = [
      { color: '#ea6a12', taxi: true }, { color: '#ea6a12', taxi: true }, { color: '#f2f2f0' }, { color: '#1c1d20' },
      { color: '#a7acb2' }, { color: '#7c1d1d' }, { color: '#ea6a12', taxi: true }, { color: '#26456e' },
    ];
    specs.forEach((sp, i) => {
      const dir = i % 2 ? -1 : 1;
      const g = makeSedan(sp);
      g.rotation.y = dir > 0 ? 0 : Math.PI;
      const c = { g, dir, lane: dir > 0 ? 1.75 : -1.75, x: -180 + i * 47 * (dir > 0 ? 1 : -1) % 360, speed: 0, cruise: 8.5 + Math.random() * 3, honkT: 0 };
      c.x = ((c.x + 180) % 360 + 360) % 360 - 180;
      g.position.set(c.x, 0, c.lane);
      scene.add(g); this.cars.push(c);
    });
  }
  /** boîtes englobantes des voitures, pour bloquer le joueur */
  boxes() { return this.cars.map(c => ({ x0: c.x - 2.3, x1: c.x + 2.3, z0: c.lane - 0.95, z1: c.lane + 0.95 })); }
  update(dt, night) {
    headMat.emissiveIntensity = night * 3; tailMat.emissiveIntensity = 0.2 + night * 1.5;
    for (const c of this.cars) {
      // distance libre devant : autres voitures et piétons
      let free = 40;
      for (const o of this.cars) if (o !== c && o.lane === c.lane) { const d = (o.x - c.x) * c.dir; if (d > 0 && d < free) free = d - 5; }
      for (let k = 3; k < 14; k += 1.5) if (this.isObstacle(c.x + c.dir * k, c.lane)) { free = Math.min(free, k - 3.2); break; }
      const target = free < 1.5 ? 0 : Math.min(c.cruise, free * 0.9);
      c.speed += Math.max(-7 * dt, Math.min(2.5 * dt, target - c.speed));
      if (c.speed < 0) c.speed = 0;
      if (free < 3 && c.speed < 0.5) { c.honkT -= dt; if (c.honkT <= 0) { c.honkT = 4 + Math.random() * 4; this.onHonk(c.g.position); } } else c.honkT = 1.2;
      c.x += c.speed * dt * c.dir;
      if (c.x > 200) c.x = -200; if (c.x < -200) c.x = 200;
      c.g.position.x = c.x;
      for (const w of c.g.wheels) w.rotateZ(-c.speed * dt / 0.31 * (w.rotation.y ? -1 : 1));
    }
  }
}
