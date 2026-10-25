// Le quartier : une rue de Marcory au bord de la lagune Ébrié.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Water } from 'three/addons/objects/Water.js';
import { pbr, polyModel, tbox, worldPlane, threeTexture, localModel } from './assets.js';
import { paintedSign, waxTexture, towerTextures } from './proctex.js';
import { makePalm, makeMango, scatterGrass } from './vegetation.js';
import { buildInteriors } from './interiors.js';
import { makeSedan } from './vehicles.js';

export const world = {
  colliders: [],     // AABB {x0,x1,z0,z1}
  circles: [],       // {x,z,r}
  platforms: [],     // {x0,x1,z0,z1,y}
  hotspots: {},      // id → {pos, r, label}
  lights: [],        // {light, base, kind}
  emissives: [],     // matériaux qui s'allument la nuit {mat, base}
  animated: [],      // fn(dt, t)
  waypoints: [],
  grass: [],
  water: null, simpleWater: null, hazeMats: [],
  bounds: { x0: -44, x1: 44, z0: -21, z1: 15.2 },
  area: 'outside',   // zone courante : 'outside', 'studio', 'office'
  areas: {},
  dynamic: () => [], // obstacles mobiles (voitures)
  noMerge: new Set(), // objets animés à ne pas fusionner
};

const rand = (a, b) => a + Math.random() * (b - a);
const pick = a => a[Math.floor(Math.random() * a.length)];
let M = {};
let scene;

/* ---------------- matériaux ---------------- */
const paintCache = new Map();
function paint(color, roughness = 0.55, metalness = 0.15) {
  const k = color + roughness + metalness;
  if (!paintCache.has(k)) paintCache.set(k, new THREE.MeshStandardMaterial({ color, roughness, metalness }));
  return paintCache.get(k);
}
function tinted(base, color) {
  const m = base.clone(); m.color.set(color); m.userData.tile = base.userData.tile; return m;
}
const glassMat = new THREE.MeshStandardMaterial({ color: '#2b3b3c', roughness: 0.06, metalness: 0.3, transparent: true, opacity: 0.72 });
const darkMat = new THREE.MeshStandardMaterial({ color: '#16120e', roughness: 1 });

async function loadMaterials() {
  const [laterite, asphalt, concrete, blocks, plaster, plasterBlue, plasterYellow, cracked, tin, tiles, sand, grass, shutter, metalGreen, wood, palmBark, bark, pavers] = await Promise.all([
    pbr('red_laterite_soil_stones', { tile: 3.2 }),
    pbr('worn_asphalt', { tile: 4 }),
    pbr('concrete_floor_worn_001', { tile: 2.5 }),
    pbr('concrete_block_wall', { tile: 1.6 }),
    pbr('painted_plaster_wall', { tile: 2.6 }),
    pbr('blue_plaster_weathered', { tile: 2.6 }),
    pbr('yellow_plaster', { tile: 2.6 }),
    pbr('worn_cracked_plaster', { tile: 2.2 }),
    pbr('rusty_corrugated_iron', { tile: 2.2, normalScale: 1.4 }),
    pbr('terracotta_floor_tiles', { tile: 1.6 }),
    pbr('coast_sand_01', { tile: 3 }),
    pbr('sparse_grass', { tile: 2.5 }),
    pbr('painted_metal_shutter', { tile: 1.4 }),
    pbr('green_metal_rust', { tile: 1.4 }),
    pbr('weathered_brown_planks', { tile: 2 }),
    pbr('palm_tree_bark', { tile: 0.9 }),
    pbr('bark_brown_02', { tile: 1.2 }),
    pbr('interlocking_concrete_pavers', { tile: 1.6 }),
  ]);
  M = { laterite, asphalt, concrete, blocks, plaster, plasterBlue, plasterYellow, cracked, tin, tiles, sand, grass, shutter, metalGreen, wood, palmBark, bark, pavers };
  M.plinth = tinted(cracked, '#9c8a78');
  M.pink = tinted(plaster, '#e7b9a6');
  M.green = tinted(plaster, '#a9c8a0');
  M.cream = tinted(plaster, '#efe2c8');
  M.ochre = tinted(plaster, '#e3b77a');
  M.lavender = tinted(plaster, '#c7c3df');
  M.wallBlockPlaster = tinted(plaster, '#cfc3b0');
  M.concreteTop = tinted(concrete, '#b9b2a7');
  M.shutterBlue = tinted(shutter, '#4f7fa8');
  M.shutterGreen = tinted(shutter, '#5d8a66');
  M.shutterGrey = tinted(shutter, '#b8b8b0');
  M.gateBlue = tinted(metalGreen, '#3c6e9e');
  M.metal = tinted(metalGreen, '#6f7a6c');
  // pour l'export vers Blender : échelle de répétition des textures et teinte de chaque matériau
  world.matInfo = () => Object.fromEntries(Object.entries(M).map(([k, m]) => [k, { tile: m.userData.tile || 2, color: '#' + m.color.getHexString(), texture: m.name }]));
}

/* ---------------- fusion des géométries statiques ---------------- */
function bake(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const buckets = new Map(), remove = [];
  group.traverse(o => {
    if (!o.isMesh || o.isInstancedMesh || o.userData.keep) return;
    const at = o.geometry.attributes;
    if (at.color || at.aSway || at.aCenter || at.uv1 || o.material.vertexColors) return; // attributs spéciaux : on ne fusionne pas
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld));
    const key = o.material.uuid + (o.castShadow ? 's' : 'n');
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [], cast: o.castShadow });
    buckets.get(key).geos.push(g); remove.push(o);
  });
  remove.forEach(o => o.parent.remove(o));
  for (const b of buckets.values()) {
    const m = new THREE.Mesh(mergeGeometries(b.geos), b.mat);
    m.castShadow = b.cast; m.receiveShadow = true;
    group.add(m);
  }
  return group;
}

function mesh(geo, mat, x = 0, y = 0, z = 0, cast = true) {
  const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; return m;
}
function cyl(r0, r1, h, mat, x, y, z, seg = 10) { return mesh(new THREE.CylinderGeometry(r0, r1, h, seg), mat, x, y, z); }

/** Place une copie d'un modèle Poly Haven. */
async function prop(id, x, y, z, { rotY = 0, scale = 1, tint, sub, dynamic = false } = {}) {
  const src = await polyModel(id);
  const obj = new THREE.Group();
  if (sub) {
    // une seule variante du modèle, recentrée (base au sol, centre en x/z)
    const subs = Array.isArray(sub) ? sub : [sub];
    for (const c of src.children) if (subs.some(s => s instanceof RegExp ? s.test(c.name) : c.name === s)) obj.add(c.clone());
    if (obj.children.length) {
      const bb = new THREE.Box3().setFromObject(obj);
      const off = new THREE.Vector3(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
      obj.children.forEach(c => c.position.add(off));
    }
  } else obj.add(src.clone());
  obj.position.set(x, y, z); obj.rotation.y = rotY; obj.scale.setScalar(scale);
  if (!dynamic) (world.staticProps ||= []).push(obj); else world.noMerge.add(obj);
  if (tint) obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.set(tint); } });
  scene.add(obj);
  return obj;
}

/* ---------------- éléments d'architecture ---------------- */
function windowUnit(w, h, trimMat, { louvers = true, bars = true } = {}) {
  const g = new THREE.Group();
  const fd = 0.1;
  g.add(mesh(new THREE.BoxGeometry(w + 0.12, 0.07, fd), trimMat, 0, h / 2 + 0.035, fd / 2));
  g.add(mesh(new THREE.BoxGeometry(w + 0.12, 0.07, fd), trimMat, 0, -h / 2 - 0.035, fd / 2));
  g.add(mesh(new THREE.BoxGeometry(0.07, h, fd), trimMat, -w / 2 - 0.025, 0, fd / 2));
  g.add(mesh(new THREE.BoxGeometry(0.07, h, fd), trimMat, w / 2 + 0.025, 0, fd / 2));
  g.add(mesh(new THREE.BoxGeometry(w + 0.28, 0.06, 0.2), M.concreteTop, 0, -h / 2 - 0.1, 0.09));
  g.add(mesh(new THREE.PlaneGeometry(w, h), darkMat, 0, 0, 0.004, false));
  if (louvers) { // fenêtres "naco" à lames de verre, typiques d'Abidjan
    const n = Math.max(4, Math.round(h / 0.11));
    const half = w > 1 ? 2 : 1;
    for (let c = 0; c < half; c++) {
      const cw = w / half, cx = -w / 2 + cw * (c + 0.5);
      for (let i = 0; i < n; i++) {
        const s = mesh(new THREE.BoxGeometry(cw - 0.06, h / n * 1.05, 0.005), glassMat, cx, -h / 2 + (i + 0.5) * h / n, 0.035, false);
        s.rotation.x = -0.45; g.add(s);
      }
      if (c === 1) g.add(mesh(new THREE.BoxGeometry(0.04, h, 0.04), trimMat, 0, 0, 0.04));
    }
  }
  if (bars) { // grille anti-effraction
    const nb = Math.round(w / 0.13);
    for (let i = 1; i < nb; i++) g.add(mesh(new THREE.CylinderGeometry(0.009, 0.009, h, 5), trimMat, -w / 2 + i * w / nb, 0, 0.09));
    for (const yy of [-h / 3, h / 3]) { const hb = mesh(new THREE.BoxGeometry(w, 0.025, 0.012), trimMat, 0, yy, 0.09); g.add(hb); }
  }
  return g;
}

function doorUnit(w, h, panelMat, trimMat) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w + 0.14, 0.08, 0.12), trimMat, 0, h + 0.04, 0.03));
  g.add(mesh(new THREE.BoxGeometry(0.07, h, 0.12), trimMat, -w / 2 - 0.035, h / 2, 0.03));
  g.add(mesh(new THREE.BoxGeometry(0.07, h, 0.12), trimMat, w / 2 + 0.035, h / 2, 0.03));
  const p = tbox(w, h, 0.05, panelMat, 0, h / 2, 0.0); g.add(p);
  for (const yy of [0.5, 1.3]) g.add(mesh(new THREE.BoxGeometry(w * 0.8, 0.03, 0.02), trimMat, 0, yy * h / 2.1, 0.035));
  g.add(cyl(0.015, 0.015, 0.14, paint('#c9b27a', 0.3, 0.9), w / 2 - 0.12, h * 0.48, 0.07));
  return g;
}

function corrugated(w, len, tile = 2.2) {
  const pitch = 0.076, amp = 0.016;
  const seg = Math.ceil(w / pitch * 4);
  const g = new THREE.PlaneGeometry(w, len, seg, 1);
  const p = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    p.setZ(i, Math.sin(p.getX(i) / pitch * Math.PI * 2) * amp);
    uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * len / tile);
  }
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

function polytank(x, y, z) { // réservoir d'eau noir sur le toit
  const pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(0.55 + Math.sin(t * Math.PI * 6) * 0.015 - (t > 0.9 ? (t - 0.9) * 3 : 0), t * 1.2)); }
  pts.push(new THREE.Vector2(0.15, 1.28), new THREE.Vector2(0, 1.28));
  const m = mesh(new THREE.LatheGeometry(pts, 24), paint('#1a1a1a', 0.5, 0), x, y, z);
  return m;
}
function satDish(x, y, z, rotY) {
  const g = new THREE.Group();
  const pts = []; for (let i = 0; i <= 10; i++) { const r = i / 10 * 0.42; pts.push(new THREE.Vector2(r, r * r * 0.9)); }
  const d = mesh(new THREE.LatheGeometry(pts, 20), paint('#d9d9d4', 0.4, 0.2), 0, 0.6, 0);
  d.rotation.x = -1.1; g.add(d);
  g.add(cyl(0.025, 0.025, 0.7, M.metal, 0, 0.3, -0.05));
  g.position.set(x, y, z); g.rotation.y = rotY;
  return g;
}

function signBoard(tex, w, h) {
  const g = new THREE.Group();
  g.add(mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.04), paint('#3a2f25', 0.8, 0.1), 0, 0, -0.01));
  const face = mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75 }), 0, 0, 0.012, false);
  g.add(face);
  return g;
}

/**
 * Bâtiment de rue : rez-de-chaussée creux avec ouvertures, étages pleins, toit plat/tôle/inachevé.
 * Façade côté +z (rue), posée à zFront.
 */
/** Clé d'un matériau (pour la description exportée vers Blender) : nom dans M, ou peinture 'paint:#couleur:rugosité:métal'. */
function matKey(mat) {
  if (!mat) return null;
  const k = Object.keys(M).find(n => M[n] === mat); if (k) return k;
  // matériau texturé teinté (tinted) : texture d'origine + couleur
  const base = mat.map && Object.keys(M).find(n => M[n].map === mat.map && M[n].color.getHex() === 0xffffff);
  if (base) return 'tint:' + base + ':#' + mat.color.getHexString();
  return 'paint:#' + mat.color.getHexString() + ':' + mat.roughness + ':' + mat.metalness;
}
let buildingCount = 0;
function building(o) {
  const { x, zFront, w, d, floors = 1, fh = 3.2, wall, trim = paint('#e9e4d8'), roof = 'flat', openings = [], windows = 2, balcony = false } = o;
  const id = 'b' + (buildingCount++);
  // description exportable (tools/blender/build_city.py reconstruit ce bâtiment en détail)
  (world.buildingSpecs ||= []).push({ id, x, zFront, w, d, floors, fh, roof, windows, balcony, unfinished: !!o.unfinished, tank: o.tank !== false,
    wall: matKey(wall), upperWall: matKey(o.upperWall || wall), trim: matKey(trim), floorMat: matKey(o.floorMat || M.tiles),
    openings: openings.map(op => ({ type: op.type, x: op.x, w: op.w, h: op.h || (op.type === 'window' ? 1.2 : 2.2), mat: matKey(op.mat || M.shutterBlue) })) });
  const baked = world.bakedCity && world.bakedCity.get(id);
  if (baked) { // version Blender : géométrie détaillée + ombres de contact précalculées
    scene.add(baked); world.noMerge.add(baked); // pas de fusion : elle effacerait l'atlas précalculé (UV1)
    if (floors > 1 && o.ac !== false) for (let f = 1; f < (o.unfinished ? floors - 1 : floors); f++) if (Math.random() < 0.8) world._ac.push({ x: x + rand(-w / 3, w / 3), y: f * fh + 0.5, z: zFront + 0.2 });
    world.colliders.push({ x0: x - w / 2 - 0.15, x1: x + w / 2 + 0.15, z0: zFront - d - 0.15, z1: zFront + (balcony ? 0.2 : 0.12), h: floors * fh + 1.2 });
    return baked;
  }
  const g = new THREE.Group();
  g.position.set(x, 0, zFront - d / 2);
  const t = 0.22, H = floors * fh;
  const fz = d / 2;
  // rez-de-chaussée : murs latéraux, arrière, façade percée
  g.add(tbox(t, fh, d, wall, -w / 2 + t / 2, fh / 2, 0));
  g.add(tbox(t, fh, d, wall, w / 2 - t / 2, fh / 2, 0));
  g.add(tbox(w, fh, t, wall, 0, fh / 2, -d / 2 + t / 2));
  const holes = openings.filter(op => op.type !== 'window').sort((a, b) => a.x - b.x);
  let cursor = -w / 2;
  for (const hl of holes) {
    const l = hl.x - hl.w / 2;
    if (l > cursor + 0.01) g.add(tbox(l - cursor, fh, t, wall, (cursor + l) / 2, fh / 2, fz - t / 2));
    g.add(tbox(hl.w, fh - hl.h, t, wall, hl.x, hl.h + (fh - hl.h) / 2, fz - t / 2));
    cursor = hl.x + hl.w / 2;
  }
  if (cursor < w / 2 - 0.01) g.add(tbox(w / 2 - cursor, fh, t, wall, (cursor + w / 2) / 2, fh / 2, fz - t / 2));
  // plafond du RDC + intérieur
  g.add(tbox(w, 0.2, d, M.concreteTop, 0, fh - 0.1, 0));
  g.add(tbox(w - 0.1, 0.06, d - 0.1, o.floorMat || M.tiles, 0, 0.03, 0));
  // soubassement sali par les éclaboussures de latérite
  const pl = 0.5;
  const plinthSegs = [];
  cursor = -w / 2;
  for (const hl of holes) { const l = hl.x - hl.w / 2; if (l > cursor) plinthSegs.push([cursor, l]); cursor = hl.x + hl.w / 2; }
  if (cursor < w / 2) plinthSegs.push([cursor, w / 2]);
  for (const [a, b] of plinthSegs) g.add(tbox(b - a, pl, 0.03, M.plinth, (a + b) / 2, pl / 2, fz + 0.012));
  g.add(tbox(0.03, pl, d, M.plinth, -w / 2 - 0.012, pl / 2, 0));
  g.add(tbox(0.03, pl, d, M.plinth, w / 2 + 0.012, pl / 2, 0));

  // étages
  if (floors > 1) {
    const upH = (floors - 1) * fh;
    if (o.unfinished) {
      // dernier niveau en parpaings non enduits, poteaux et fers en attente
      if (floors > 2) g.add(tbox(w, (floors - 2) * fh, d, wall, 0, fh + (floors - 2) * fh / 2, 0));
      const y0 = (floors - 1) * fh;
      const wh = 1.9;
      g.add(tbox(w, wh, 0.2, M.blocks, 0, y0 + wh / 2, fz - 0.1));
      g.add(tbox(0.2, wh * 0.7, d, M.blocks, -w / 2 + 0.1, y0 + wh * 0.35, 0));
      g.add(tbox(0.2, wh, d, M.blocks, w / 2 - 0.1, y0 + wh / 2, 0));
      g.add(tbox(w, 0.2, d, M.concreteTop, 0, y0 + 0.02, 0));
      const rebarMat = paint('#5a3a26', 0.7, 0.6);
      for (const cx of [-w / 2 + 0.15, 0, w / 2 - 0.15]) for (const cz of [fz - 0.15, -fz + 0.15]) {
        g.add(tbox(0.25, fh + 0.2, 0.25, M.concreteTop, cx, y0 + (fh + 0.2) / 2, cz));
        for (const ox of [-0.07, 0.07]) for (const oz of [-0.07, 0.07]) {
          const rb = cyl(0.007, 0.007, 0.9, rebarMat, cx + ox, y0 + fh + 0.6, cz + oz, 4); rb.rotation.z = rand(-0.12, 0.12); g.add(rb);
        }
      }
    } else {
      g.add(tbox(w, upH, d, o.upperWall || wall, 0, fh + upH / 2, 0));
    }
    // bandeaux de dalle
    for (let f = 1; f < floors; f++) g.add(tbox(w + 0.14, 0.22, d + 0.14, M.concreteTop, 0, f * fh, 0));
    // fenêtres des étages
    const topF = o.unfinished ? floors - 1 : floors;
    for (let f = 1; f < topF; f++) {
      for (let i = 0; i < windows; i++) {
        const wx = -w / 2 + (i + 0.5) * w / windows;
        if (balcony && i === Math.floor(windows / 2) && windows % 2 === 1) continue;
        const wu = windowUnit(1.3, 1.25, trim); wu.position.set(wx, f * fh + 1.55, fz); g.add(wu);
      }
      // fenêtres latérales
      for (const sx of [-1, 1]) { const wu = windowUnit(0.9, 1.1, trim); wu.position.set(sx * w / 2, f * fh + 1.55, -d / 6); wu.rotation.y = sx * Math.PI / 2; g.add(wu); }
      if (balcony) {
        const bw = Math.min(3.2, w * 0.5), by = f * fh;
        g.add(tbox(bw, 0.16, 1.1, M.concreteTop, 0, by + 0.08, fz + 0.55));
        const rail = paint('#2d2d2b', 0.5, 0.6);
        g.add(mesh(new THREE.BoxGeometry(bw, 0.05, 0.05), rail, 0, by + 1.05, fz + 1.08));
        for (let i = 0; i <= bw / 0.12; i++) g.add(cyl(0.008, 0.008, 0.9, rail, -bw / 2 + i * 0.12, by + 0.6, fz + 1.08, 4));
        for (const sx of [-1, 1]) for (let i = 0; i <= 8; i++) g.add(cyl(0.008, 0.008, 0.9, rail, sx * bw / 2, by + 0.6, fz + i * 0.135, 4));
        g.add(doorUnit(0.9, 2.1, M.shutterGrey, trim).translateX(0).translateY(by + 0.16).translateZ(fz));
      }
      // climatiseur
      if (o.ac !== false && Math.random() < 0.8) world._ac.push({ x: x + rand(-w / 3, w / 3), y: f * fh + 0.5, z: zFront + 0.2 });
    }
  }
  // fenêtres du RDC
  for (const op of openings.filter(op => op.type === 'window')) { const wu = windowUnit(op.w, op.h || 1.2, trim); wu.position.set(op.x, 1.55, fz); g.add(wu); }
  // portes
  for (const op of holes) {
    if (op.type === 'door') g.add(doorUnit(op.w - 0.14, op.h - 0.08, op.mat || M.shutterBlue, trim).translateX(op.x).translateZ(fz - 0.1));
  }
  // toit
  if (roof === 'flat' && !o.unfinished) {
    g.add(tbox(w, 0.18, d, M.concreteTop, 0, H + 0.09, 0));
    for (const [px, pz, pw, pd] of [[0, fz - 0.08, w, 0.16], [0, -fz + 0.08, w, 0.16], [-w / 2 + 0.08, 0, 0.16, d], [w / 2 - 0.08, 0, 0.16, d]])
      g.add(tbox(pw, 0.75, pd, o.upperWall || wall, px, H + 0.55, pz));
    g.add(tbox(w + 0.06, 0.08, d + 0.06, M.concreteTop, 0, H + 0.96, 0));
    if (o.tank !== false) g.add(polytank(w / 2 - 1, H + 0.18, -d / 2 + 1));
    if (Math.random() < 0.7) g.add(satDish(-w / 2 + 1, H + 0.18, -d / 2 + 1.2, rand(-0.6, 0.6)));
  } else if (roof === 'tin') {
    const ov = 0.55, rl = d + ov * 2, slope = 0.13;
    const r = new THREE.Mesh(corrugated(w + ov * 2, rl / Math.cos(slope)), M.tin);
    r.rotation.x = slope; r.position.set(0, H + 0.25 + Math.tan(slope) * 0.0, 0); r.castShadow = r.receiveShadow = true;
    r.material.side = THREE.DoubleSide;
    g.add(r);
    g.add(tbox(w + ov * 2, 0.22, 0.04, M.wood, 0, H + 0.25 + Math.tan(slope) * rl / 2 - 0.12, rl / 2));
    // pignons pour fermer sous la tôle
    g.add(tbox(w, 0.6, d, wall, 0, H + 0.2, 0));
  }
  bake(g);
  scene.add(g);
  world.colliders.push({ x0: x - w / 2 - 0.15, x1: x + w / 2 + 0.15, z0: zFront - d - 0.15, z1: zFront + (balcony ? 0.2 : 0.12), h: H + 1.2 });
  return g;
}

/* ---------------- bâtiments construits dans Blender (tools/blender/build_city.py) ---------------- */
/** Matériau du jeu à partir de sa clé (nom du matériau dans le .glb). */
function matFromKey(key) {
  if (M[key]) return M[key];
  if (key === 'glass') return glassMat;
  if (key === 'dark') return darkMat;
  const p = key.split(':');
  if (p[0] === 'tint' && M[p[1]]) return tinted(M[p[1]], p[2]);
  if (p[0] === 'paint') return paint(p[1], +p[2], +p[3]);
  return paint('#bbbbbb');
}
/** Ajoute l'atlas précalculé (R : occlusion ambiante, G : salissure) à un matériau PBR du jeu. */
function withBake(base, bakeTex) {
  const m = base.clone();
  m.userData.tile = base.userData.tile;
  const u = { value: bakeTex };
  m.onBeforeCompile = sh => {
    sh.uniforms.uBake = u;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec2 uvBake; varying vec2 vBake;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvBake = uvBake;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform sampler2D uBake; varying vec2 vBake;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nvec4 bakeS = texture2D(uBake, vBake);\ndiffuseColor.rgb *= bakeS.g;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= bakeS.r;\nreflectedLight.indirectSpecular *= bakeS.r;\nreflectedLight.directDiffuse *= mix(1.0, bakeS.r, 0.35);');
  };
  m.customProgramCacheKey = () => 'babi-bake-' + (base.map ? 'm' : 'c') + (base.normalMap ? 'n' : '') + (base.aoMap ? 'a' : '') + (base.transparent ? 't' : '');
  return m;
}
async function loadBakedCity() {
  let g;
  try { g = await localModel('assets/city/rue_lagune.glb'); } catch (e) { console.warn('[babi] bâtiments Blender absents, version code', e); return; }
  world.bakedCity = new Map();
  const cache = new Map();
  for (const node of [...g.scene.children]) {
    node.traverse(o => {
      if (!o.isMesh) return;
      const key = o.material.name, bakeTex = o.material.map;
      if (bakeTex) { bakeTex.colorSpace = THREE.NoColorSpace; bakeTex.channel = 0; bakeTex.needsUpdate = true; }
      const geo = o.geometry;
      if (geo.attributes.uv1) { geo.setAttribute('uvBake', geo.attributes.uv1); geo.deleteAttribute('uv1'); }
      if (!cache.has(key)) cache.set(key, withBake(matFromKey(key), bakeTex));
      o.material = cache.get(key);
      o.castShadow = o.receiveShadow = true;
      o.userData.keep = true;
    });
    world.bakedCity.set(node.name, node);
  }
}

/* ---------------- sol, route, caniveaux ---------------- */
function grassPatch(x, z, w, d, rot = 0) {
  const geo = worldPlane(w, d, M.grass.userData.tile);
  geo.setAttribute('uv1', geo.attributes.uv.clone());
  const uv1 = geo.attributes.uv1; for (let i = 0; i < uv1.count; i++) uv1.setXY(i, i % 2, i < 2 ? 1 : 0);
  // contour irrégulier (alpha) pour fondre l'herbe dans la latérite
  const c = document.createElement('canvas'); c.width = c.height = 128; const gg = c.getContext('2d');
  const img = gg.createImageData(128, 128);
  const seed = Math.random() * 100;
  for (let j = 0; j < 128; j++) for (let i = 0; i < 128; i++) {
    const dx = (i - 64) / 64, dz = (j - 64) / 64;
    const n = Math.sin(i * 0.31 + seed) * Math.cos(j * 0.27 + seed * 2) * 0.12 + (Math.random() - 0.5) * 0.35;
    const v = 1 - Math.pow(Math.max(Math.abs(dx), Math.abs(dz)) * 0.6 + Math.hypot(dx, dz) * 0.4, 2.2) + n;
    const a = v > 0.35 ? 255 : 0; const k = (j * 128 + i) * 4; img.data[k] = img.data[k + 1] = img.data[k + 2] = a; img.data[k + 3] = 255;
  }
  gg.putImageData(img, 0, 0);
  const am = new THREE.CanvasTexture(c); am.channel = 1;
  const mat = M.grass.clone(); mat.alphaMap = am; mat.alphaTest = 0.5; mat.polygonOffset = true; mat.polygonOffsetFactor = -2;
  const m = mesh(geo, mat, x, 0.015, z, false); m.rotation.set(-Math.PI / 2, 0, rot);
  scene.add(m);
  return { x0: x - w * 0.35, x1: x + w * 0.35, z0: z - d * 0.35, z1: z + d * 0.35 };
}

function decal(x, z, w, d, color, opacity, rot = 0) { // flaques, nids-de-poule, taches d'huile
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 4, 64, 64, 62); grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.6, 'rgba(255,255,255,.7)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.beginPath();
  for (let i = 0; i <= 20; i++) { const a = i / 20 * Math.PI * 2, r = 50 + Math.random() * 12; g.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r); }
  g.fill();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.15, transparent: true, opacity, alphaMap: new THREE.CanvasTexture(c), depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
  const m = mesh(new THREE.PlaneGeometry(w, d), mat, x, 0.07, z, false); m.rotation.set(-Math.PI / 2, 0, rot);
  scene.add(m);
}

function drain(z, x0, x1, gaps) { // caniveau à ciel ouvert le long de la route
  const g = new THREE.Group();
  const w = 0.7, depth = 0.55;
  g.add(tbox(x1 - x0, 0.08, w, tinted(M.concrete, '#4d4a42'), (x0 + x1) / 2, -depth, z));
  for (const s of [-1, 1]) g.add(tbox(x1 - x0, depth + 0.12, 0.12, M.concreteTop, (x0 + x1) / 2, -depth / 2 + 0.06, z + s * (w / 2 + 0.06)));
  // eau stagnante sombre
  const wm = new THREE.MeshStandardMaterial({ color: '#2a2a1e', roughness: 0.05, metalness: 0.1 });
  g.add(mesh(new THREE.PlaneGeometry(x1 - x0, w).rotateX(-Math.PI / 2), wm, (x0 + x1) / 2, -depth + 0.1, z, false));
  // dalles de passage
  let cx = x0;
  for (const [ga, gb] of gaps) {
    g.add(tbox(gb - ga, 0.14, w + 0.3, M.concreteTop, (ga + gb) / 2, 0.02, z));
    if (ga > cx) world.colliders.push({ x0: cx, x1: ga, z0: z - w / 2 - 0.1, z1: z + w / 2 + 0.1 });
    cx = gb;
  }
  if (cx < x1) world.colliders.push({ x0: cx, x1: x1, z0: z - w / 2 - 0.1, z1: z + w / 2 + 0.1 });
  bake(g); scene.add(g);
}

function groundAndRoad() {
  const ground = mesh(worldPlane(560, 240, M.laterite.userData.tile), M.laterite, 0, 0, 0, false);
  ground.rotation.x = -Math.PI / 2; ground.position.z = 15.6 - 120; // couvre z -224 → 15.6
  scene.add(ground);
  // route goudronnée abîmée
  const road = tbox(560, 0.06, 7, M.asphalt, 0, 0.0, 0); road.castShadow = false; scene.add(road);
  const rg = new THREE.Group();
  // bords effrités
  for (const s of [-1, 1]) for (let x = -270; x < 270; x += rand(1.2, 3)) {
    const e = tbox(rand(0.6, 2), 0.05, rand(0.15, 0.4), M.asphalt, x, 0, s * (3.5 + rand(0, 0.15))); e.castShadow = false; rg.add(e);
  }
  // marquage central effacé
  const lineMat = new THREE.MeshStandardMaterial({ color: '#cfc8b4', roughness: 0.8, transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });
  for (let x = -270; x < 270; x += 6) if (Math.random() > 0.2) { const l = mesh(new THREE.PlaneGeometry(rand(1.8, 3), 0.12).rotateX(-Math.PI / 2), lineMat, x, 0.035, 0, false); rg.add(l); }
  bake(rg); scene.add(rg);
  // nids-de-poule et flaques
  for (let i = 0; i < 9; i++) decal(rand(-40, 40), rand(-3, 3), rand(0.6, 1.6), rand(0.5, 1.2), '#1e1b17', 0.55, rand(0, 3));
  for (let i = 0; i < 6; i++) decal(rand(-40, 40), pick([-5.2, 5.6, 6.5]), rand(0.8, 2), rand(0.5, 1.2), '#3a2414', 0.45, rand(0, 3));
  // ralentisseur ("gendarme couché")
  const bump = mesh(new THREE.CylinderGeometry(0.5, 0.5, 7, 16, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateY(Math.PI / 2).scale(1, 0.2, 1), M.asphalt, -6, 0.0, 0, false);
  bump.rotation.y = Math.PI / 2; scene.add(bump);
  const bumpPaint = mesh(new THREE.PlaneGeometry(0.15, 7).rotateX(-Math.PI / 2), lineMat, -6, 0.105, 0, false); scene.add(bumpPaint);

  // caniveaux avec passages devant chaque entrée
  drain(-3.95, -60, 60, [[-36.5, -33.5], [-26, -22.5], [-16, -8], [-1, 2.5], [9.5, 12.5], [21, 23]]);
  drain(3.95, -60, 60, [[-17, -13], [-5, -2], [3, 6], [9, 13], [24, 29.5]]);
}

/* ---------------- poteaux et câbles électriques ---------------- */
function wire(a, b, sag, mat, list) {
  const pts = [];
  for (let i = 0; i <= 16; i++) { const t = i / 16; const p = a.clone().lerp(b, t); p.y -= Math.sin(t * Math.PI) * sag; pts.push(p); }
  list.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 16, 0.011, 4, false));
}
function poles() {
  const wood = tinted(M.wood, '#6b5a48');
  const xs = [-42, -24, -6, 12, 30, 46];
  const wires = [];
  const tops = [];
  const g = new THREE.Group();
  for (const x of xs) {
    const z = 5.05;
    const p = mesh(new THREE.CylinderGeometry(0.11, 0.16, 9, 10), wood, x, 4.5, z); g.add(p);
    g.add(tbox(1.8, 0.12, 0.12, wood, x, 8.4, z));
    const ins = paint('#e8e4da', 0.3, 0);
    for (const ox of [-0.75, 0, 0.75]) g.add(cyl(0.035, 0.05, 0.16, ins, x + ox, 8.54, z));
    g.add(tbox(0.25, 0.35, 0.18, paint('#7d7d78', 0.6, 0.5), x, 6.6, z + 0.15)); // boîtier
    tops.push(x);
    world.circles.push({ x, z, r: 0.25 });
  }
  const wm = new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 });
  for (let i = 0; i < tops.length - 1; i++) for (const ox of [-0.75, 0, 0.75])
    wire(new THREE.Vector3(tops[i] + ox, 8.6, 5.05), new THREE.Vector3(tops[i + 1] + ox, 8.6, 5.05), 0.55 + Math.random() * 0.2, wm, wires);
  // branchements vers les façades
  for (const [px, hx, hy] of [[-42, -36, 3.9], [-24, -24, 5.5], [-6, -12, 3.6], [-6, 1, 3.4], [12, 11, 5.6], [30, 22, 8.5], [30, 35, 5.5]])
    wire(new THREE.Vector3(px, 8.2, 5.05), new THREE.Vector3(hx, hy, -7), 0.6, wm, wires);
  const wiresMesh = new THREE.Mesh(mergeGeometries(wires), wm); wiresMesh.castShadow = true;
  g.add(wiresMesh);
  bake(g); scene.add(g);
}

/* ---------------- lampes ---------------- */
/**
 * Les lampes sont des "emplacements" : un petit pool de PointLight est réaffecté à la zone courante
 * (quartier ou intérieur), pour ne jamais calculer plus de ~10 lumières par pixel.
 */
function addLight(color, intensity, distance, x, y, z, kind = 'warm', area = 'outside', extra = {}) {
  const l = { color: new THREE.Color(color), distance, position: new THREE.Vector3(x, y, z), intensity: intensity, area, ...extra };
  world.lights.push({ light: l, base: intensity, kind, area, daylight: extra.daylight });
  return l;
}
function glowMat(color, strength = 3) {
  const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0, roughness: 0.4 });
  world.emissives.push({ mat: m, base: strength });
  return m;
}

/* ---------------- le maquis ---------------- */
async function maquis() {
  const X = -12, Z0 = -7.6, W = 9, D = 8; // terrasse x -16.5..-7.5, z -15.6..-7.6
  const g = new THREE.Group();
  // dalle carrelée surélevée
  g.add(tbox(W, 0.2, D, M.tiles, X, 0.1, Z0 - D / 2));
  g.add(tbox(W + 0.1, 0.06, 0.25, M.concreteTop, X, 0.18, Z0 + 0.05));
  world.platforms.push({ x0: X - W / 2, x1: X + W / 2, z0: Z0 - D, z1: Z0 + 0.12, y: 0.2 });
  // muret avant avec peinture publicitaire et ouverture centrale
  const wallMat = M.ochre;
  for (const [cx, ww] of [[X - 3.2, 2.6], [X + 3.2, 2.6]]) {
    g.add(tbox(ww, 0.9, 0.18, wallMat, cx, 0.65, Z0 - 0.15));
    g.add(tbox(ww + 0.06, 0.06, 0.24, M.concreteTop, cx, 1.12, Z0 - 0.15));
  }
  // poteaux métalliques + charpente
  const posts = [];
  for (const px of [X - W / 2 + 0.2, X, X + W / 2 - 0.2]) for (const pz of [Z0 - 0.3, Z0 - D / 2, Z0 - D + 1.6]) {
    g.add(cyl(0.06, 0.06, 3.0, M.metal, px, 1.7, pz, 8)); posts.push([px, pz]);
    if (pz !== Z0 - D / 2) world.circles.push({ x: px, z: pz, r: 0.12 });
  }
  for (const pz of [Z0 - 0.3, Z0 - D / 2, Z0 - D + 1.6]) g.add(tbox(W, 0.14, 0.08, M.wood, X, 3.15 + (Z0 - 0.3 - pz) * 0.06, pz));
  for (let px = X - W / 2; px <= X + W / 2 + 0.01; px += 1.5) g.add(tbox(0.07, 0.12, D, M.wood, px, 3.32, Z0 - D / 2).rotateX(-0.06));
  const roof = new THREE.Mesh(corrugated(W + 1, D + 0.9), M.tin);
  roof.rotation.x = -0.06; roof.position.set(X, 3.45, Z0 - D / 2 + 0.2); roof.castShadow = roof.receiveShadow = true;
  g.add(roof);
  // cuisine / bar au fond (bâtiment bleu)
  g.add(tbox(W, 3.2, 0.2, M.plasterBlue, X, 1.6 + 0.2, Z0 - D + 0.1));
  g.add(tbox(0.2, 3.2, 1.6, M.plasterBlue, X - W / 2 + 0.1, 1.8, Z0 - D + 0.8));
  g.add(tbox(0.2, 3.2, 1.6, M.plasterBlue, X + W / 2 - 0.1, 1.8, Z0 - D + 0.8));
  // comptoir
  g.add(tbox(4.2, 1.05, 0.55, M.wood, X - 1.5, 0.72, Z0 - D + 1.75));
  g.add(tbox(4.4, 0.06, 0.7, paint('#5b4636', 0.5, 0), X - 1.5, 1.27, Z0 - D + 1.75));
  // frigo vitré
  const fr = new THREE.Group();
  fr.add(tbox(0.8, 1.9, 0.7, M.shutterGrey, 0, 0.95, 0));
  fr.add(mesh(new THREE.PlaneGeometry(0.62, 1.4), glowMat('#cfe8ff', 0.6), 0, 1.15, 0.352, false));
  for (let i = 0; i < 4; i++) for (let k = 0; k < 6; k++) fr.add(cyl(0.03, 0.03, 0.24, paint(pick(['#5a2b10', '#1c5a24', '#a8201a', '#d8a020']), 0.2, 0), -0.24 + k * 0.096, 0.6 + i * 0.32, 0.25, 8));
  fr.position.set(X + 2.6, 0.2, Z0 - D + 0.6); g.add(fr);
  world.colliders.push({ x0: X - 3.7, x1: X + 3.1, z0: Z0 - D, z1: Z0 - D + 2.1, h: 1.3 });

  // panneau peint sur le muret
  const tex = paintedSign({ w: 1024, h: 256, bg: '#b8321e', border: '#f6e7c8', seed: 3,
    lines: [{ text: "MAQUIS LE JARDIN D'AWA", size: 0.42, color: '#fff3d6', shadow: '#5a160c' }, { text: 'POISSON BRAISÉ · POULET · ALLOCO · GARBA', size: 0.2, font: 'Oswald', weight: 700, color: '#ffd36a' }] });
  const sb = signBoard(tex, 3.6, 0.9); sb.position.set(X, 3.85, Z0 - 0.1); g.add(sb);
  const ad = paintedSign({ w: 512, h: 256, bg: '#e9d9b0', border: null, seed: 5, lines: [{ text: 'GARBA 300F', size: 0.42, color: '#1b4f9c' }, { text: 'Attiéké · Thon frit', size: 0.22, font: 'Permanent Marker', color: '#a3281a' }] });
  const adm = mesh(new THREE.PlaneGeometry(2.2, 0.75), new THREE.MeshStandardMaterial({ map: ad, roughness: 0.9 }), X - 3.2, 0.66, Z0 - 0.05, false); g.add(adm);

  bake(g); scene.add(g);

  // guirlande d'ampoules
  const bulbMat = glowMat('#ffd38a', 6);
  const bulbs = [], wires = [];
  const wm = new THREE.MeshStandardMaterial({ color: '#111', roughness: 0.7 });
  const runs = [[[X - W / 2 + 0.2, 2.9, Z0 - 0.3], [X + W / 2 - 0.2, 2.9, Z0 - 0.3]], [[X - W / 2 + 0.2, 3.0, Z0 - D / 2], [X + W / 2 - 0.2, 3.0, Z0 - D / 2]], [[X - W / 2 + 0.2, 2.9, Z0 - 0.3], [X + W / 2 - 0.2, 3.0, Z0 - D / 2]]];
  for (const [a, b] of runs) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    wire(A, B, 0.3, wm, wires);
    for (let i = 1; i < 12; i++) { const t = i / 12; const p = A.clone().lerp(B, t); p.y -= Math.sin(t * Math.PI) * 0.3 + 0.08; const s = new THREE.SphereGeometry(0.045, 8, 6); s.translate(p.x, p.y, p.z); bulbs.push(s); }
  }
  scene.add(mesh(mergeGeometries(bulbs), bulbMat, 0, 0, 0, false));
  scene.add(mesh(mergeGeometries(wires), wm, 0, 0, 0, false));
  addLight('#ffbf70', 9, 13, X - 2, 2.6, Z0 - 2.5);
  addLight('#ffbf70', 9, 13, X + 2.5, 2.6, Z0 - 4.5);
  // néon du bar
  const neon = mesh(new THREE.BoxGeometry(1.2, 0.04, 0.04), glowMat('#e8f4ff', 4), X - 1.5, 2.9, Z0 - D + 0.3, false); scene.add(neon);
  addLight('#dbe9ff', 5, 8, X - 1.5, 2.6, Z0 - D + 1);

  // tables nappées de wax et chaises monobloc
  const tables = [[X - 2.8, Z0 - 2.0], [X + 0.2, Z0 - 2.2], [X + 3.0, Z0 - 2.0], [X - 2.6, Z0 - 4.6], [X + 0.6, Z0 - 4.9], [X + 3.2, Z0 - 4.5]];
  world.maquisSeats = [];
  for (let i = 0; i < tables.length; i++) {
    const [tx, tz] = tables[i];
    const t = new THREE.Group();
    const cloth = new THREE.MeshStandardMaterial({ map: waxTexture(i + 1), roughness: 0.85 });
    cloth.map.repeat.set(1.5, 1.5);
    t.add(mesh(new THREE.BoxGeometry(0.95, 0.03, 0.95), cloth, 0, 0.74, 0));
    for (const [sx, sz, ry] of [[0, 0.49, 0], [0, -0.49, 0], [0.49, 0, Math.PI / 2], [-0.49, 0, Math.PI / 2]]) {
      const f = mesh(new THREE.PlaneGeometry(0.97, 0.26), cloth, sx, 0.62, sz, false); f.rotation.y = ry; f.material.side = THREE.DoubleSide; t.add(f);
    }
    for (const [lx, lz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]]) t.add(cyl(0.02, 0.02, 0.72, paint('#ddd', 0.4, 0.6), lx, 0.36, lz, 6));
    // bouteilles et verres
    for (let k = 0; k < 2 + Math.floor(Math.random() * 3); k++) {
      const bx = rand(-0.3, 0.3), bz = rand(-0.3, 0.3);
      t.add(cyl(0.035, 0.035, 0.2, paint(pick(['#4a2208', '#1d4d20']), 0.12, 0.05), bx, 0.86, bz, 10));
      t.add(cyl(0.012, 0.03, 0.08, paint(pick(['#4a2208', '#1d4d20']), 0.12, 0.05), bx, 1.0, bz, 8));
    }
    t.position.set(tx, 0.2, tz);
    bake(t); scene.add(t);
    world.circles.push({ x: tx, z: tz, r: 0.6 });
    const seats = [[0, 0.8, Math.PI], [0, -0.8, 0], [0.8, 0, -Math.PI / 2], [-0.8, 0, Math.PI / 2]];
    for (const [cx, cz, ry] of seats) {
      if (Math.random() < 0.15) continue;
      const tint = Math.random() < 0.25 ? pick(['#c0392b', '#2e7d32', '#1f5fa8']) : undefined;
      await prop('plastic_monobloc_chair_01', tx + cx, 0.2, tz + cz, { rotY: ry + rand(-0.2, 0.2), tint });
      world.maquisSeats.push({ x: tx + cx * 0.92, z: tz + cz * 0.92, rotY: ry + Math.PI, table: i });
    }
  }
  // casiers de bouteilles, chevalet du menu, sono, ventilateurs
  for (let i = 0; i < 4; i++) await prop(pick(['plastic_crate_01', 'plastic_crate_02']), X + 3.7 + (i % 2) * 0.5, 0.2 + Math.floor(i / 2) * 0.31, Z0 - D + 2.4, { tint: pick(['#c0392b', '#e0a000', '#1f5fa8']) });
  await prop('standing_chalkboard_01', X + 1.4, 0.0, Z0 + 0.7, { rotY: 0.3 });
  const menu = paintedSign({ w: 512, h: 512, bg: '#1d2420', border: null, seed: 9, wear: 0.5, lines: [
    { text: 'MENU DU JOUR', size: 0.12, font: 'Permanent Marker', color: '#f2efe2' },
    { text: 'Poisson braisé 2500', size: 0.085, font: 'Permanent Marker', color: '#ffe07a' },
    { text: 'Poulet braisé 3000', size: 0.085, font: 'Permanent Marker', color: '#ffe07a' },
    { text: 'Alloco 500 · Garba 300', size: 0.085, font: 'Permanent Marker', color: '#ffe07a' },
    { text: 'Bissap · Gnamakoudji', size: 0.085, font: 'Permanent Marker', color: '#9fe0ff' },
  ] });
  const mm = mesh(new THREE.PlaneGeometry(0.62, 0.62), new THREE.MeshStandardMaterial({ map: menu, roughness: 0.95 }), 0, 0, 0, false);
  mm.position.set(X + 1.4 + 0.02, 0.98, Z0 + 0.7 + 0.24); mm.rotation.set(-0.27, 0.3, 0); scene.add(mm);
  await prop('boombox', X - 2.6, 1.3, Z0 - D + 1.75, { rotY: 0.2 });
  for (const fx of [X - 2, X + 2]) {
    const fan = await prop('ceiling_fan', fx, 2.75, Z0 - 3.4, { dynamic: true });
    const blades = fan.getObjectByName('ceiling_fan_blades');
    if (blades) world.animated.push(dt => { blades.rotation.y += dt * 6; });
  }
  await prop('portable_generator', X - W / 2 - 0.8, 0, Z0 - D + 1.2, { rotY: 1.2 });
  world.circles.push({ x: X - W / 2 - 0.8, z: Z0 - D + 1.2, r: 0.5 });

  // grill à poisson : demi-fût sur pieds, braises et fumée
  const grill = new THREE.Group();
  const drum = mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.95, 18, 1, true, 0, Math.PI).rotateZ(Math.PI / 2), paint('#2a2622', 0.7, 0.6), 0, 0.85, 0);
  drum.rotation.y = 0; drum.material.side = THREE.DoubleSide; grill.add(drum);
  for (const [lx, lz] of [[-0.4, -0.2], [0.4, -0.2], [-0.4, 0.2], [0.4, 0.2]]) { const l = cyl(0.012, 0.012, 0.85, paint('#3a2a20', 0.8, 0.5), lx, 0.42, lz, 5); grill.add(l); }
  const coalMat = glowMat('#ff5a1a', 3.2); world.emissives[world.emissives.length - 1].always = true;
  for (let i = 0; i < 26; i++) { const c = mesh(new THREE.DodecahedronGeometry(rand(0.03, 0.05)), coalMat, rand(-0.38, 0.38), 0.82, rand(-0.15, 0.15), false); grill.add(c); }
  const grid = new THREE.Group();
  for (let i = 0; i < 10; i++) grid.add(cyl(0.004, 0.004, 0.62, paint('#555', 0.5, 0.8), -0.4 + i * 0.09, 0.9, 0, 4).rotateX(Math.PI / 2));
  grill.add(grid);
  for (let i = 0; i < 3; i++) { // poissons
    const f = mesh(new THREE.SphereGeometry(0.06, 10, 8).scale(3.2, 0.6, 1), paint('#6b4a2a', 0.5, 0), -0.28 + i * 0.28, 0.93, 0); grill.add(f);
  }
  grill.position.set(X - W / 2 + 1.2, 0.2, Z0 - 0.9); grill.rotation.y = 0.1;
  scene.add(grill);
  world.circles.push({ x: X - W / 2 + 1.2, z: Z0 - 0.9, r: 0.55 });
  const ember = addLight('#ff7a30', 2.5, 4, X - W / 2 + 1.2, 1.2, Z0 - 0.9, 'ember');
  world.animated.push((dt, t) => { coalMat.emissiveIntensity = 2.6 + Math.sin(t * 7) * 0.4 + Math.sin(t * 13.3) * 0.3; ember.intensity = 2 + Math.sin(t * 9) * 0.4; });
  smoke(new THREE.Vector3(X - W / 2 + 1.2, 1.1, Z0 - 0.9));

  world.hotspots.maquis = { pos: new THREE.Vector3(X - 1.5, 0.2, Z0 - D + 2.6), r: 1.8, label: "Commander au maquis" };
  world.hotspots.maquisSeat = { pos: new THREE.Vector3(X + 0.2, 0.2, Z0 - 3.4), r: 2.2, label: 'S\'asseoir et se détendre' };
  world.maquisCenter = new THREE.Vector3(X, 0.2, Z0 - 3.5);
}

function smoke(origin) {
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 2, 32, 32, 30); grd.addColorStop(0, 'rgba(255,255,255,.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  const parts = [];
  for (let i = 0; i < 22; i++) {
    const m = new THREE.SpriteMaterial({ map: tex, color: '#cfc9c0', transparent: true, depthWrite: false, opacity: 0 });
    const s = new THREE.Sprite(m); scene.add(s);
    parts.push({ s, life: Math.random() * 4 });
  }
  world.animated.push((dt) => {
    for (const p of parts) {
      p.life += dt;
      if (p.life > 4) p.life = 0;
      const k = p.life / 4;
      p.s.position.set(origin.x + Math.sin(p.life * 1.3 + p.s.id) * 0.2 + k * 0.8, origin.y + k * 3.2, origin.z + k * 0.4);
      p.s.scale.setScalar(0.3 + k * 1.8);
      p.s.material.opacity = Math.sin(k * Math.PI) * 0.28;
    }
  });
}

/* ---------------- intérieur de boutique ---------------- */
function shopInterior(x, zFront, w, d, kind) {
  const g = new THREE.Group();
  const backZ = zFront - d + 0.35;
  const shelfMat = tinted(M.wood, '#8a6a4a');
  if (kind === 'boutique') {
    for (const [sx, sz, sw, ry] of [[x, backZ, w - 0.8, 0], [x - w / 2 + 0.45, zFront - d / 2, d - 1.4, Math.PI / 2], [x + w / 2 - 0.45, zFront - d / 2, d - 1.4, Math.PI / 2]]) {
      const s = new THREE.Group();
      for (let lv = 0; lv < 5; lv++) {
        s.add(tbox(sw, 0.04, 0.42, shelfMat, 0, 0.25 + lv * 0.42, 0));
        for (let k = 0; k < sw / 0.11; k++) {
          const px = -sw / 2 + 0.06 + k * 0.11;
          if (Math.random() < 0.6) s.add(cyl(0.04, 0.04, 0.12, paint(pick(['#c62828', '#f9a825', '#2e7d32', '#1565c0', '#eeeeee', '#ef6c00']), 0.35, 0.4), px, 0.33 + lv * 0.42, rand(-0.1, 0.1), 8));
          else s.add(mesh(new THREE.BoxGeometry(0.09, rand(0.14, 0.3), 0.07), paint(pick(['#fafafa', '#ffeb3b', '#e53935', '#1e88e5', '#43a047', '#8d6e63']), 0.6, 0), px, 0.4 + lv * 0.42, 0));
        }
      }
      s.add(tbox(sw, 2.3, 0.04, shelfMat, 0, 1.15, -0.21));
      s.position.set(sx, 0.06, sz); s.rotation.y = ry; g.add(s);
    }
    g.add(tbox(2.4, 1.0, 0.6, shelfMat, x + 0.4, 0.5, zFront - 1.4)); // comptoir
    for (let k = 0; k < 6; k++) g.add(mesh(new THREE.BoxGeometry(0.25, 0.3, 0.2), paint(pick(['#ffd54f', '#e53935', '#90caf9']), 0.6, 0), x - 0.4 + k * 0.3, 1.15, zFront - 1.4));
  } else if (kind === 'couture') {
    for (let k = 0; k < 9; k++) {
      const roll = mesh(new THREE.CylinderGeometry(0.09, 0.09, 1.2, 14).rotateZ(Math.PI / 2), new THREE.MeshStandardMaterial({ map: waxTexture(k + 3), roughness: 0.85 }), x - w / 2 + 1 + (k % 3) * 0.2, 0.6 + Math.floor(k / 3) * 0.2, backZ + 0.2);
      g.add(roll);
    }
    g.add(tbox(2, 0.05, 0.9, shelfMat, x + 0.6, 0.85, zFront - 2.4));
    for (const [lx, lz] of [[-0.9, -0.4], [0.9, -0.4], [-0.9, 0.4], [0.9, 0.4]]) g.add(cyl(0.025, 0.025, 0.85, M.metal, x + 0.6 + lx, 0.43, zFront - 2.4 + lz, 6));
    // machine à coudre (silhouette)
    const sm = new THREE.Group(); const smm = paint('#1c1c1c', 0.3, 0.5);
    sm.add(mesh(new THREE.BoxGeometry(0.42, 0.06, 0.18), smm, 0, 0, 0)); sm.add(mesh(new THREE.BoxGeometry(0.08, 0.22, 0.12), smm, 0.17, 0.13, 0)); sm.add(mesh(new THREE.BoxGeometry(0.42, 0.08, 0.12), smm, 0, 0.27, 0)); sm.add(mesh(new THREE.BoxGeometry(0.06, 0.12, 0.06), smm, -0.17, 0.18, 0));
    sm.position.set(x + 0.4, 0.92, zFront - 2.4); g.add(sm);
    // vêtements suspendus
    g.add(cyl(0.015, 0.015, w - 1, M.metal, x, 2.2, backZ + 0.6).rotateZ(Math.PI / 2));
    for (let k = 0; k < 6; k++) { const c = mesh(new THREE.PlaneGeometry(0.5, 1.05), new THREE.MeshStandardMaterial({ map: waxTexture(k + 11), roughness: 0.9, side: THREE.DoubleSide }), x - w / 2 + 1 + k * 0.55, 1.65, backZ + 0.6, false); c.rotation.y = 0.3; g.add(c); }
  }
  // tube fluo au plafond
  g.add(mesh(new THREE.BoxGeometry(1.2, 0.04, 0.05), glowMat('#eef6ff', 3), x, 3.0, zFront - d / 2, false));
  bake(g); scene.add(g);
}

/* ---------------- rue : façades nord ---------------- */
async function northStreet() {
  // 1. immeuble inachevé dont le RDC est "À LOUER"
  building({ x: -35, zFront: -7, w: 8, d: 9, floors: 2, wall: M.cream, roof: 'flat', unfinished: true,
    openings: [{ type: 'shop', x: 0, w: 3.6, h: 2.6 }, { type: 'window', x: 3, w: 1.0 }] });
  // rideau métallique fermé + inscription
  const sh = await prop('rollershutter_window_01', -35, 0.02, -6.92, { sub: 'rollershutter_window_01_graffiti' });
  sh.position.z = -6.85;
  sh.scale.set(3.6 / 2.1, 2.6 / 1.9, 1);
  const alouer = paintedSign({ w: 1024, h: 384, bg: '#efe6d2', border: null, seed: 21, lines: [{ text: 'À LOUER', size: 0.42, color: '#b3261e', font: 'Anton' }, { text: 'TÉL. 07 48 12 •• ••', size: 0.2, color: '#1d1d1d', font: 'Permanent Marker' }] });
  const al = mesh(new THREE.PlaneGeometry(2.8, 1.05), new THREE.MeshStandardMaterial({ map: alouer, roughness: 0.9 }), -35, 2.85, -6.86, false); scene.add(al);
  world.alouerMesh = al;
  world.hotspots.alouer = { pos: new THREE.Vector3(-35, 0, -5.6), r: 1.6, label: 'Le local à louer' };

  // 2. Alimentation "Chez Moussa" (R+1 bleu, balcon)
  building({ x: -24.3, zFront: -7, w: 7, d: 9, floors: 2, wall: M.plasterBlue, upperWall: M.plasterBlue, trim: paint('#e8e2d0'), roof: 'flat', balcony: true, windows: 3,
    openings: [{ type: 'shop', x: -0.3, w: 3.4, h: 2.55 }, { type: 'door', x: 2.5, w: 1.0, h: 2.2, mat: M.shutterGreen }] });
  shopInterior(-24.6, -7, 6.4, 8.6, 'boutique');
  const shRaised = await prop('rollershutter_window_01', -24.6, 2.25, -6.85, { sub: 'rollershutter_window_01' });
  shRaised.scale.set(3.4 / 2.1, 0.32, 1);
  const bTex = paintedSign({ w: 1024, h: 256, bg: '#f2c230', border: '#1f3f8a', seed: 7, lines: [{ text: 'ALIMENTATION GÉNÉRALE', size: 0.34, color: '#1f3f8a' }, { text: 'CHEZ MOUSSA — Riz · Huile · Sucre · Crédit', size: 0.2, font: 'Oswald', weight: 700, color: '#a0281c' }] });
  const bs = signBoard(bTex, 4.2, 1.05); bs.position.set(-24.3, 2.75, -6.78); scene.add(bs);
  addLight('#eef4ff', 6, 9, -24.6, 2.6, -8.6, 'cool');
  for (let i = 0; i < 5; i++) await prop('plastic_jerrycan', -27.6 + i * 0.36, 0.12, -6.3 + rand(-0.1, 0.1), { rotY: rand(0, 6), tint: pick(['#e8c21a', '#e8c21a', '#2f6fb0', '#d0d0c8']) });
  await prop('cardboard_box_01', -22.1, 0.12, -6.4, { rotY: 0.3 }); await prop('cardboard_box_01', -22.0, 0.43, -6.45, { rotY: -0.2 });
  await prop('wooden_stool_01', -26.2, 0.12, -5.8);
  world.circles.push({ x: -26.9, z: -6.3, r: 0.7 }, { x: -22.1, z: -6.4, r: 0.45 });
  world.hotspots.boutique = { pos: new THREE.Vector3(-24.6, 0, -5.7), r: 1.6, label: 'Boutique de Moussa' };

  // 3. le maquis (géré à part)
  await maquis();

  // 4. cour commune (maison du joueur)
  await courtyard();

  // 5. atelier de couture (R+1 jaune)
  building({ x: 11, zFront: -7, w: 7, d: 9, floors: 2, wall: M.plasterYellow, upperWall: M.plasterYellow, trim: paint('#5a3b2a'), roof: 'flat', windows: 2,
    openings: [{ type: 'shop', x: 0, w: 2.6, h: 2.5 }, { type: 'window', x: -2.5, w: 1.0 }, { type: 'window', x: 2.5, w: 1.0 }] });
  shopInterior(11, -7, 6.4, 8.6, 'couture');
  const cTex = paintedSign({ w: 1024, h: 256, bg: '#2b2240', border: '#e6c36a', seed: 11, lines: [{ text: 'ATELIER DE COUTURE', size: 0.32, color: '#f5e6c0' }, { text: '« ÉLÉGANCE » — Mode africaine · Hommes & Dames', size: 0.19, font: 'Oswald', weight: 500, color: '#e6c36a' }] });
  const cs = signBoard(cTex, 4.2, 1.05); cs.position.set(11, 2.95, -6.78); scene.add(cs);
  // pagnes exposés en façade
  const rod = cyl(0.015, 0.015, 6, M.metal, 11, 2.35, -6.55); rod.rotation.z = Math.PI / 2; scene.add(rod);
  world.cloths = [];
  for (const k of [0, 1, 4, 5]) {
    const c = mesh(new THREE.PlaneGeometry(0.75, 1.7, 1, 6).translate(0, -0.85, 0), new THREE.MeshStandardMaterial({ map: waxTexture(k + 20), roughness: 0.9, side: THREE.DoubleSide }), 11 - 2.7 + k * 0.92, 2.35, -6.5);
    scene.add(c); world.cloths.push(c);
  }
  addLight('#eef4ff', 5, 8, 11, 2.6, -8.6, 'cool');
  world.hotspots.atelier = { pos: new THREE.Vector3(11, 0, -5.7), r: 1.6, label: 'Atelier de couture' };

  // 6. immeuble de bureaux moderne : Babi Digital
  officeBuilding(22.5, -7.4);

  // 7. maison basse au toit de tôle (décor)
  building({ x: 34, zFront: -7.2, w: 9, d: 8, floors: 1, wall: M.green, trim: paint('#7a4b2a'), roof: 'tin',
    openings: [{ type: 'door', x: -1.5, w: 1.0, h: 2.2, mat: M.shutterBlue }, { type: 'window', x: 1.5, w: 1.3 }, { type: 'window', x: -3.6, w: 0.9 }] });
  const vul = paintedSign({ w: 512, h: 256, bg: '#efe8d8', border: null, seed: 17, lines: [{ text: 'VULCANISATEUR', size: 0.24, color: '#1d1d1d' }, { text: 'Pneus · Chambres à air', size: 0.15, font: 'Permanent Marker', color: '#a3281a' }] });
  const vm = mesh(new THREE.PlaneGeometry(2.2, 1.1), new THREE.MeshStandardMaterial({ map: vul, roughness: 0.9 }), 36.6, 1.9, -7.08, false); scene.add(vm);
  for (let i = 0; i < 4; i++) await prop('old_tyre', 38.2 + (i % 2) * 0.1, 0.42 + Math.floor(i / 2) * 0.62, -6.4, { rotY: Math.PI / 2 + rand(-0.2, 0.2) });
  world.circles.push({ x: 38.2, z: -6.4, r: 0.5 });

  // façade ouest de fermeture
  building({ x: -44, zFront: -7, w: 8, d: 9, floors: 2, wall: M.lavender, upperWall: M.lavender, roof: 'flat', windows: 2, openings: [{ type: 'door', x: 0, w: 1, h: 2.2 }] });
}

/* ---------------- immeuble de bureaux ---------------- */
function officeBuilding(x, zFront) {
  const w = 10, d = 10, floors = 4, fh = 3.3, H = floors * fh;
  const facade = tinted(M.plaster, '#e9e7e2');
  building({ x, zFront, w, d, floors, fh, wall: facade, upperWall: facade, trim: paint('#2f3338', 0.4, 0.7), roof: 'flat', windows: 0, ac: false, tank: false,
    floorMat: tinted(M.concrete, '#cfcac2'), openings: [{ type: 'shop', x: -0.5, w: 4.2, h: 2.9 }] });
  const g = new THREE.Group();
  const fz = zFront + 0.02;
  // mur-rideau vitré sur les étages (verre réfléchissant + montants aluminium)
  const cw = new THREE.MeshPhysicalMaterial({ color: '#5d7c86', metalness: 0.9, roughness: 0.08, envMapIntensity: 1.4 });
  const alu = paint('#2f3338', 0.35, 0.8);
  for (let f = 1; f < floors; f++) {
    const y0 = f * fh + 0.15, hh = fh - 0.3;
    g.add(mesh(new THREE.PlaneGeometry(w - 0.8, hh), cw, x, y0 + hh / 2, fz + 0.03, false));
    for (let i = 0; i <= 6; i++) g.add(mesh(new THREE.BoxGeometry(0.07, hh, 0.09), alu, x - (w - 0.8) / 2 + i * (w - 0.8) / 6, y0 + hh / 2, fz + 0.06));
    g.add(mesh(new THREE.BoxGeometry(w - 0.8, 0.07, 0.09), alu, x, y0 + 1.0, fz + 0.06));
  }
  // hall vitré, portes et auvent
  const lobbyGlass = new THREE.MeshPhysicalMaterial({ color: '#9fb6bc', metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.35 });
  const lg = mesh(new THREE.PlaneGeometry(4.2, 2.9), lobbyGlass, x - 0.5, 1.45, zFront - 0.12, false); lg.userData.keep = true; g.add(lg);
  for (const ox of [-2.6, -1.25, 0.1, 1.6]) g.add(mesh(new THREE.BoxGeometry(0.06, 2.9, 0.08), alu, x + ox, 1.45, zFront - 0.1));
  g.add(mesh(new THREE.BoxGeometry(4.4, 0.08, 0.08), alu, x - 0.5, 2.42, zFront - 0.1));
  g.add(tbox(5.2, 0.18, 1.8, M.concreteTop, x - 0.5, 3.15, zFront + 0.85));
  for (const ox of [-2.9, 1.9]) g.add(cyl(0.06, 0.06, 3.1, alu, x + ox, 1.55, zFront + 1.6, 10));
  // enseigne lumineuse
  const sTex = paintedSign({ w: 1024, h: 200, bg: '#13202b', border: null, seed: 51, wear: 0.05, lines: [{ text: 'BABI DIGITAL', size: 0.5, color: '#f08a24', font: 'Oswald', weight: 700 }, { text: 'Solutions web & mobile', size: 0.2, color: '#e8e8e8', font: 'Inter' }] });
  const sm = new THREE.MeshStandardMaterial({ map: sTex, emissiveMap: sTex, emissive: '#ffffff', emissiveIntensity: 0, roughness: 0.5 });
  world.emissives.push({ mat: sm, base: 0.8 });
  const sign = mesh(new THREE.PlaneGeometry(4.6, 0.9), sm, x - 0.5, 3.75, zFront + 1.76, false); g.add(sign);
  // intérieur du hall (accueil visible à travers la vitre)
  g.add(tbox(1.8, 1.0, 0.5, paint('#f2efe8', 0.4, 0), x - 0.5, 0.5, zFront - 3));
  g.add(mesh(new THREE.BoxGeometry(2.5, 0.04, 0.6), glowMat('#f4f8ff', 2), x - 0.5, 3.15, zFront - 2.5, false));
  bake(g); scene.add(g);
  world.hotspots.officeDoor = { pos: new THREE.Vector3(x - 0.5, 0, zFront + 0.9), r: 1.4, label: 'Entrer chez Babi Digital', door: 'office' };
  world.places = world.places || {};
  world.places.office = { x: x - 0.5, z: zFront + 0.9, name: 'Babi Digital' };
}

/** Arrêt de woro-woro (taxi collectif) : abri, banc, panneau. */
function woroStop(id, x, z, name) {
  const g = new THREE.Group();
  const metal = paint('#2c5d3f', 0.45, 0.6);
  for (const ox of [-1.4, 1.4]) g.add(cyl(0.05, 0.05, 2.5, metal, x + ox, 1.25, z + 0.5, 8));
  const roof = new THREE.Mesh(corrugated(3.2, 1.6), M.tin); roof.position.set(x, 2.5, z + 0.1); roof.rotation.x = -0.08; roof.castShadow = true; g.add(roof);
  g.add(tbox(2.6, 0.06, 0.4, M.wood, x, 0.45, z + 0.3));
  for (const ox of [-1.1, 1.1]) g.add(cyl(0.03, 0.03, 0.45, metal, x + ox, 0.22, z + 0.3, 6));
  const tex = paintedSign({ w: 512, h: 512, bg: '#f2c230', border: '#1b1b1b', seed: id.length * 7, wear: 0.6, lines: [{ text: 'WORO-WORO', size: 0.16, color: '#1b1b1b' }, { text: name, size: 0.1, color: '#1b1b1b', font: 'Oswald', weight: 700 }, { text: '300 F', size: 0.16, color: '#a3281a' }] });
  const s = signBoard(tex, 0.7, 0.7); s.position.set(x + 1.9, 2.0, z + 0.5); g.add(s);
  g.add(cyl(0.04, 0.04, 2.0, metal, x + 1.9, 1.0, z + 0.45, 8));
  bake(g); scene.add(g);
  world.colliders.push({ x0: x - 1.35, x1: x + 1.35, z0: z + 0.15, z1: z + 0.5, h: 0.5 });
  world.circles.push({ x: x + 1.9, z: z + 0.45, r: 0.12 });
  world.hotspots['woro_' + id] = { pos: new THREE.Vector3(x, 0, z - 0.4), r: 1.6, label: 'Prendre un woro-woro (300 FCFA)', woro: id };
  world.places = world.places || {};
  world.places['woro_' + id] = { x, z: z - 0.4, name: 'Arrêt ' + name };
}

/** Trottoir pavé avec bordure (côté nord de la rue). */
function sidewalks() {
  const pav = M.pavers;
  const g = new THREE.Group();
  const segs = [[-60, -16.6], [-7.4, 60]];
  for (const [a, b] of segs) {
    g.add(tbox(b - a, 0.12, 2.6, pav, (a + b) / 2, 0.06, -5.65));
    g.add(tbox(b - a, 0.16, 0.14, M.concreteTop, (a + b) / 2, 0.08, -4.38));
    world.platforms.push({ x0: a, x1: b, z0: -6.95, z1: -4.3, y: 0.12 });
  }
  bake(g); scene.add(g);
}

/* ---------------- cour commune ---------------- */
async function courtyard() {
  const X = 0.8, ZF = -7; // entrée sur la rue
  const g = new THREE.Group();
  const wallM = M.wallBlockPlaster;
  // mur de clôture avec portail
  g.add(tbox(3.2, 2.3, 0.2, wallM, X - 3.0, 1.15, ZF - 0.1));
  g.add(tbox(3.2, 2.3, 0.2, wallM, X + 3.0, 1.15, ZF - 0.1));
  g.add(tbox(0.2, 2.3, 9, wallM, X - 4.5, 1.15, ZF - 4.5));
  g.add(tbox(0.2, 2.3, 9, wallM, X + 4.5, 1.15, ZF - 4.5));
  for (const sx of [-1, 1]) g.add(tbox(0.4, 2.6, 0.4, M.concreteTop, X + sx * 1.6, 1.3, ZF - 0.1));
  for (const [px, pz, pw, pd] of [[X - 3.0, ZF - 0.1, 3.2, 0.26], [X + 3.0, ZF - 0.1, 3.2, 0.26], [X - 4.5, ZF - 4.5, 0.26, 9], [X + 4.5, ZF - 4.5, 0.26, 9]]) g.add(tbox(pw, 0.06, pd, M.concreteTop, px, 2.33, pz));
  // portail métallique entrouvert
  const gate = new THREE.Group();
  gate.add(tbox(1.35, 2.0, 0.04, M.gateBlue, 0.675, 1.05, 0));
  for (let i = 0; i < 9; i++) gate.add(cyl(0.012, 0.012, 0.5, M.gateBlue, 0.07 + i * 0.15, 2.3, 0, 5));
  gate.position.set(X + 1.4, 0, ZF - 0.12); gate.rotation.y = 1.45; g.add(gate);
  const gate2 = gate.clone(); gate2.position.set(X - 1.4, 0, ZF - 0.12); gate2.rotation.y = 1.7; g.add(gate2);
  // dalle de la cour
  g.add(tbox(8.8, 0.06, 4.4, tinted(M.concrete, '#a59c8e'), X, 0.03, ZF - 2.3));
  // maison au toit de tôle
  bake(g); scene.add(g);
  world.colliders.push({ x0: X - 4.7, x1: X - 1.45, z0: ZF - 0.3, z1: ZF + 0.12, h: 2.4 }, { x0: X + 1.45, x1: X + 4.7, z0: ZF - 0.3, z1: ZF + 0.12, h: 2.4 });
  world.colliders.push({ x0: X - 4.75, x1: X - 4.25, z0: ZF - 9, z1: ZF, h: 2.4 }, { x0: X + 4.25, x1: X + 4.75, z0: ZF - 9, z1: ZF, h: 2.4 });
  building({ x: X, zFront: ZF - 4.6, w: 8.6, d: 6, floors: 1, wall: M.cream, trim: paint('#6b3f22'), roof: 'tin',
    openings: [{ type: 'door', x: -1.2, w: 1.0, h: 2.2, mat: M.shutterGreen }, { type: 'window', x: 1.6, w: 1.3 }, { type: 'window', x: -3.3, w: 0.9 }] });
  // corde à linge avec pagnes qui sèchent
  const wm = new THREE.MeshStandardMaterial({ color: '#d8d0c0', roughness: 0.8 });
  const lw = []; wire(new THREE.Vector3(X - 4.3, 1.9, ZF - 2.6), new THREE.Vector3(X + 4.3, 1.9, ZF - 1.9), 0.25, wm, lw);
  scene.add(mesh(mergeGeometries(lw), wm, 0, 0, 0, false));
  world.cloths = world.cloths || [];
  for (let i = 0; i < 5; i++) {
    const t = (i + 0.7) / 6;
    const px = X - 4.3 + t * 8.6, pz = ZF - 2.6 + t * 0.7, py = 1.9 - Math.sin(t * Math.PI) * 0.25;
    const c = mesh(new THREE.PlaneGeometry(rand(0.9, 1.3), rand(0.9, 1.3), 1, 6), new THREE.MeshStandardMaterial({ map: waxTexture(i + 30), roughness: 0.92, side: THREE.DoubleSide }), px, py, pz);
    c.geometry.translate(0, -c.geometry.parameters.height / 2, 0);
    c.rotation.y = -0.08; scene.add(c); world.cloths.push(c);
  }
  // seaux, bidons, chaises, plantes
  await prop('plastic_monobloc_chair_01', X + 2.6, 0.06, ZF - 3.6, { rotY: 2.6 });
  await prop('plastic_monobloc_chair_01', X + 3.4, 0.06, ZF - 3.2, { rotY: 3.4, tint: '#c0392b' });
  await prop('plastic_jerrycan', X - 3.8, 0.06, ZF - 4.0, { tint: '#e8c21a' });
  await prop('plastic_jerrycan', X - 3.5, 0.06, ZF - 4.2, { tint: '#2f6fb0', rotY: 1 });
  await prop('wicker_basket_01', X - 2.8, 0.06, ZF - 1.0);
  await prop('calathea_orbifolia_01', X + 3.9, 0.06, ZF - 0.7, { scale: 1.6, sub: /_a$/ });
  await prop('fern_02', X - 3.9, 0.06, ZF - 0.8, { scale: 1.3, sub: /_b$/ });
  world.circles.push({ x: X + 3, z: ZF - 3.4, r: 0.7 }, { x: X - 3.6, z: ZF - 4.1, r: 0.4 });
  world.hotspots.homeDoor = { pos: new THREE.Vector3(X - 1.2, 0, ZF - 3.9), r: 1.4, label: 'Entrer dans ton studio', door: 'studio' };
  world.places = world.places || {};
  world.places.home = { x: X - 1.2, z: ZF - 3.9, name: 'Ton studio' };
  world.spawn = new THREE.Vector3(X, 0, ZF + 1.6);
}

/* ---------------- côté sud : étal, promenade, lagune ---------------- */
async function southSide() {
  // étal de marché sous parasol
  const SX = 10.5, SZ = 6.3;
  const g = new THREE.Group();
  g.add(tbox(2.4, 0.06, 1.1, M.wood, SX, 0.82, SZ));
  for (const [lx, lz] of [[-1.1, -0.45], [1.1, -0.45], [-1.1, 0.45], [1.1, 0.45]]) g.add(tbox(0.07, 0.8, 0.07, M.wood, SX + lx, 0.4, SZ + lz));
  g.add(tbox(2.4, 0.04, 1.1, M.wood, SX, 0.25, SZ));
  // parasol rayé
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const cg = c.getContext('2d');
  for (let i = 0; i < 8; i++) { cg.fillStyle = i % 2 ? '#f2f0e8' : '#d8452b'; cg.fillRect(i * 64, 0, 64, 64); }
  const umb = mesh(new THREE.ConeGeometry(1.9, 0.6, 16, 1, true), new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c), side: THREE.DoubleSide, roughness: 0.85 }), SX, 2.55, SZ);
  umb.material.map.colorSpace = THREE.SRGBColorSpace; g.add(umb);
  g.add(cyl(0.025, 0.025, 2.5, M.metal, SX + 0.2, 1.25, SZ - 0.1, 6));
  // tomates, oignons, piments en tas
  const tom = paint('#c8281e', 0.35, 0), oni = paint('#b58a5a', 0.5, 0), pim = paint('#e06a10', 0.4, 0), aub = paint('#e8e0c0', 0.5, 0);
  for (const [cx, mat, r] of [[-0.75, tom, 0.04], [-0.1, oni, 0.045], [0.55, pim, 0.022]])
    for (let k = 0; k < 22; k++) { const a = k * 2.4, rr = Math.sqrt(k) * r * 0.9; g.add(mesh(new THREE.SphereGeometry(r, 10, 8), mat, SX + cx + Math.cos(a) * rr, 0.87 + r + (k < 6 ? r * 1.3 : 0), SZ + 0.1 + Math.sin(a) * rr * 0.8)); }
  for (let k = 0; k < 10; k++) g.add(mesh(new THREE.SphereGeometry(0.05, 10, 8).scale(1, 1.6, 1), aub, SX + 0.9 + rand(-0.12, 0.12), 0.25 + 0.08, SZ + rand(-0.3, 0.3)));
  bake(g); scene.add(g);
  await prop('bananas', SX + 0.9, 0.85, SZ - 0.2, { scale: 1.4, rotY: 0.5, sub: 'bananas_bunch' });
  await prop('bananas', SX + 1.0, 0.85, SZ + 0.25, { scale: 1.3, rotY: 2.1, sub: 'bananas_bunch' });
  await prop('wicker_basket_02', SX - 0.4, 0.27, SZ - 0.1);
  await prop('plastic_crate_02', SX - 1.6, 0.0, SZ + 0.4, { tint: '#2e7d32' });
  await prop('wooden_stool_01', SX - 0.3, 0.0, SZ - 1.0);
  world.colliders.push({ x0: SX - 1.3, x1: SX + 1.3, z0: SZ - 0.6, z1: SZ + 0.6 });
  world.hotspots.etal = { pos: new THREE.Vector3(SX - 0.2, 0, SZ - 1.25), r: 1.5, label: "L'étal de Maman Adjoua" };

  // voiture bâchée garée
  await prop('covered_car', 36, 0, 6.6, { rotY: Math.PI / 2 + 0.05 });
  world.colliders.push({ x0: 33.7, x1: 38.3, z0: 5.6, z1: 7.6 });
  for (const [px, col] of [[-27, '#f2f2f0'], [17.5, '#2a2c30']]) {
    const car = makeSedan({ color: col }); car.position.set(px, 0, 5.75); car.rotation.y = Math.PI; scene.add(car);
    world.colliders.push({ x0: px - 2.3, x1: px + 2.3, z0: 4.85, z1: 6.65, h: 1.4 });
  }
  woroStop('cour', -3.5, 5.0, 'Cour Kouassi');
  woroStop('bureau', 27.5, 5.0, 'Babi Digital');
  await prop('metal_trash_can', -9.5, 0, 5.5, { sub: /^metal_trash_can_rust/ });
  world.circles.push({ x: -9.5, z: 5.5, r: 0.4 });
  for (const [x, z] of [[-30, 6.4], [17, 5.6]]) { await prop('trashbag', x, 0, z, { rotY: rand(0, 6) }); }

  // promenade : herbe, bancs, lampadaires
  const grassAreas = [];
  for (const [x, z, w, d] of [[-30, 11, 12, 6], [-12, 11.5, 10, 5], [6, 10.5, 9, 6], [20, 11, 12, 6], [36, 10, 10, 6], [-40, 10, 8, 5]])
    grassAreas.push(grassPatch(x, z, w, d, rand(-0.1, 0.1)));
  world.grassAreas = grassAreas;
  for (const [x, ry] of [[-22, 0], [-2, 0], [16, 0]]) {
    await prop('painted_wooden_bench', x, 0, 12.8, { rotY: ry + Math.PI, tint: '#e8f0e8' });
    world.colliders.push({ x0: x - 0.7, x1: x + 0.7, z0: 12.5, z1: 13.1 });
  }
  world.hotspots.bench = { pos: new THREE.Vector3(-2, 0, 12.1), r: 1.4, label: 'Banc face à la lagune' };
  for (const x of [-34, -14, 6, 26]) {
    await prop('street_lamp_01', x, 0, 9, { rotY: Math.PI });
    world.circles.push({ x, z: 9, r: 0.2 });
    addLight('#ffb35c', 14, 20, x, 3.7, 8.7, 'sodium');
  }
  const lampGlow = glowMat('#ffcc80', 5);
  for (const x of [-34, -14, 6, 26]) scene.add(mesh(new THREE.SphereGeometry(0.09, 10, 8), lampGlow, x, 3.72, 8.75, false));

  // quai en béton + plage + lagune
  const q = new THREE.Group();
  q.add(tbox(56, 1.8, 0.6, tinted(M.concrete, '#8f877b'), -17, -0.55, 15.8));
  q.add(tbox(56, 0.12, 0.8, M.concreteTop, -17, 0.36, 15.8));
  bake(q); scene.add(q);
  world.colliders.push({ x0: -46, x1: 11, z0: 15.4, z1: 16.4 });
  // plage de sable (pente douce vers l'eau) à l'est
  const beachH = z => -Math.max(0, z - 15.4) * 0.12;
  const bgeo = worldPlane(36, 14, M.sand.userData.tile, 24, 28);
  const bp = bgeo.attributes.position;
  for (let i = 0; i < bp.count; i++) { const wz = 19 - bp.getY(i); bp.setZ(i, beachH(wz) + Math.sin(bp.getX(i) * 0.9) * Math.cos(wz * 1.3) * 0.02); }
  bgeo.computeVertexNormals();
  const beach = mesh(bgeo, M.sand, 29, -0.01, 19, false); beach.rotation.x = -Math.PI / 2; scene.add(beach);
  world.beachHeight = (x, z) => (x > 11 && z > 15.4) ? beachH(z) : 0;

  // pirogues peintes
  pirogue(20, 16.6, 0.4, 0, false, beachH(16.6)); pirogue(25.5, 17.2, -0.3, 1, false, beachH(17.2)); pirogue(34, 23, 1.2, 2, true);
  world.colliders.push({ x0: 16.6, x1: 23.4, z0: 15.9, z1: 17.3 }, { x0: 22.1, x1: 28.9, z0: 16.5, z1: 17.9 });

  // ponton en bois
  const pierSrc = await polyModel('modular_wooden_pier');
  const sections = ['modular_wooden_pier_section_01', 'modular_wooden_pier_section_02', 'modular_wooden_pier_section_03', 'modular_wooden_pier_section_04', 'modular_wooden_pier_section_02'];
  let zc = 16.0;
  for (const n of sections) {
    const s0 = pierSrc.getObjectByName(n);
    if (!s0) break;
    const s = s0.clone();
    s.position.set(0, 0, 0); s.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(s);
    const len = bb.max.z - bb.min.z;
    const holder = new THREE.Group(); holder.add(s);
    s.position.set(-(bb.min.x + bb.max.x) / 2, 0.45 - bb.max.y, -bb.min.z);
    holder.position.set(-6, 0, zc);
    scene.add(holder);
    zc += len - 0.05;
  }
  world.pier = { x0: -7.1, x1: -4.9, z0: 15.8, z1: zc - 0.2, y: 0.45 };
  world.platforms.push(world.pier);
  world.hotspots.pier = { pos: new THREE.Vector3(-6, 0.45, zc - 1.2), r: 1.6, label: 'Bout du ponton' };

  // eau
  await water();
}

function pirogue(x, z, rotY, seed, floating = false, groundY = 0) {
  const L = 7.2, segL = 36, segV = 12;
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= segL; i++) {
    const u = i / segL, s = u * 2 - 1;
    const halfW = Math.pow(Math.max(0, 1 - Math.abs(s) ** 2.2), 0.55) * 0.6;
    const depth = 0.55 * Math.pow(Math.max(0, 1 - Math.abs(s) ** 4), 0.5);
    const sheer = Math.pow(Math.abs(s), 3) * 0.45;
    for (let j = 0; j <= segV; j++) {
      const a = j / segV * Math.PI; // de bord à bord par le fond
      pos.push(Math.cos(a) * halfW, sheer + 0.55 - Math.sin(a) * depth, s * L / 2);
      uv.push(j / segV, u);
    }
  }
  for (let i = 0; i < segL; i++) for (let j = 0; j < segV; j++) { const a = i * (segV + 1) + j, b = a + segV + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  // peinture de coque : bandes de couleurs vives, bois usé
  const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const g = c.getContext('2d');
  const pal = [['#1d5aa6', '#f2c230', '#d8342a', '#ffffff'], ['#2e8b57', '#f5d742', '#c0392b', '#222'], ['#8e44ad', '#f39c12', '#16a085', '#fff']][seed % 3];
  g.fillStyle = '#5b4632'; g.fillRect(0, 0, 256, 1024);
  const bands = [[0, 0.1, pal[0]], [0.1, 0.16, pal[1]], [0.16, 0.2, pal[2]], [0.2, 0.36, pal[3]], [0.36, 0.42, pal[0]]];
  for (const [a, b, col] of bands) { g.fillStyle = col; g.fillRect(a * 256, 0, (b - a) * 256, 1024); g.fillRect(256 - b * 256, 0, (b - a) * 256, 1024); }
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(60,40,25,${Math.random() * 0.25})`; g.fillRect(Math.random() * 256, Math.random() * 1024, 1 + Math.random() * 3, 4 + Math.random() * 30); }
  g.save(); g.translate(30, 512); g.rotate(-Math.PI / 2); g.fillStyle = pal[0]; g.font = '700 40px Anton'; g.textAlign = 'center'; g.fillText(['DIEU EST GRAND', 'LA PATIENCE', 'MERCI MAMAN'][seed % 3], 0, 0); g.restore();
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, side: THREE.DoubleSide });
  const hull = mesh(geo, mat, 0, 0, 0);
  const grp = new THREE.Group(); grp.add(hull);
  for (const zz of [-1.6, 0, 1.6]) grp.add(tbox(1.0, 0.04, 0.22, M.wood, 0, 0.42, zz));
  grp.position.set(x, floating ? -0.62 : groundY - 0.04, z); grp.rotation.y = rotY + Math.PI / 2;
  if (!floating) grp.rotation.z = 0.08;
  scene.add(grp);
  if (floating) world.noMerge.add(grp);
  if (floating) world.animated.push((dt, t) => { grp.position.y = -0.62 + Math.sin(t * 0.9 + seed) * 0.04; grp.rotation.z = Math.sin(t * 0.7) * 0.03; });
}

async function water() {
  const normals = await threeTexture('textures/waternormals.jpg');
  const geo = new THREE.PlaneGeometry(5000, 5000);
  const wpos = new THREE.Vector3(0, -0.35, 2500 + 14);
  // version légère (qualité basse) : pas de rendu miroir
  const sn = normals.clone(); sn.needsUpdate = true; sn.repeat.set(400, 400);
  const sm = new THREE.MeshStandardMaterial({ color: '#173a33', roughness: 0.06, metalness: 0.0, normalMap: sn, normalScale: new THREE.Vector2(0.25, 0.25) });
  world.simpleWater = new THREE.Mesh(geo, sm);
  world.simpleWater.rotation.x = -Math.PI / 2; world.simpleWater.position.copy(wpos);
  world.simpleWater.visible = false;
  scene.add(world.simpleWater);
  // eau avec reflets temps réel ; taille du miroir selon la qualité
  world.makeWater = (size) => {
    if (!size) { if (world.water) world.water.visible = false; world.simpleWater.visible = true; return; }
    world.simpleWater.visible = false;
    if (world.water && world.waterSize === size) { world.water.visible = true; return; }
    if (world.water) { scene.remove(world.water); world.water.material.dispose(); }
    world.water = new Water(geo, {
      textureWidth: size, textureHeight: size, waterNormals: normals,
      sunDirection: new THREE.Vector3(0.3, 1, 0.2).normalize(), sunColor: 0xffffff,
      waterColor: 0x1b3d36, distortionScale: 1.6, fog: true,
    });
    world.water.material.uniforms.size.value = 3.5;
    world.water.rotation.x = -Math.PI / 2;
    world.water.position.copy(wpos);
    world.waterSize = size;
    scene.add(world.water);
  };
  world.makeWater(512);
  world.animated.push((dt, t) => {
    if (world.water) world.water.material.uniforms.time.value = t * 0.35;
    sn.offset.set(t * 0.002, t * 0.0013);
  });
}

/* ---------------- Plateau, de l'autre côté de la lagune ---------------- */
function skyline() {
  const hazeU = { color: { value: new THREE.Color('#c3d0d6') }, amount: { value: 0.55 } };
  world.haze = hazeU;
  const mk = (map, emissive) => {
    const m = new THREE.MeshStandardMaterial({ map, color: map ? '#ffffff' : '#9aa3a8', emissiveMap: emissive || null, emissive: emissive ? '#ffffff' : '#000', emissiveIntensity: 0, roughness: 0.5, metalness: 0.2, fog: false });
    m.onBeforeCompile = sh => {
      sh.uniforms.uHaze = hazeU.color; sh.uniforms.uHazeAmt = hazeU.amount;
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uHazeAmt;')
        .replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, uHazeAmt);');
    };
    world.emissives.push({ mat: m, base: 1.4, tower: true });
    return m;
  };
  const Z = 1500;
  const glass = (tint) => {
    const tt = towerTextures(Math.floor(Math.random() * 99), 10, 30);
    const m = new THREE.MeshStandardMaterial({ color: tint, metalness: 0.85, roughness: 0.14, emissiveMap: tt.emissive, emissive: '#ffffff', emissiveIntensity: 0, fog: false, envMapIntensity: 1.3 });
    m.onBeforeCompile = sh => { sh.uniforms.uHaze = hazeU.color; sh.uniforms.uHazeAmt = hazeU.amount; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uHazeAmt;').replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, uHazeAmt);'); };
    world.emissives.push({ mat: m, base: 1.2, tower: true });
    return m;
  };
  const sky = new THREE.Group();
  const towers = [[-620, 34, 58], [-560, 28, 92], [-500, 40, 70], [-430, 26, 128], [-372, 34, 104], [-300, 44, 82], [-235, 30, 150], [-170, 38, 118], [-105, 28, 96], [-40, 42, 78], [25, 32, 136], [95, 38, 90], [160, 28, 72], [225, 42, 102], [295, 34, 66], [370, 46, 56], [-660, 30, 40], [440, 36, 44]];
  for (let i = 0; i < towers.length; i++) {
    const [x, w, h] = towers[i];
    const z = Z + (i % 3) * 55 + Math.random() * 30;
    const type = i % 4;
    let mat;
    if (type === 1 || type === 3) mat = glass(pick(['#4f7480', '#5d7f74', '#3f5d6e', '#6c8a92']));
    else { const tt = towerTextures(i + 1, Math.round(w / 4), Math.round(h / 3.5)); mat = mk(tt.map, tt.emissive); }
    if (type === 2 && h > 80) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.45, w * 0.45, h, 24), mat); c.position.set(x, h / 2 - 2, z); sky.add(c);
    } else {
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.78, w * 0.8), mat); b.position.set(x, h * 0.39 - 2, z); sky.add(b);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h * 0.22, w * 0.6), mat); b2.position.set(x, h * 0.89 - 2, z); sky.add(b2);
    }
    if (h > 100) { const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1.2, 22, 6), mk(null)); ant.position.set(x, h + 9, z); sky.add(ant); }
  }
  scene.add(sky);
  // la Pyramide
  const pyr = new THREE.Mesh(new THREE.ConeGeometry(48, 70, 4), mk(towerTextures(99, 10, 16).map));
  pyr.position.set(-380 + 20, 33, Z - 30); pyr.rotation.y = Math.PI / 4; scene.add(pyr);
  // rive boisée
  const shore = new THREE.Mesh(new THREE.BoxGeometry(5000, 18, 60), new THREE.MeshStandardMaterial({ color: '#2f4a2a', roughness: 1, fog: false }));
  shore.material.onBeforeCompile = sh => { sh.uniforms.uHaze = hazeU.color; sh.uniforms.uHazeAmt = hazeU.amount; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHaze; uniform float uHazeAmt;').replace('#include <fog_fragment>', 'gl_FragColor.rgb = mix(gl_FragColor.rgb, uHaze, uHazeAmt);'); };
  shore.position.set(0, 4, Z - 80); scene.add(shore);
}

/* ---------------- abords : la rue continue, deuxième rangée, quai ---------------- */
function fillerBuilding(parent, x, zFront, w, d, floors, wall, roof, face = 1) {
  const g = new THREE.Group();
  const fh = 3.1, H = floors * fh;
  g.add(tbox(w, H, d, wall, 0, H / 2, 0));
  g.add(tbox(w + 0.04, 0.5, d + 0.04, M.plinth, 0, 0.25, 0));
  for (let f = 1; f < floors; f++) g.add(tbox(w + 0.14, 0.2, d + 0.14, M.concreteTop, 0, f * fh, 0));
  const trim = pick([paint('#ece6d8'), paint('#5a3b2a'), paint('#2f3a44')]);
  const nw = Math.max(1, Math.round(w / 3));
  for (let f = 0; f < floors; f++) for (let i = 0; i < nw; i++) {
    if (f === 0 && i === Math.floor(nw / 2)) { g.add(doorUnit(1.0, 2.15, pick([M.shutterBlue, M.shutterGreen, M.shutterGrey]), trim).translateX(-w / 2 + (i + 0.5) * w / nw).translateZ(d / 2)); continue; }
    const wu = windowUnit(1.2, 1.2, trim, { bars: f === 0 || Math.random() < 0.5 }); wu.position.set(-w / 2 + (i + 0.5) * w / nw, f * fh + 1.55, d / 2); g.add(wu);
  }
  if (roof === 'tin') {
    const r = new THREE.Mesh(corrugated(w + 1, d + 1), M.tin); r.rotation.x = 0.12; r.position.y = H + 0.3; g.add(r);
    g.add(tbox(w, 0.5, d, wall, 0, H + 0.2, 0));
  } else {
    g.add(tbox(w, 0.7, 0.15, wall, 0, H + 0.35, d / 2 - 0.07));
    g.add(tbox(w, 0.18, d, M.concreteTop, 0, H + 0.09, 0));
    if (Math.random() < 0.6) g.add(polytank(rand(-w / 3, w / 3), H + 0.18, -d / 4));
  }
  g.position.set(x, 0, zFront - face * d / 2);
  if (face < 0) g.rotation.y = Math.PI;
  parent.add(g);
}

function outskirts() {
  const walls = [M.cream, M.pink, M.green, M.ochre, M.lavender, M.plasterBlue, M.plasterYellow, M.plaster, M.blocks];
  const grp = new THREE.Group();
  const chunks = new Map();
  const chunk = x => { const k = Math.floor(x / 30); if (!chunks.has(k)) chunks.set(k, new THREE.Group()); return chunks.get(k); };
  // la rue continue des deux côtés
  for (const dir of [-1, 1]) {
    let x = dir > 0 ? 49 : -53;
    while (Math.abs(x) < 230) {
      const w = rand(7, 11), floors = pick([1, 1, 2, 2, 3]);
      fillerBuilding(chunk(x + dir * w / 2), x + dir * w / 2, -7.2 - rand(0, 1.2), w, rand(7, 10), floors, pick(walls), floors === 1 && Math.random() < 0.6 ? 'tin' : 'flat');
      x += dir * (w + rand(0.4, 3.5));
    }
  }
  // deuxième rangée, visible au-dessus des toits et entre les maisons
  for (let x = -70; x < 70; x += rand(9, 13)) {
    const floors = pick([2, 3, 3, 4]);
    fillerBuilding(chunk(x), x, -20 - rand(0, 6), rand(8, 12), rand(8, 10), floors, pick(walls), 'flat');
  }
  for (let x = -230; x < 230; x += rand(11, 16)) if (Math.abs(x) > 70) fillerBuilding(chunk(x), x, -22 - rand(0, 8), rand(8, 12), 9, pick([2, 3, 4]), pick(walls), 'flat');
  for (const g of chunks.values()) { bake(g); scene.add(g); }
  // quai prolongé le long de la lagune
  grp.add(tbox(230, 1.8, 0.6, tinted(M.concrete, '#8f877b'), -45 - 115, -0.55, 15.8));
  grp.add(tbox(220, 1.8, 0.6, tinted(M.concrete, '#8f877b'), 47 + 110, -0.55, 15.8));
  bake(grp); scene.add(grp);
  for (const x of [-60, -78, -101, -125, 56, 72, 95, 118, 140]) {
    const p = makePalm(M.palmBark, { height: rand(7.5, 10.5) }); p.position.set(x + rand(-2, 2), 0, rand(9, 14)); scene.add(p);
  }
  for (const x of [-64, 60, 88]) {
    const p = makePalm(M.palmBark, { height: rand(9, 12) }); p.position.set(x, 0, -16 - rand(0, 4)); scene.add(p);
  }
  for (const [x, z] of [[-30, -18.5], [15, -18], [46, -17], [-55, -16]]) { const m = makeMango(M.bark, { radius: rand(4, 5), density: 0.7 }); m.position.set(x, 0, z); scene.add(m); }
}

/* ---------------- végétation ---------------- */
async function vegetation(quality) {
  for (const [x, z, h] of [[-38, 12.5, 9.5], [-26, 13.6, 8], [-17.5, 6.6, 7.2], [-3.5, 13.4, 10], [8, 13.9, 8.5], [14.2, 8.8, 9], [22, 13.2, 10.5], [31, 12.6, 7.8], [40, 13.7, 9], [3.6, -5.2, 7], [43, -5.5, 8.6], [-31.5, -5.3, 6.4]]) {
    const p = makePalm(M.palmBark, { height: h }); p.position.set(x, 0, z); p.rotation.y = rand(0, 6); scene.add(p);
    world.circles.push({ x, z, r: 0.35 });
  }
  for (const [x, z, r] of [[-19.4, -11.5, 4.6], [3.2, -9.7, 3.6], [28.5, 9.8, 5.2], [-41, 9.5, 4.4]]) {
    const m = makeMango(M.bark, { radius: r, density: quality.grass > 0.5 ? 1 : 0.6 }); m.position.set(x, 0, z); scene.add(m);
    world.circles.push({ x, z, r: 0.5 });
  }
  // arbustes et plantes
  for (const [x, z, s] of [[-30, 9.2, 0.8], [-10, 9.6, 0.7], [2, 9.4, 0.75], [19, 9.4, 0.9], [37, 8.6, 0.8], [-43, 13.2, 1], [14.6, -6.0, 0.55], [42, 13.5, 0.9]]) {
    await prop('shrub_02', x, 0, z, { scale: s, rotY: rand(0, 6), sub: pick(['shrub_02_a', 'shrub_02_b', 'shrub_02_c', 'shrub_02_d']) });
    world.circles.push({ x, z, r: 0.7 * s });
  }
  for (const [x, z] of [[-16.9, -7.2], [-7.1, -7.2]]) { await prop('pachira_aquatica_01', x, 0.2, z, { scale: 1.1, sub: /_d$/ }); world.circles.push({ x, z, r: 0.4 }); }
  // touffes d'herbe
  const grass = await polyModel('grass_bermuda_01');
  world.grass = scatterGrass(scene, grass, world.grassAreas.map(a => ({ ...a, y: 0.015 })), quality.grass);
}

/* ---------------- points de passage des PNJ ---------------- */
function waypoints() {
  const W = world.waypoints;
  for (let x = -40; x <= 40; x += 8) { W.push(new THREE.Vector3(x, 0, -5.6)); W.push(new THREE.Vector3(x + 4, 0, 5.8)); W.push(new THREE.Vector3(x + 2, 0, 10.6 + Math.random())); }
}

export async function buildWorld(_scene, quality) {
  scene = _scene;
  world._ac = [];
  // tout est demandé en parallèle dès le départ ; la construction attend ensuite des promesses déjà lancées
  const MODELS = ['plastic_monobloc_chair_01', 'plastic_crate_01', 'plastic_crate_02', 'plastic_jerrycan', 'wicker_basket_01', 'wicker_basket_02', 'bananas',
    'cardboard_box_01', 'old_tyre', 'metal_trash_can', 'trashbag', 'street_lamp_01', 'exterior_aircon_unit', 'rollershutter_window_01', 'covered_car',
    'boombox', 'standing_chalkboard_01', 'ceiling_fan', 'portable_generator', 'painted_wooden_bench', 'wooden_stool_01', 'calathea_orbifolia_01', 'fern_02',
    'pachira_aquatica_01', 'shrub_02', 'grass_bermuda_01', 'modular_wooden_pier', 'sofa_02'];
  const preload = Promise.all(MODELS.map(id => polyModel(id)));
  await Promise.all([loadMaterials(), preload]);
  await loadBakedCity();
  groundAndRoad();
  sidewalks();
  poles();
  await Promise.all([northStreet(), southSide()]);
  skyline();
  outskirts();
  await vegetation(quality);
  for (const a of world._ac) await prop('exterior_aircon_unit', a.x, a.y, a.z, { sub: Math.random() < 0.5 ? 'exterior_aircon_unit_rusted' : 'exterior_aircon_unit' });
  delete world._ac;
  await buildInteriors(scene);
  mergeStaticProps();
  waypoints();
  // les pagnes flottent dans la brise
  world.animated.push((dt, t) => {
    for (let i = 0; i < (world.cloths || []).length; i++) {
      const c = world.cloths[i];
      c.rotation.x = Math.sin(t * 1.3 + i) * 0.08 + 0.05;
      c.rotation.z = Math.sin(t * 0.9 + i * 2) * 0.03;
    }
  });
  return world;
}

/* ---------------- fusion des décors statiques (moins d'appels de rendu) ---------------- */
function mergeStaticProps() {
  // tout le décor immobile d'une zone est fusionné par matériau partagé : quelques dizaines d'appels de rendu au lieu de centaines
  // regroupement par cellules de 24 m : peu d'appels de rendu, et les cellules hors champ restent écartées (culling)
  const cells = new Map();
  const skip = new Set([world.water, world.simpleWater, ...(world.cloths || []), ...world.noMerge]);
  const box = new THREE.Box3(), c = new THREE.Vector3();
  for (const o of [...scene.children]) {
    if (skip.has(o) || o.isLight || o.isSprite || o.isPoints || o.isInstancedMesh) continue;
    if (o.material && o.material.isShaderMaterial) continue;   // ciel, nuages
    if (o.material && o.material.fog === false) continue;       // rive lointaine
    box.setFromObject(o); if (box.isEmpty()) continue; box.getCenter(c);
    const sz = box.getSize(new THREE.Vector3());
    if (sz.x > 60 || sz.z > 60) continue;                       // sol, route, quai : déjà d'un seul tenant
    const key = c.x > 400 && c.z < -200 ? 'int' + Math.round(c.x) : Math.floor(c.x / 24) + ',' + Math.floor(c.z / 24);
    if (!cells.has(key)) cells.set(key, new THREE.Group());
    cells.get(key).attach(o);
  }
  for (const g of cells.values()) { scene.add(g); bake(g); }
  world.staticProps = [];
}

/* ---------------- requêtes de collision ---------------- */
export function heightAt(x, z) {
  let y = 0;
  for (const p of world.platforms) if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1) y = Math.max(y, p.y);
  if (world.beachHeight) { const b = world.beachHeight(x, z); if (b < 0) y = b; }
  return y;
}
export function blocked(x, z, r = 0.3, ignoreCars = false) {
  if (world.area !== 'outside') {
    const A = world.areas[world.area];
    if (x < A.x0 + r || x > A.x1 - r || z < A.z0 + r || z > A.z1 - r) return true;
    for (const c of world.colliders) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
    return false;
  }
  if (!ignoreCars) for (const c of world.dynamic()) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  const b = world.bounds;
  const onPier = world.pier && x > world.pier.x0 + r && x < world.pier.x1 - r && z > world.pier.z0 && z < world.pier.z1;
  const zMax = x > 11.4 ? 17.9 : b.z1;
  if (!onPier && (x < b.x0 || x > b.x1 || z < b.z0 || z > zMax)) return true;
  if (onPier) return false;
  for (const c of world.colliders) if (x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r) return true;
  for (const c of world.circles) { const dx = x - c.x, dz = z - c.z; if (dx * dx + dz * dz < (c.r + r) ** 2) return true; }
  return false;
}
/** segment 2D vs AABB (gonflé de r) */
export function segHitsBox(ax, az, bx, bz, o, r = 0.3) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dz = bz - az;
  for (const [p, d, lo, hi] of [[ax, dx, o.x0 - r, o.x1 + r], [az, dz, o.z0 - r, o.z1 + r]]) {
    if (Math.abs(d) < 1e-9) { if (p <= lo || p >= hi) return false; }
    else { let ta = (lo - p) / d, tb = (hi - p) / d; if (ta > tb) [ta, tb] = [tb, ta]; t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 >= t1) return false; }
  }
  return true;
}

/* ---------------- outils partagés avec les intérieurs ---------------- */
export const H = {
  get M() { return M; }, paint, tinted, bake, mesh, cyl, prop, windowUnit, doorUnit, signBoard, addLight, glowMat,
  glowLast(always) { const e = world.emissives[world.emissives.length - 1]; e.always = always; e.mat.emissiveIntensity = e.base; },
};
