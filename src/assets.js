// Chargement des ressources : modèles et textures PBR (Poly Haven, CC0), personnages (exemples Three.js).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const PH_API = 'https://api.polyhaven.com/files/';
export const THREE_EX = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/';

const gltfLoader = new GLTFLoader();
const texLoader = new THREE.TextureLoader();
let maxAniso = 8;
export function setMaxAnisotropy(a) { maxAniso = a; }

/* ---- progression ---- */
const progress = { total: 0, done: 0, label: '', listeners: [] };
export function onProgress(fn) { progress.listeners.push(fn); }
function track(promise, label) {
  progress.total++;
  return promise.finally(() => {
    progress.done++;
    progress.label = label;
    progress.listeners.forEach(f => f(progress.done / progress.total, label));
  });
}

/* ---- robustesse réseau : délai max + nouvelles tentatives ---- */
const sleep = ms => new Promise(r => setTimeout(r, ms));
function withTimeout(p, ms, what) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('délai dépassé : ' + what)), ms))]);
}
async function retry(fn, what, tries = 3, timeout = 45000) {
  let err;
  for (let i = 0; i < tries; i++) {
    try { return await withTimeout(fn(), timeout, what); } catch (e) { err = e; await sleep(700 * (i + 1)); }
  }
  throw err;
}

const fileCache = new Map();
function phFiles(id) {
  if (!fileCache.has(id)) fileCache.set(id, retry(() => fetch(PH_API + id).then(r => { if (!r.ok) throw new Error('Poly Haven ' + id); return r.json(); }), id));
  return fileCache.get(id);
}

/* ---- modèles ---- */
const modelCache = new Map();
export function polyModel(id) {
  if (!modelCache.has(id)) {
    const p = phFiles(id).then(f => {
      // le .gltf référence ses textures en chemins relatifs : on les redirige vers les vraies URLs du CDN
      const entry = f.gltf['1k'].gltf;
      const inc = entry.include || {};
      const mgr = new THREE.LoadingManager();
      mgr.setURLModifier(url => { for (const k in inc) if (url.endsWith(k)) return inc[k].url; return url; });
      return retry(() => new GLTFLoader(mgr).loadAsync(entry.url), id, 2, 90000);
    }).catch(e => {
      // un décor manquant ne doit pas bloquer le jeu
      console.warn('[babi] modèle indisponible', id, e.message);
      return { scene: new THREE.Group() };
    }).then(g => {
      g.scene.traverse(o => {
        if (o.isMesh) {
          o.castShadow = true; o.receiveShadow = true;
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          ms.forEach(m => { for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = maxAniso; });
        }
      });
      return g.scene;
    });
    modelCache.set(id, track(p, id.replace(/_/g, ' ')));
  }
  return modelCache.get(id);
}

export function threeModel(file) {
  if (!modelCache.has(file)) modelCache.set(file, track(retry(() => gltfLoader.loadAsync(THREE_EX + 'models/gltf/' + file), file, 3, 90000), 'personnage'));
  return modelCache.get(file);
}

/** Modèle du projet (assets/…), avec son fichier de description .json s'il existe. */
export function localModel(path) {
  if (!modelCache.has(path)) modelCache.set(path, track(retry(async () => {
    const g = await gltfLoader.loadAsync(path);
    const meta = await fetch(path.replace(/\.glb$/, '.json')).then(r => r.ok ? r.json() : null).catch(() => null);
    return Object.assign(g, { meta });
  }, path, 3, 120000), 'personnage'));
  return modelCache.get(path);
}

export function threeTexture(path, srgb = false) {
  return track(retry(() => texLoader.loadAsync(THREE_EX + path), path).then(t => {
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return t;
  }), 'textures');
}

/* ---- textures PBR → matériaux ---- */
const texSetCache = new Map();
function loadTex(url, srgb) {
  if (!url) return Promise.resolve(null);
  return retry(() => texLoader.loadAsync(url), url.split('/').pop(), 3, 40000).then(t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }).catch(e => { console.warn('[babi] texture indisponible', url, e.message); return null; });
}
export function polyTextureSet(id) {
  if (!texSetCache.has(id)) {
    const p = phFiles(id).catch(() => ({})).then(async f => {
      const pick = k => f[k]?.['1k']?.jpg?.url;
      const [map, normalMap, arm, rough] = await Promise.all([
        loadTex(pick('Diffuse'), true),
        pick('nor_gl') ? loadTex(pick('nor_gl')) : null,
        pick('arm') ? loadTex(pick('arm')) : null,
        !pick('arm') && pick('Rough') ? loadTex(pick('Rough')) : null,
      ]);
      return { map, normalMap, arm, rough };
    });
    texSetCache.set(id, track(p, id.replace(/_/g, ' ')));
  }
  return texSetCache.get(id);
}

/**
 * Matériau PBR basé sur une texture Poly Haven.
 * tile = taille réelle (m) couverte par une répétition de la texture (utilisée par les géométries "monde").
 */
export async function pbr(id, { tile = 2, color, roughness = 1, metalness, normalScale = 1, envIntensity = 1 } = {}) {
  const s = await polyTextureSet(id);
  const m = new THREE.MeshStandardMaterial({
    map: s.map, normalMap: s.normalMap || null,
    roughnessMap: s.arm || s.rough || null, roughness,
    aoMap: s.arm || null, aoMapIntensity: 1,
    metalnessMap: s.arm || null, metalness: metalness ?? (s.arm ? 1 : 0),
    envMapIntensity: envIntensity,
  });
  if (s.normalMap) m.normalScale.set(normalScale, normalScale);
  if (color) m.color.set(color);
  m.userData.tile = tile;
  m.name = id;
  return m;
}

/* ---- géométries à UV "monde" (texture à l'échelle réelle) ---- */
export function worldBox(w, h, d, tile = 2, offset = [0, 0]) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * dims[f][0] / tile + offset[0], uv.getY(k) * dims[f][1] / tile + offset[1]);
    }
  }
  return g;
}
export function worldPlane(w, h, tile = 2, segW = 1, segH = 1) {
  const g = new THREE.PlaneGeometry(w, h, segW, segH);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w / tile, uv.getY(i) * h / tile);
  return g;
}

/** Mesh boîte texturée à l'échelle, ombres activées. */
export function tbox(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(worldBox(w, h, d, mat.userData.tile || 2, [Math.random(), Math.random()]), mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  return m;
}
