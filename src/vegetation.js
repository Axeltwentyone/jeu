// Végétation procédurale : cocotiers et manguiers (géométrie détaillée + feuillage instancié).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { leafTexture } from './proctex.js';

export const windUniform = { value: 0 };

function rand(a, b) { return a + Math.random() * (b - a); }

/** Tube à rayon variable le long d'une courbe, UV à l'échelle réelle. */
export function taperedTube(curve, segs, radial, rFn, tile = 1, bumpFn) {
  const frames = curve.computeFrenetFrames(segs, false);
  const pos = [], nor = [], uv = [], idx = [];
  const len = curve.getLength();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, p = curve.getPointAt(t);
    const N = frames.normals[i], B = frames.binormals[i];
    const r = rFn(t) * (bumpFn ? bumpFn(t) : 1);
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2;
      const n = new THREE.Vector3().addScaledVector(N, Math.cos(a)).addScaledVector(B, Math.sin(a)).normalize();
      pos.push(p.x + n.x * r, p.y + n.y * r, p.z + n.z * r);
      nor.push(n.x, n.y, n.z);
      uv.push(j / radial * (2 * Math.PI * Math.max(r, 0.05)) / tile, t * len / tile);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/* ================= Cocotier ================= */
const frondMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.62, metalness: 0 });
frondMat.onBeforeCompile = (sh) => {
  sh.uniforms.uWind = windUniform;
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uWind;')
    .replace('#include <begin_vertex>', `#include <begin_vertex>
      float ph = position.x * 0.35 + position.z * 0.27;
      transformed.y += sin(uWind * 1.7 + ph) * 0.12 * aSway * aSway;
      transformed.x += sin(uWind * 1.1 + ph * 1.3) * 0.10 * aSway * aSway;
      transformed.z += cos(uWind * 0.9 + ph) * 0.06 * aSway;`);
};

export function makePalm(barkMat, { height = rand(7, 10.5), lean = rand(0.04, 0.16), seed = Math.random() } = {}) {
  const g = new THREE.Group();
  const leanDir = new THREE.Vector2(Math.cos(seed * 20), Math.sin(seed * 20));
  // tronc incurvé caractéristique
  const pts = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const bend = Math.pow(t, 1.6) * height * lean;
    pts.push(new THREE.Vector3(leanDir.x * bend, t * height, leanDir.y * bend));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunkG = taperedTube(curve, 40, 12, t => THREE.MathUtils.lerp(0.24, 0.15, t) + (t < 0.06 ? (0.06 - t) * 2.2 : 0), 0.9,
    t => 1 + Math.sin(t * height * 7) * 0.025);
  const trunk = new THREE.Mesh(trunkG, barkMat); trunk.castShadow = trunk.receiveShadow = true;
  g.add(trunk);

  const top = curve.getPointAt(1);
  const frondGeos = [];
  const nFronds = Math.floor(rand(15, 20));
  const col = new THREE.Color();
  for (let f = 0; f < nFronds; f++) {
    const az = f / nFronds * Math.PI * 2 + rand(-0.2, 0.2);
    const old = f % 5 === 0 && Math.random() < 0.7; // palmes sèches qui pendent
    const up = old ? rand(-0.9, -0.5) : rand(-0.25, 0.75);
    const L = old ? rand(2.4, 3.2) : rand(3.4, 4.6);
    const dir = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const rach = [];
    const N = 22;
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      const droop = old ? s * 0.6 : s * s * rand(1.2, 1.5);
      rach.push(new THREE.Vector3(
        top.x + dir.x * s * L * Math.cos(up * 0.6),
        top.y + 0.1 + Math.sin(up) * s * L - droop * L * 0.45,
        top.z + dir.z * s * L * Math.cos(up * 0.6)));
    }
    const rc = new THREE.CatmullRomCurve3(rach);
    const pos = [], colr = [], sway = [], idx = [];
    let vi = 0;
    const baseCol = old ? new THREE.Color('#6a4a22') : new THREE.Color().setHSL(rand(0.21, 0.26), rand(0.55, 0.72), rand(0.11, 0.17));
    // nervure centrale
    for (let i = 0; i < N; i++) {
      const a = rc.getPointAt(i / N), b = rc.getPointAt((i + 1) / N);
      const w = 0.035 * (1 - i / N) + 0.008;
      pos.push(a.x - w, a.y, a.z, a.x + w, a.y, a.z, b.x - w, b.y, b.z, b.x + w, b.y, b.z);
      for (let k = 0; k < 4; k++) { col.copy(baseCol).offsetHSL(0, -0.1, 0.06); colr.push(col.r, col.g, col.b); sway.push(i / N); }
      idx.push(vi, vi + 2, vi + 1, vi + 1, vi + 2, vi + 3); vi += 4;
    }
    // folioles
    const nLeaf = old ? 26 : 44;
    for (let i = 2; i < nLeaf; i++) {
      const s = i / nLeaf;
      const p = rc.getPointAt(s), tan = rc.getTangentAt(s);
      const side0 = new THREE.Vector3().crossVectors(tan, new THREE.Vector3(0, 1, 0)).normalize();
      for (const sd of [-1, 1]) {
        const ll = (old ? 0.55 : 1.05) * Math.pow(Math.sin(Math.PI * Math.min(1, s * 1.08)), 0.6) + 0.12;
        const side = side0.clone().multiplyScalar(sd);
        const dn = old ? -0.9 : rand(-0.55, -0.15);  // V caractéristique, pointes vers le bas
        const lDir = side.clone().multiplyScalar(Math.cos(dn)).add(new THREE.Vector3(0, Math.sin(dn), 0)).addScaledVector(tan, 0.35).normalize();
        const tip = p.clone().addScaledVector(lDir, ll);
        tip.y -= ll * ll * 0.18;
        const mid = p.clone().addScaledVector(lDir, ll * 0.45);
        const wv = tan.clone().multiplyScalar(0.045);
        const leafCol = col.copy(baseCol).offsetHSL(rand(-0.015, 0.015), rand(-0.05, 0.05), rand(-0.04, 0.05) + (s > 0.85 ? 0.04 : 0));
        if (!old && Math.random() < 0.06) leafCol.lerp(new THREE.Color('#a08a3a'), 0.6); // pointes jaunies
        pos.push(p.x, p.y, p.z, mid.x + wv.x, mid.y + wv.y, mid.z + wv.z, mid.x - wv.x, mid.y - wv.y, mid.z - wv.z, tip.x, tip.y, tip.z);
        for (let k = 0; k < 4; k++) { colr.push(leafCol.r, leafCol.g, leafCol.b); sway.push(Math.min(1, s + (k === 3 ? 0.25 : k ? 0.12 : 0))); }
        idx.push(vi, vi + 1, vi + 2, vi + 1, vi + 3, vi + 2); vi += 4;
      }
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    fg.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
    fg.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
    fg.setIndex(idx);
    fg.computeVertexNormals();
    frondGeos.push(fg);
  }
  const fronds = new THREE.Mesh(mergeGeometries(frondGeos), frondMat);
  fronds.castShadow = true; fronds.receiveShadow = true;
  g.add(fronds);

  // noix de coco
  const nutMat = new THREE.MeshStandardMaterial({ color: '#5b5a24', roughness: 0.55 });
  const nutG = new THREE.SphereGeometry(0.13, 12, 10); nutG.scale(1, 1.15, 1);
  const nuts = [];
  const nCount = Math.floor(rand(4, 9));
  for (let i = 0; i < nCount; i++) {
    const a = i / nCount * 6.28 + rand(-0.3, 0.3);
    const m = nutG.clone(); m.translate(top.x + Math.cos(a) * 0.24, top.y - 0.25 - Math.random() * 0.2, top.z + Math.sin(a) * 0.24);
    nuts.push(m);
  }
  const nm = new THREE.Mesh(mergeGeometries(nuts), nutMat); nm.castShadow = true;
  g.add(nm);
  g.userData.radius = 0.35;
  return g;
}

/* ================= Manguier ================= */
let mangoLeafMat = null;
function getLeafMat() {
  if (mangoLeafMat) return mangoLeafMat;
  mangoLeafMat = new THREE.MeshStandardMaterial({ map: leafTexture('mango'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.55, metalness: 0 });
  mangoLeafMat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;\nattribute vec3 aCenter;')
      .replace('#include <beginnormal_vertex>', `
        vec3 instP = vec3(instanceMatrix[3]);
        vec3 sphN = normalize(instP - aCenter + vec3(0.0, 0.4, 0.0));
        vec3 objectNormal = normalize(transpose(mat3(instanceMatrix)) * mix(normal, sphN, 0.85));
        #ifdef USE_TANGENT
          vec3 objectTangent = vec3( tangent.xyz );
        #endif`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        float ph = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.5 + instanceMatrix[3].y;
        transformed.x += sin(uWind * 2.3 + ph) * 0.03 * position.y;
        transformed.z += cos(uWind * 1.9 + ph) * 0.03 * position.y;`);
  };
  return mangoLeafMat;
}

export function makeMango(barkMat, { radius = rand(4.2, 5.5), trunkH = rand(2.2, 2.8), density = 1 } = {}) {
  const g = new THREE.Group();
  const branchGeos = [];
  const tips = [];
  // tronc court et massif, branches qui partent en couronne
  const trunkCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.1, trunkH * 0.5, 0.05), new THREE.Vector3(0, trunkH, 0)]);
  branchGeos.push(taperedTube(trunkCurve, 12, 12, t => THREE.MathUtils.lerp(0.42, 0.3, t) + (t < 0.1 ? (0.1 - t) * 3 : 0), 1.2));
  const top = new THREE.Vector3(0, trunkH, 0);
  const nb = 5 + Math.floor(Math.random() * 2);
  for (let i = 0; i < nb; i++) {
    const az = i / nb * Math.PI * 2 + rand(-0.3, 0.3);
    const out = rand(0.55, 0.85) * radius, up = rand(1.6, 3.0);
    const p0 = top.clone().add(new THREE.Vector3(0, rand(-0.3, 0.2), 0));
    const p1 = p0.clone().add(new THREE.Vector3(Math.cos(az) * out * 0.4, up * 0.6, Math.sin(az) * out * 0.4));
    const p2 = p0.clone().add(new THREE.Vector3(Math.cos(az) * out, up, Math.sin(az) * out));
    const c = new THREE.CatmullRomCurve3([p0, p1, p2]);
    branchGeos.push(taperedTube(c, 10, 8, t => THREE.MathUtils.lerp(0.22, 0.06, t), 1.2));
    tips.push(p1, p2);
    // rameaux secondaires
    for (let k = 0; k < 3; k++) {
      const s = rand(0.4, 0.9), b0 = c.getPointAt(s);
      const az2 = az + rand(-1.1, 1.1);
      const b1 = b0.clone().add(new THREE.Vector3(Math.cos(az2) * rand(0.8, 1.6), rand(0.4, 1.2), Math.sin(az2) * rand(0.8, 1.6)));
      branchGeos.push(taperedTube(new THREE.CatmullRomCurve3([b0, b0.clone().lerp(b1, 0.5).add(new THREE.Vector3(0, 0.15, 0)), b1]), 6, 6, t => THREE.MathUtils.lerp(0.07, 0.025, t), 1.2));
      tips.push(b1);
    }
  }
  const wood = new THREE.Mesh(mergeGeometries(branchGeos), barkMat);
  wood.castShadow = wood.receiveShadow = true;
  g.add(wood);

  // feuillage : cartes de feuilles réparties sur une couronne ellipsoïdale dense
  const center = new THREE.Vector3(0, trunkH + 2.4, 0);
  const count = Math.floor(4200 * density);
  const card = new THREE.PlaneGeometry(0.6, 0.6); card.translate(0, 0.3, 0);
  const centers = new Float32Array(card.attributes.position.count * 3);
  for (let i = 0; i < card.attributes.position.count; i++) centers.set([center.x, center.y, center.z], i * 3);
  card.setAttribute('aCenter', new THREE.BufferAttribute(centers, 3));
  const leaves = new THREE.InstancedMesh(card, getLeafMat(), count);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const colr = new THREE.Color();
  for (let i = 0; i < count; i++) {
    // points en surface (avec un peu d'épaisseur), plus denses en haut
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
    const sr = Math.sqrt(1 - u * u);
    const shell = Math.pow(Math.random(), 0.35);
    p.set(Math.cos(th) * sr * radius * shell, u * 2.3 * shell, Math.sin(th) * sr * radius * shell);
    if (p.y < -1.6) p.y = -1.6 + Math.random() * 0.5; // dessous aplati (ombre des manguiers)
    // attache aux branches proches pour un volume moins "boule"
    const tip = tips[Math.floor(Math.random() * tips.length)];
    p.add(center).lerp(tip.clone().add(new THREE.Vector3(rand(-1.2, 1.2), rand(-0.4, 1.2), rand(-1.2, 1.2))), 0.35);
    e.set(rand(-1.2, 1.2), Math.random() * 6.28, rand(-1.2, 1.2)); q.setFromEuler(e);
    const sc = rand(0.75, 1.25); s.set(sc, sc, sc);
    m4.compose(p, q, s);
    leaves.setMatrixAt(i, m4);
    colr.setHSL(rand(0.23, 0.3), rand(0.45, 0.65), rand(0.2, 0.34));
    leaves.setColorAt(i, colr);
  }
  leaves.castShadow = true; leaves.receiveShadow = true;
  leaves.computeBoundingSphere();
  g.add(leaves);
  g.userData.radius = 0.45;
  return g;
}

/* ================= Herbe (touffes instanciées) ================= */
export function scatterGrass(scene, grassScene, areas, density) {
  // grassScene : modèle Poly Haven grass_bermuda_01 (plusieurs variantes)
  const variants = [];
  grassScene.updateMatrixWorld(true);
  grassScene.traverse(o => { if (o.isMesh && !/dead|flattened/.test(o.name)) variants.push(o); });
  const meshes = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const per = Math.max(1, Math.floor(areas.reduce((a, r) => a + (r.x1 - r.x0) * (r.z1 - r.z0), 0) * 9 * density / variants.length));
  for (const v of variants) {
    const geo = v.geometry.clone();
    geo.applyMatrix4(v.matrixWorld);
    geo.computeBoundingBox(); const bb = geo.boundingBox; geo.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2);
    const im = new THREE.InstancedMesh(geo, v.material, per);
    let n = 0;
    for (let i = 0; i < per; i++) {
      const a = areas[Math.floor(Math.random() * areas.length)];
      p.set(rand(a.x0, a.x1), a.y || 0, rand(a.z0, a.z1));
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * 6.28);
      const sc = rand(1.6, 3.2); s.set(sc, sc * rand(0.8, 1.4), sc);
      m4.compose(p, q, s); im.setMatrixAt(n++, m4);
    }
    im.count = n; im.userData.maxCount = n;
    im.receiveShadow = true; im.castShadow = false;
    im.computeBoundingSphere();
    scene.add(im); meshes.push(im);
  }
  return meshes;
}
