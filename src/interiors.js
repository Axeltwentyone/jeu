// Intérieurs : le studio du joueur et les bureaux de Babi Digital.
// Ils sont construits à l'écart du quartier ; une porte y "téléporte" le joueur (fondu au noir), comme dans la plupart des jeux en monde ouvert.
import * as THREE from 'three';
import { tbox, worldPlane } from './assets.js';
import { waxTexture, paintedSign } from './proctex.js';
import { H, world } from './world.js';

export const STUDIO = new THREE.Vector3(600, 0, -300);
export const OFFICE = new THREE.Vector3(700, 0, -300);
const rand = (a, b) => a + Math.random() * (b - a);

function room(o, x0, x1, z0, z1, h, wallMat, floorMat, ceilMat, doors = []) {
  // doors : [{ wall: 'S'|'N'|'E'|'W', at, w }]
  const g = new THREE.Group();
  const t = 0.15;
  g.add(tbox(x1 - x0, 0.06, z1 - z0, floorMat, (x0 + x1) / 2, 0.03, (z0 + z1) / 2));
  g.add(tbox(x1 - x0, 0.08, z1 - z0, ceilMat, (x0 + x1) / 2, h + 0.04, (z0 + z1) / 2));
  const walls = { S: [x0, x1, z1, 'x'], N: [x0, x1, z0, 'x'], W: [z0, z1, x0, 'z'], E: [z0, z1, x1, 'z'] };
  for (const [k, [a, b, c, axis]] of Object.entries(walls)) {
    const holes = doors.filter(d => d.wall === k).sort((p, q) => p.at - q.at);
    let cur = a;
    const seg = (s, e, y0, y1) => {
      if (e - s < 0.01) return;
      const len = e - s, mid = (s + e) / 2, hh = y1 - y0;
      const m = axis === 'x' ? tbox(len, hh, t, wallMat, mid, y0 + hh / 2, c) : tbox(t, hh, len, wallMat, c, y0 + hh / 2, mid);
      g.add(m);
      if (y0 === 0) {
        const wx = o.x + (axis === 'x' ? mid : c), wz = o.z + (axis === 'x' ? c : mid);
        world.colliders.push(axis === 'x' ? { x0: wx - len / 2, x1: wx + len / 2, z0: wz - t, z1: wz + t, h } : { x0: wx - t, x1: wx + t, z0: wz - len / 2, z1: wz + len / 2, h });
      }
    };
    for (const d of holes) { seg(cur, d.at - d.w / 2, 0, h); seg(d.at - d.w / 2, d.at + d.w / 2, d.h || 2.15, h); cur = d.at + d.w / 2; }
    seg(cur, b, 0, h);
  }
  // plinthes
  const sk = H.paint('#e8e2d6', 0.6, 0);
  for (const [k, [a, b, c, axis]] of Object.entries(walls)) g.add(axis === 'x' ? H.mesh(new THREE.BoxGeometry(b - a, 0.08, 0.02), sk, (a + b) / 2, 0.1, c + (k === 'S' ? -0.085 : 0.085)) : H.mesh(new THREE.BoxGeometry(0.02, 0.08, b - a), sk, c + (k === 'E' ? -0.085 : 0.085), 0.1, (a + b) / 2));
  return g;
}

function block(o, x, z, w, d, h = 1) { world.colliders.push({ x0: o.x + x - w / 2, x1: o.x + x + w / 2, z0: o.z + z - d / 2, z1: o.z + z + d / 2, h }); }

/** Écran d'ordinateur avec du code (texture générée). */
function codeTexture(seed = 1) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 300; const g = c.getContext('2d');
  g.fillStyle = '#1e1f24'; g.fillRect(0, 0, 512, 300);
  g.fillStyle = '#2a2c33'; g.fillRect(0, 0, 90, 300); g.fillRect(0, 0, 512, 18);
  const cols = ['#c792ea', '#82aaff', '#c3e88d', '#f78c6c', '#89ddff', '#eeffff', '#ffcb6b'];
  let r = seed * 99;
  const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  for (let y = 28; y < 296; y += 11) {
    let x = 100 + Math.floor(rnd() * 4) * 14;
    const n = 1 + Math.floor(rnd() * 5);
    for (let k = 0; k < n; k++) { const w = 12 + rnd() * 60; g.fillStyle = cols[Math.floor(rnd() * cols.length)]; g.fillRect(x, y, w, 5); x += w + 7; if (x > 500) break; }
  }
  for (let y = 26; y < 296; y += 11) { g.fillStyle = '#4a4d57'; g.fillRect(8 + rnd() * 10, y, 40 + rnd() * 30, 4); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function monitor(seed) {
  const g = new THREE.Group();
  const frame = H.paint('#18191b', 0.4, 0.3);
  g.add(H.mesh(new THREE.BoxGeometry(0.58, 0.35, 0.025), frame, 0, 0.36, 0));
  const scr = new THREE.MeshStandardMaterial({ map: codeTexture(seed), emissive: '#ffffff', emissiveMap: null, emissiveIntensity: 0, roughness: 0.2 });
  scr.emissiveMap = scr.map; scr.emissiveIntensity = 0.9;
  g.add(H.mesh(new THREE.PlaneGeometry(0.55, 0.32), scr, 0, 0.36, 0.0135, false));
  g.add(H.mesh(new THREE.BoxGeometry(0.05, 0.18, 0.04), frame, 0, 0.1, -0.03));
  g.add(H.mesh(new THREE.BoxGeometry(0.22, 0.015, 0.16), frame, 0, 0.008, -0.02));
  return g;
}
function officeChair(color = '#2b2d31') {
  const g = new THREE.Group();
  const fab = H.paint(color, 0.85, 0), met = H.paint('#2a2a2a', 0.3, 0.8);
  const seat = H.mesh(new THREE.BoxGeometry(0.48, 0.08, 0.46), fab, 0, 0.47, 0); g.add(seat);
  const back = H.mesh(new THREE.BoxGeometry(0.46, 0.55, 0.06), fab, 0, 0.82, -0.22); back.rotation.x = -0.12; g.add(back);
  g.add(H.cyl(0.025, 0.025, 0.36, met, 0, 0.27, 0));
  for (let i = 0; i < 5; i++) { const leg = H.mesh(new THREE.BoxGeometry(0.03, 0.03, 0.3), met, 0, 0.07, 0); leg.rotation.y = i / 5 * Math.PI * 2; leg.translateZ(0.15); g.add(leg); g.add(H.cyl(0.025, 0.025, 0.04, met, Math.sin(i / 5 * Math.PI * 2) * 0.29, 0.03, Math.cos(i / 5 * Math.PI * 2) * 0.29)); }
  for (const s of [-1, 1]) g.add(H.mesh(new THREE.BoxGeometry(0.04, 0.03, 0.26), met, s * 0.26, 0.66, -0.02));
  return g;
}
function desk(x, z, rotY, seed, withChair = true) {
  const g = new THREE.Group();
  const top = H.paint('#ecebe7', 0.45, 0), leg = H.paint('#3a3c40', 0.35, 0.7);
  g.add(H.mesh(new THREE.BoxGeometry(1.4, 0.035, 0.72), top, 0, 0.74, 0));
  for (const s of [-1, 1]) { g.add(H.mesh(new THREE.BoxGeometry(0.05, 0.72, 0.62), leg, s * 0.66, 0.36, 0)); }
  const m = monitor(seed); m.position.set(0, 0.76, -0.18); g.add(m);
  g.add(H.mesh(new THREE.BoxGeometry(0.42, 0.018, 0.13), H.paint('#2c2c2e', 0.6, 0.1), 0, 0.77, 0.12));
  g.add(H.mesh(new THREE.BoxGeometry(0.06, 0.02, 0.1), H.paint('#2c2c2e', 0.6, 0.1), 0.32, 0.77, 0.12));
  g.add(H.cyl(0.04, 0.035, 0.1, H.paint(['#d9482b', '#2f6db0', '#f2f2f2'][seed % 3], 0.4, 0), -0.5, 0.81, 0.05)); // tasse
  if (withChair) { const c = officeChair(); c.position.set(0, 0, 0.62); c.rotation.y = Math.PI + rand(-0.3, 0.3); g.add(c); }
  g.position.set(x, 0, z); g.rotation.y = rotY;
  return g;
}

function bed(wax) {
  const g = new THREE.Group();
  const wood = H.paint('#6b4a32', 0.6, 0);
  g.add(H.mesh(new THREE.BoxGeometry(1.45, 0.3, 2.0), wood, 0, 0.2, 0));
  g.add(H.mesh(new THREE.BoxGeometry(1.5, 0.95, 0.07), wood, 0, 0.55, -1.0));
  const sheet = new THREE.MeshStandardMaterial({ map: waxTexture(wax), roughness: 0.92 }); sheet.map.repeat.set(2, 2);
  const mat = H.mesh(new THREE.BoxGeometry(1.4, 0.2, 1.92), H.paint('#f1ede4', 0.9, 0), 0, 0.45, 0.02); g.add(mat);
  const cover = H.mesh(new THREE.BoxGeometry(1.46, 0.06, 1.35), sheet, 0, 0.57, 0.33); g.add(cover);
  for (const s of [-1, 1]) { const f = H.mesh(new THREE.PlaneGeometry(1.35, 0.32), sheet, s * 0.73, 0.42, 0.33, false); f.rotation.y = s * Math.PI / 2; f.material.side = THREE.DoubleSide; g.add(f); }
  for (const s of [-0.35, 0.35]) { const p = H.mesh(new THREE.SphereGeometry(0.2, 16, 10).scale(1.3, 0.38, 0.7), H.paint('#f5f2ea', 0.9, 0), s, 0.62, -0.72); g.add(p); }
  return g;
}

function windowGlow(w, h, intensityRef) {
  const m = new THREE.MeshStandardMaterial({ color: '#cfe3ef', emissive: '#d8ecff', emissiveIntensity: 1, roughness: 1 });
  intensityRef.push(m);
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
}

export async function buildInteriors(scene) {
  const M = H.M;
  world.windowGlows = [];
  world.interiorLights = [];
  world.areas = world.areas || {};

  /* ========== STUDIO ========== */
  {
    const o = STUDIO;
    const g = new THREE.Group(); g.position.copy(o);
    const wall = H.tinted(M.plaster, '#ece3d2');
    const ceil = H.tinted(M.plaster, '#f4f1ea');
    g.add(room(o, -3.4, 3.4, -2.6, 2.6, 2.8, wall, M.tiles, ceil, [{ wall: 'S', at: -1.0, w: 0.95 }]));
    // salle d'eau
    const tile = H.tinted(M.plaster, '#dfe8ea');
    g.add(tbox(0.12, 2.8, 2.0, tile, 1.6, 1.4, -1.6)); block(o, 1.6, -1.6, 0.12, 2.0, 2.8);
    g.add(tbox(0.6, 2.8, 0.12, tile, 1.9, 1.4, -0.6)); block(o, 1.9, -0.6, 0.6, 0.12, 2.8);
    g.add(tbox(0.4, 2.8, 0.12, tile, 3.2, 1.4, -0.6)); block(o, 3.2, -0.6, 0.4, 0.12, 2.8);
    g.add(tbox(0.8, 0.65, 0.12, tile, 2.6, 2.475, -0.6));
    g.add(tbox(1.0, 0.08, 1.0, H.paint('#e9ecec', 0.25, 0), 2.85, 0.07, -2.05)); // bac de douche
    g.add(H.cyl(0.015, 0.015, 1.2, H.paint('#c8c8c8', 0.2, 1), 3.3, 1.6, -2.45));
    g.add(H.cyl(0.08, 0.06, 0.03, H.paint('#c8c8c8', 0.2, 1), 3.2, 2.2, -2.4));
    g.add(H.mesh(new THREE.BoxGeometry(0.5, 0.15, 0.4), H.paint('#f2f2f0', 0.2, 0), 1.95, 0.85, -2.35)); // lavabo
    g.add(H.mesh(new THREE.PlaneGeometry(0.45, 0.6), new THREE.MeshStandardMaterial({ color: '#9fb0b8', roughness: 0.02, metalness: 1 }), 1.95, 1.5, -2.53, false));
    world.hotspots.shower = { pos: o.clone().add(new THREE.Vector3(2.5, 0, -1.2)), r: 1.1, label: 'Prendre une douche', area: 'studio' };

    // coin cuisine : plan de travail, réchaud à gaz et bouteille, étagère
    const counter = H.tinted(M.wood, '#8a6a4c');
    g.add(tbox(2.2, 0.85, 0.6, counter, -2.3, 0.43, -2.28)); block(o, -2.3, -2.28, 2.2, 0.6);
    g.add(tbox(2.24, 0.04, 0.64, H.paint('#d9d4ca', 0.35, 0), -2.3, 0.87, -2.28));
    const stove = new THREE.Group();
    stove.add(H.mesh(new THREE.BoxGeometry(0.6, 0.08, 0.38), H.paint('#2b2b2b', 0.4, 0.6), 0, 0.04, 0));
    for (const s of [-0.15, 0.15]) stove.add(H.cyl(0.08, 0.08, 0.02, H.paint('#111', 0.5, 0.8), s, 0.09, 0));
    stove.position.set(-2.8, 0.89, -2.28); g.add(stove);
    g.add(H.cyl(0.16, 0.16, 0.55, H.paint('#2f5fa8', 0.4, 0.4), -1.5, 0.28, -2.0)); // bouteille de gaz sous le plan
    g.add(tbox(1.6, 0.03, 0.28, counter, -2.4, 1.75, -2.45));
    for (let i = 0; i < 4; i++) g.add(H.cyl(0.07, 0.07, 0.12 + i * 0.02, H.paint(['#a33', '#e8c21a', '#ddd', '#2f6fb0'][i], 0.4, 0.3), -3.0 + i * 0.35, 1.84, -2.45));
    // petit frigo
    g.add(tbox(0.6, 1.3, 0.6, H.paint('#ecebe6', 0.3, 0.1), -0.85, 0.65, -2.25)); block(o, -0.85, -2.25, 0.6, 0.6);
    world.hotspots.stove = { pos: o.clone().add(new THREE.Vector3(-2.6, 0, -1.6)), r: 1.0, label: 'Cuisiner', area: 'studio' };

    // lit
    const b = bed(4); b.position.set(2.5, 0, 1.55); b.rotation.y = Math.PI; g.add(b); block(o, 2.5, 1.55, 1.5, 2.05, 0.7);
    world.hotspots.bed = { pos: o.clone().add(new THREE.Vector3(1.55, 0, 1.4)), r: 1.0, label: 'Dormir', area: 'studio' };
    // armoire
    const ward = new THREE.Group();
    ward.add(tbox(0.6, 2.0, 1.3, counter, 0, 1.0, 0));
    for (const s of [-0.32, 0.32]) ward.add(H.mesh(new THREE.BoxGeometry(0.02, 1.9, 0.62), H.paint('#7c5a3e', 0.5, 0), 0.31, 1.0, s));
    for (const s of [-0.05, 0.05]) ward.add(H.cyl(0.012, 0.012, 0.12, H.paint('#c9b27a', 0.3, 0.9), 0.33, 1.05, s));
    ward.position.set(-3.05, 0, 0.9); g.add(ward); block(o, -3.05, 0.9, 0.6, 1.3, 2);
    world.hotspots.wardrobe = { pos: o.clone().add(new THREE.Vector3(-2.35, 0, 0.9)), r: 0.9, label: 'Ouvrir l\'armoire', area: 'studio' };
    // table, chaises, avis de loyer
    const tw = H.tinted(M.wood, '#a07a55');
    g.add(tbox(1.0, 0.05, 0.7, tw, -1.0, 0.75, 0.2));
    for (const [lx, lz] of [[-0.45, -0.3], [0.45, -0.3], [-0.45, 0.3], [0.45, 0.3]]) g.add(H.cyl(0.025, 0.025, 0.73, tw, -1.0 + lx, 0.37, 0.2 + lz));
    block(o, -1.0, 0.2, 1.0, 0.7, 0.8);
    const notice = H.mesh(new THREE.PlaneGeometry(0.21, 0.29), new THREE.MeshStandardMaterial({ map: paintedSign({ w: 256, h: 360, bg: '#f7f4ec', border: null, seed: 31, wear: 0.15, lines: [{ text: 'AVIS DE LOYER', size: 0.08, color: '#222', font: 'Oswald', weight: 700 }, { text: 'Studio · Cour Kouassi', size: 0.055, color: '#444', font: 'Inter' }, { text: '30 000 FCFA / semaine', size: 0.065, color: '#a3281a', font: 'Oswald', weight: 700 }] }), roughness: 0.9 }), -0.85, 0.78, 0.25, false);
    notice.rotation.x = -Math.PI / 2; notice.rotation.z = 0.3; g.add(notice);
    world.hotspots.rentTable = { pos: o.clone().add(new THREE.Vector3(-1.0, 0, 0.95)), r: 0.9, label: 'Lire l\'avis de loyer', area: 'studio' };
    // télé sur meuble
    g.add(tbox(1.2, 0.5, 0.4, counter, 0.4, 0.25, -2.35)); block(o, 0.4, -2.35, 1.2, 0.4);
    const tvScreen = new THREE.MeshStandardMaterial({ color: '#050505', emissive: '#7aa6d8', emissiveIntensity: 0, roughness: 0.1 });
    world.studioTv = tvScreen;
    g.add(H.mesh(new THREE.BoxGeometry(0.95, 0.56, 0.05), H.paint('#111', 0.3, 0.2), 0.4, 0.82, -2.42));
    g.add(H.mesh(new THREE.PlaneGeometry(0.9, 0.51), tvScreen, 0.4, 0.82, -2.393, false));
    world.hotspots.tv = { pos: o.clone().add(new THREE.Vector3(0.4, 0, -1.4)), r: 0.9, label: 'Regarder la télé', area: 'studio' };
    // tapis wax
    const rug = new THREE.MeshStandardMaterial({ map: waxTexture(8), roughness: 0.95 }); rug.map.repeat.set(2, 1.4);
    const rm = H.mesh(new THREE.PlaneGeometry(2.0, 1.4), rug, 0.3, 0.065, -0.4, false); rm.rotation.x = -Math.PI / 2; g.add(rm);
    // fenêtre naco avec lumière du jour
    const wu = H.windowUnit(1.1, 1.1, H.paint('#e9e4d8')); wu.position.set(1.0, 1.55, 2.52); wu.rotation.y = Math.PI; g.add(wu);
    const wg = windowGlow(1.1, 1.1, world.windowGlows); wg.position.set(1.0, 1.55, 2.6); wg.rotation.y = Math.PI; g.add(wg);
    // porte et sortie
    g.add(H.doorUnit(0.9, 2.1, M.shutterGreen, H.paint('#6b3f22')).translateX(-1.0).translateZ(2.62).rotateY(Math.PI));
    world.hotspots.exitStudio = { pos: o.clone().add(new THREE.Vector3(-1.0, 0, 2.0)), r: 0.9, label: 'Sortir', area: 'studio', door: 'out' };
    // plafonnier + ventilateur
    g.add(H.mesh(new THREE.BoxGeometry(1.2, 0.04, 0.06), H.glowMat('#f2f6ff', 3), -0.5, 2.76, 0, false));
    H.glowLast(true);
    bake(g);
    scene.add(g);
    const fan = await H.prop('ceiling_fan', o.x + 0.4, 2.3, o.z + 0.2, { dynamic: true });
    const blades = fan.getObjectByName('ceiling_fan_blades');
    world.studioFan = { blades, on: true };
    await H.prop('plastic_monobloc_chair_01', o.x - 1.0, 0.03, o.z + 0.85, { rotY: Math.PI + 0.2 });
    await H.prop('plastic_monobloc_chair_01', o.x - 1.65, 0.03, o.z + 0.0, { rotY: Math.PI / 2 });
    await H.prop('plastic_jerrycan', o.x + 2.2, 0.08, o.z - 2.2, { tint: '#2f6fb0' });
    await H.prop('calathea_orbifolia_01', o.x - 3.0, 0.05, o.z + 2.2, { scale: 1.3, sub: /_a$/ });
    H.addLight('#fff2dd', 6, 9, o.x - 0.3, 2.5, o.z, 'interior', 'studio');
    H.addLight('#dbe9ff', 3, 6, o.x + 1, 1.8, o.z + 2.0, 'interior', 'studio', { daylight: true });
    world.areas.studio = { x0: o.x - 3.3, x1: o.x + 3.3, z0: o.z - 2.5, z1: o.z + 2.5, ceiling: 2.75, spawn: o.clone().add(new THREE.Vector3(-1.0, 0, 1.7)), spawnRot: Math.PI, name: 'Ton studio' };
  }

  /* ========== BUREAUX BABI DIGITAL ========== */
  {
    const o = OFFICE;
    const g = new THREE.Group(); g.position.copy(o);
    const wall = H.tinted(M.plaster, '#f1efea');
    const floor = H.tinted(M.concrete, '#c9c4bb');
    g.add(room(o, -7, 7, -5, 5, 3.2, wall, floor, H.tinted(M.plaster, '#f7f6f2'), [{ wall: 'S', at: -5, w: 1.6, h: 2.4 }]));
    // façade vitrée côté nord (vue sur le quartier)
    for (let i = 0; i < 6; i++) {
      const wg = windowGlow(2.1, 2.2, world.windowGlows); wg.position.set(-5.8 + i * 2.32, 1.65, -4.92); g.add(wg);
      g.add(H.mesh(new THREE.BoxGeometry(0.08, 2.4, 0.1), H.paint('#2f3338', 0.4, 0.7), -7 + 1.16 + i * 2.32 + 1.16, 1.6, -4.88));
    }
    g.add(H.mesh(new THREE.BoxGeometry(14, 0.1, 0.12), H.paint('#2f3338', 0.4, 0.7), 0, 0.5, -4.88));
    // mur d'accent avec logo
    const logo = paintedSign({ w: 1024, h: 256, bg: '#13202b', border: null, seed: 41, wear: 0.05, lines: [{ text: 'BABI DIGITAL', size: 0.42, color: '#f08a24', font: 'Oswald', weight: 700 }, { text: 'Solutions web & mobile · Abidjan', size: 0.16, color: '#e6e6e6', font: 'Inter' }] });
    g.add(tbox(0.06, 3.2, 4.5, H.paint('#13202b', 0.6, 0), -6.9, 1.6, 2.6));
    const lm = H.mesh(new THREE.PlaneGeometry(2.6, 0.65), new THREE.MeshStandardMaterial({ map: logo, roughness: 0.6 }), -6.86, 1.9, 2.6, false); lm.rotation.y = Math.PI / 2; g.add(lm);
    // accueil
    const rec = new THREE.Group();
    rec.add(H.mesh(new THREE.BoxGeometry(2.2, 1.05, 0.6), H.paint('#f2efe8', 0.4, 0), 0, 0.53, 0));
    rec.add(H.mesh(new THREE.BoxGeometry(2.3, 0.04, 0.75), H.tinted(M.wood, '#9a7350'), 0, 1.07, -0.05));
    const rm = monitor(7); rm.position.set(0.5, 1.09, -0.15); rm.rotation.y = Math.PI; rec.add(rm);
    rec.position.set(-4.4, 0, 1.6); g.add(rec); block(o, -4.4, 1.6, 2.2, 0.7, 1.1);
    // open space : 2 rangées de postes
    const deskSpots = [];
    let seed = 1;
    for (const z of [-2.6, 0.4]) for (const x of [-1.2, 1.2, 3.6]) {
      g.add(desk(x, z, 0, seed++)); block(o, x, z, 1.45, 0.8, 0.8);
      deskSpots.push({ x, z });
    }
    // séparateurs de bureau
    for (const z of [-2.6, 0.4]) g.add(H.mesh(new THREE.BoxGeometry(7.4, 0.32, 0.03), H.paint('#5f7d6e', 0.9, 0), 1.2, 0.92, z - 0.37));
    // salle de réunion vitrée
    const gl = new THREE.MeshPhysicalMaterial({ color: '#cfe0e0', roughness: 0.05, transparent: true, opacity: 0.18, metalness: 0 });
    const gw = H.mesh(new THREE.BoxGeometry(0.04, 2.6, 3.0), gl, 5.3, 1.3, -3.4, false); gw.userData.keep = true; g.add(gw);
    block(o, 5.3, -3.4, 0.08, 3.0, 2.6);
    g.add(tbox(1.5, 0.04, 0.9, H.tinted(M.wood, '#7a5a40'), 6.2, 0.75, -3.2));
    g.add(H.cyl(0.05, 0.05, 0.73, H.paint('#333', 0.3, 0.8), 6.2, 0.37, -3.2));
    block(o, 6.2, -3.2, 1.5, 0.9);
    // tableau kanban
    const kb = paintedSign({ w: 1024, h: 512, bg: '#fafafa', border: null, seed: 43, wear: 0.05, lines: [{ text: 'À FAIRE      EN COURS      FAIT', size: 0.08, color: '#333', font: 'Oswald', weight: 700 }], art: (cg, w, h) => {
      const cols = ['#ffd54f', '#81d4fa', '#a5d6a7', '#f48fb1'];
      for (let i = 0; i < 16; i++) { cg.fillStyle = cols[i % 4]; cg.fillRect(60 + (i % 3) * 330 + Math.random() * 60, 120 + Math.floor(i / 3) * 70 + Math.random() * 10, 110, 55); }
    } });
    // tableau sur pied, devant les baies
    g.add(H.mesh(new THREE.BoxGeometry(2.5, 1.3, 0.04), H.paint('#d9d9d6', 0.4, 0.3), 1.4, 1.55, -4.42));
    const kbm = H.mesh(new THREE.PlaneGeometry(2.4, 1.2), new THREE.MeshStandardMaterial({ map: kb, roughness: 0.4 }), 1.4, 1.55, -4.395, false); g.add(kbm);
    for (const ox of [-1.15, 1.15]) g.add(H.cyl(0.02, 0.02, 2.2, H.paint('#888', 0.3, 0.8), 1.4 + ox, 1.1, -4.42));
    block(o, 1.4, -4.42, 2.5, 0.2, 2);
    // coin café
    g.add(tbox(1.6, 0.9, 0.55, H.tinted(M.wood, '#6d5038'), 6.1, 0.45, 3.9)); block(o, 6.1, 3.9, 1.6, 0.55, 1);
    g.add(H.mesh(new THREE.BoxGeometry(0.36, 0.45, 0.36), H.paint('#2a2a2a', 0.3, 0.6), 5.7, 1.13, 3.9));
    g.add(H.cyl(0.13, 0.13, 0.45, H.paint('#9fd3e6', 0.1, 0), 6.5, 1.12, 3.9));
    world.hotspots.coffee = { pos: o.clone().add(new THREE.Vector3(6.0, 0, 3.1)), r: 1.0, label: 'Machine à café', area: 'office' };
    // dalles lumineuses au plafond
    for (const x of [-4, 0, 4]) for (const z of [-2.5, 1.5]) g.add(H.mesh(new THREE.BoxGeometry(1.2, 0.03, 0.6), H.glowMat('#f4f8ff', 2.4), x, 3.17, z, false)), H.glowLast(true);
    // porte d'entrée vitrée
    const door = H.mesh(new THREE.BoxGeometry(1.5, 2.35, 0.04), gl, -5, 1.18, 5.02, false); door.userData.keep = true; g.add(door);
    world.hotspots.exitOffice = { pos: o.clone().add(new THREE.Vector3(-5, 0, 4.3)), r: 1.0, label: 'Sortir', area: 'office', door: 'out' };
    // ton poste (le dernier bureau, près de la fenêtre)
    const myDesk = deskSpots[2];
    world.hotspots.workDesk = { pos: o.clone().add(new THREE.Vector3(myDesk.x, 0, myDesk.z + 0.95)), r: 0.9, label: 'Ton poste de travail', area: 'office', seat: { x: o.x + myDesk.x, z: o.z + myDesk.z + 0.62, rotY: Math.PI } };
    world.officeDesks = deskSpots.map(d => ({ x: o.x + d.x, z: o.z + d.z + 0.62, rotY: Math.PI }));
    bake(g);
    scene.add(g);
    await H.prop('pachira_aquatica_01', o.x - 6.4, 0.05, o.z - 4.3, { scale: 1.2, sub: /_d$/ });
    await H.prop('calathea_orbifolia_01', o.x + 4.8, 0.05, o.z + 4.3, { scale: 1.6, sub: /_a$/ });
    await H.prop('sofa_02', o.x - 6.2, 0.05, o.z - 1.2, { rotY: Math.PI / 2 });
    block(o, -6.2, -1.2, 0.9, 1.9, 0.8);
    for (const [x, z] of [[-3.2, 0], [3.2, -0.5]]) {
      H.addLight('#f4f6ff', 8, 13, o.x + x, 2.9, o.z + z, 'interior', 'office');
    }
    H.addLight('#dbe9ff', 5, 12, o.x, 2, o.z - 4, 'interior', 'office', { daylight: true });
    world.areas.office = { x0: o.x - 6.85, x1: o.x + 6.85, z0: o.z - 4.85, z1: o.z + 4.85, ceiling: 3.15, spawn: o.clone().add(new THREE.Vector3(-5, 0, 3.8)), spawnRot: Math.PI, name: 'Babi Digital' };
    world.officeSpots = {
      recruiter: { x: o.x - 4.4, z: o.z + 0.95, rotY: 0 },
      lead: { x: o.x + 1.4, z: o.z - 3.7, rotY: 0 },
    };
  }
}

function bake(g) { H.bake(g); }
