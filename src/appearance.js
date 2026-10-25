// Apparence des personnages (modèles MakeHuman générés dans Blender : tools/blender/build_characters.py).
// Chaque modèle .glb contient le corps, les yeux/sourcils/cils, TOUTE la garde-robe et les coiffures, skinnés sur le même
// squelette : changer de tenue = afficher d'autres maillages. Visage et corpulence = morph targets (les vêtements ont les mêmes
// morphes, recalculés dans Blender, donc ils suivent). La peau sous les vêtements portés est masquée (attribut _hidebits).
// La même fonction applyAppearance() sert dans l'éditeur ET dans le monde : le personnage créé est celui qu'on joue.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

export const SKIN_TONES = ['#2f1c12', '#3b2418', '#4d2e1f', '#5e3a27', '#71472f', '#86573a', '#a06d4c', '#b9845f'];
const SKIN_REF = '#5e3a27'; // teint moyen de la texture de peau d'origine (multiplicateur = teint choisi / référence)
export const HAIR_COLORS = [
  { id: 'noir', name: 'Noir', c: '#0d0b0a' }, { id: 'brun', name: 'Brun foncé', c: '#2a1a12' }, { id: 'chatain', name: 'Châtain', c: '#4a2f1e' },
  { id: 'henne', name: 'Henné', c: '#6b2a17' }, { id: 'blond', name: 'Blond décoloré', c: '#b98a4e' }, { id: 'bordeaux', name: 'Bordeaux', c: '#4a1020' },
];
// mesh : coiffure MakeHuman (maillage H_<mesh>) ; null = crâne rasé
export const HAIR_STYLES = {
  m: [
    { id: 'rase', name: 'Crâne rasé', mesh: null }, { id: 'court', name: 'Court', mesh: 'short04' }, { id: 'degrade', name: 'Dégradé plaqué', mesh: 'short01' },
    { id: 'meche', name: 'Mi-long', mesh: 'short02' }, { id: 'afro', name: 'Afro', mesh: 'afro01' },
  ],
  f: [
    { id: 'afro', name: 'Afro', mesh: 'afro01' }, { id: 'tresse', name: 'Tresse', mesh: 'braid01' }, { id: 'queue', name: 'Queue de cheval', mesh: 'ponytail01' },
    { id: 'carre', name: 'Carré', mesh: 'bob01' }, { id: 'long', name: 'Longs lissés', mesh: 'long01' }, { id: 'court', name: 'Court', mesh: 'short02' },
  ],
};
export const BEARDS = [];

/** Catalogue. g : sexe ('m' / 'f', absent = les deux) ; starter = disponible à la création ; sinon à acheter à l'atelier.
 *  tint : la couleur choisie teinte le vêtement ; full : couvre aussi le bas ; bottom : bas assorti imposé. */
export const CLOTHES = {
  top: [
    { id: 'tee_blanc', g: 'm', name: 'T-shirt uni', price: 0, starter: true, cat: 'Décontracté', tint: true },
    { id: 'tee_imprime', g: 'm', name: 'T-shirt imprimé', price: 0, starter: true, cat: 'Streetwear' },
    { id: 'manches_longues', g: 'm', name: 'T-shirt manches longues', price: 0, starter: true, cat: 'Décontracté' },
    { id: 'chemise_jean', g: 'm', name: 'Chemise en jean', price: 0, starter: true, cat: 'Classique' },
    { id: 'chemise_carreaux', g: 'm', name: 'Chemise à carreaux', price: 5000, cat: 'Classique' },
    { id: 'veste', g: 'm', name: 'Veste et chemise', price: 12000, cat: 'Classique' },
    { id: 'costume', g: 'm', name: 'Costume et cravate', price: 0, starter: true, cat: 'Business' },
    { id: 'salopette', g: 'm', name: 'Salopette de travail', price: 7000, cat: 'Travail', full: true },
    { id: 'tee', g: 'f', name: 'T-shirt', price: 0, starter: true, cat: 'Décontracté' },
    { id: 'tee_court', g: 'f', name: 'T-shirt court', price: 0, starter: true, cat: 'Streetwear' },
    { id: 'chemisier', g: 'f', name: 'Chemisier élégant', price: 0, starter: true, cat: 'Business' },
    { id: 'brassiere', g: 'f', name: 'Haut de sport', price: 0, starter: true, cat: 'Sport' },
  ],
  bottom: [
    { id: 'jean', name: 'Jean', price: 0, starter: true },
    { id: 'pantalon_costume', g: 'm', name: 'Pantalon de costume', price: 0, starter: true },
    { id: 'short', g: 'f', name: 'Short en jean', price: 0, starter: true },
    { id: 'jupe', g: 'f', name: 'Jupe droite', price: 0, starter: true },
    { id: 'legging', g: 'f', name: 'Legging de sport', price: 0, starter: true },
  ],
  shoes: [
    { id: 'baskets_blanches', name: 'Baskets blanches', price: 0, starter: true },
    { id: 'baskets_bleues', name: 'Baskets bleues', price: 0, starter: true },
    { id: 'baskets_sport', g: 'm', name: 'Baskets de sport', price: 6000 },
    { id: 'chaussures_ville', g: 'm', name: 'Chaussures de ville', price: 0, starter: true },
    { id: 'chaussures_cuir', g: 'm', name: 'Chaussures en cuir', price: 9000 },
    { id: 'bottines', g: 'f', name: 'Bottines', price: 0, starter: true },
  ],
};
export const clothesFor = (slot, gender) => CLOTHES[slot].filter(i => !i.g || i.g === gender);
export const ACCESSORIES = {
  glasses: [{ id: 'aucune', name: 'Aucune', price: 0, starter: true }, { id: 'soleil', name: 'Lunettes de soleil', price: 0, starter: true }, { id: 'vue', name: 'Lunettes de vue', price: 0, starter: true }],
  watch: [{ id: 'aucune', name: 'Aucune', price: 0, starter: true }, { id: 'classique', name: 'Montre dorée', price: 0, starter: true }, { id: 'sport', name: 'Montre sport', price: 0, starter: true }],
  jewel: [{ id: 'aucun', name: 'Aucun', price: 0, starter: true }, { id: 'chaine', name: 'Chaîne argentée', price: 0, starter: true }, { id: 'or', name: 'Chaîne en or', price: 30000 }, { id: 'boucles', name: 'Boucles d\'oreilles', price: 0, starter: true }],
  bag: [{ id: 'aucun', name: 'Aucun', price: 0, starter: true }, { id: 'dos', name: 'Sac à dos', price: 0, starter: true }, { id: 'malette', name: 'Mallette', price: 0, starter: true }],
  hat: [{ id: 'aucun', name: 'Aucun', price: 0, starter: true }, { id: 'casquette', name: 'Casquette « Abidjan »', price: 0, starter: true }, { id: 'feutre', name: 'Chapeau feutre', price: 0, starter: true }],
};
/** Styles complets (skins) : un clic applique haut, bas, chaussures et accessoires ; tenue selon le sexe. */
export const SKINS = [
  { id: 'classique', name: 'Classique', desc: 'Le style du quotidien', m: { top: 'tee_blanc', color: '#f1efe9', bottom: 'jean', shoes: 'baskets_blanches' }, f: { top: 'tee', bottom: 'jean', shoes: 'baskets_blanches' }, acc: { glasses: 'aucune', watch: 'classique', jewel: 'chaine', bag: 'aucun', hat: 'aucun' } },
  { id: 'business', name: 'Business', desc: 'Ambition & réussite', m: { top: 'costume', bottom: 'pantalon_costume', shoes: 'chaussures_ville' }, f: { top: 'chemisier', bottom: 'jupe', shoes: 'bottines' }, acc: { glasses: 'vue', watch: 'classique', jewel: 'aucun', bag: 'malette', hat: 'aucun' } },
  { id: 'sport', name: 'Sport', desc: 'Toujours en mouvement', m: { top: 'tee_imprime', bottom: 'jean', shoes: 'baskets_bleues' }, f: { top: 'brassiere', bottom: 'legging', shoes: 'baskets_bleues' }, acc: { glasses: 'soleil', watch: 'sport', jewel: 'aucun', bag: 'dos', hat: 'casquette' } },
  { id: 'street', name: 'Streetwear', desc: 'La rue, c\'est chez nous', m: { top: 'chemise_jean', bottom: 'jean', shoes: 'baskets_blanches' }, f: { top: 'tee_court', bottom: 'short', shoes: 'baskets_blanches' }, acc: { glasses: 'soleil', watch: 'aucune', jewel: 'or', bag: 'dos', hat: 'aucun' } },
  { id: 'nightlife', name: 'Nightlife', desc: 'La ville ne dort jamais', m: { top: 'tee_blanc', color: '#16171a', bottom: 'jean', shoes: 'chaussures_ville' }, f: { top: 'chemisier', bottom: 'jean', shoes: 'bottines' }, acc: { glasses: 'aucune', watch: 'classique', jewel: 'chaine', bag: 'aucun', hat: 'feutre' } },
];
export function applySkin(look, id) {
  const sk = SKINS.find(k => k.id === id); if (!sk) return look;
  const o = sk[look.gender] || sk.m;
  look.top = { style: o.top, color: o.color || (look.top && look.top.color) || '#f1efe9' }; look.bottom = { style: o.bottom }; look.shoes = { style: o.shoes };
  look.acc = { ...sk.acc }; look.skin_id = id;
  return look;
}
export const FACE_SLIDERS = [
  ['width', 'Largeur du visage'], ['jaw', 'Mâchoire'], ['chin', 'Menton'], ['eyes', 'Taille des yeux'], ['nose', 'Nez'], ['mouth', 'Largeur de la bouche'], ['lips', 'Lèvres'],
];
export const BODY_SLIDERS = [['height', 'Taille'], ['build', 'Corpulence'], ['shoulders', 'Carrure'], ['legs', 'Jambes']];
export const COLORS = ['#1b1d22', '#f1efe9', '#1f3b70', '#7a1d1d', '#2f6b45', '#d9782b', '#e6b422', '#6a4a8c', '#8a8f96', '#c9b49a'];

export function defaultAppearance(gender = 'm') {
  const a = {
    gender, skin: SKIN_TONES[3],
    face: { width: 0, jaw: 0, chin: 0, eyes: 0, nose: 0, mouth: 0, lips: 0 },
    body: { height: 0, build: 0, shoulders: 0, legs: 0 },
    hair: { style: gender === 'm' ? 'court' : 'tresse', color: 'noir' },
    beard: 'aucune', top: {}, bottom: {}, shoes: {}, acc: {},
    owned: [],
  };
  return applySkin(a, 'classique');
}
/** Ramène une apparence (ancienne sauvegarde, autre sexe…) sur des articles qui existent pour ce sexe. */
export function normalizeLook(look) {
  const d = defaultAppearance(look.gender === 'f' ? 'f' : 'm');
  const L = Object.assign({}, d, look, { face: { ...d.face, ...(look.face || {}) }, body: { ...d.body, ...(look.body || {}) }, acc: { ...d.acc, ...(look.acc || {}) } });
  const ok = (slot, v) => clothesFor(slot, L.gender).some(i => i.id === v);
  for (const slot of ['top', 'bottom', 'shoes']) { L[slot] = { ...d[slot], ...(look[slot] || {}) }; if (!ok(slot, L[slot].style)) L[slot] = { ...d[slot], color: L[slot].color || d[slot].color }; }
  if (!HAIR_STYLES[L.gender].some(h => h.id === (L.hair && L.hair.style))) L.hair = { style: d.hair.style, color: (look.hair && look.hair.color) || 'noir' };
  for (const k of Object.keys(ACCESSORIES)) if (!ACCESSORIES[k].some(i => i.id === L.acc[k])) L.acc[k] = d.acc[k];
  L.owned = look.owned || [];
  return L;
}
export function randomAppearance(gender, seed = Math.random() * 1e9) {
  let s = Math.floor(seed) % 2147483647 || 1; const r = () => (s = s * 16807 % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(r() * a.length)];
  const a = defaultAppearance(gender);
  a.skin = pick(SKIN_TONES.slice(0, 7));
  for (const k in a.face) a.face[k] = Math.round((r() * 1.6 - 0.8) * 10) / 10;
  for (const k in a.body) a.body[k] = Math.round((r() * 1.2 - 0.6) * 10) / 10;
  a.hair = { style: pick(HAIR_STYLES[gender]).id, color: r() < 0.8 ? 'noir' : pick(HAIR_COLORS).id };
  applySkin(a, pick(SKINS).id);
  if (r() < 0.4) a.top = { style: pick(clothesFor('top', gender)).id, color: pick(COLORS) };
  a.acc = { glasses: r() < 0.25 ? pick(['vue', 'soleil']) : 'aucune', watch: r() < 0.5 ? pick(['sport', 'classique']) : 'aucune', jewel: gender === 'f' && r() < 0.5 ? 'boucles' : r() < 0.2 ? 'chaine' : 'aucun', bag: r() < 0.2 ? 'dos' : 'aucun', hat: r() < 0.15 ? pick(['casquette', 'feutre']) : 'aucun' };
  return a;
}

/* ===================================================================== */
/* Analyse du modèle de base (une fois par sexe) : positions de repos     */
/* ===================================================================== */
const V = THREE.Vector3;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const infoCache = new Map();

/** Positions monde (pose de repos = pose de liaison du glTF) d'un maillage skinné. */
function restPositions(mesh) {
  mesh.skeleton.update();
  const P = mesh.geometry.attributes.position, out = new Float32Array(P.count * 3), v = new V();
  for (let i = 0; i < P.count; i++) { v.fromBufferAttribute(P, i); mesh.applyBoneTransform(i, v); v.applyMatrix4(mesh.matrixWorld); v.toArray(out, i * 3); }
  return out;
}
/** Surface (repos) d'un maillage : pour une case (x, y) de 2 cm, z avant max et z arrière min ; demi-largeur par hauteur. */
function surfaceOf(pos) {
  const cell = new Map();
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i], y = pos[i + 1], z = pos[i + 2], k = Math.round(x / 0.02) + ':' + Math.round(y / 0.02);
    const c = cell.get(k) || [-9, 9]; c[0] = Math.max(c[0], z); c[1] = Math.min(c[1], z); cell.set(k, c);
  }
  const get = (x, y) => cell.get(Math.round(x / 0.02) + ':' + Math.round(y / 0.02));
  return {
    // z de la surface en (x, y), côté avant ou arrière ; cherche autour si la case est vide
    z(x, y, front) {
      for (const r of [0, 1, 2]) for (const [dx, dy] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r], [r, r], [-r, r]]) {
        const c = get(x + dx * 0.02, y + dy * 0.02); if (c) return front ? c[0] : c[1];
      }
      return front ? 0.1 : -0.1;
    },
    // demi-largeur du torse à la hauteur y : dernière case où l'épaisseur avant-arrière est celle d'un torse (pas d'un bras)
    halfWidth(y) {
      let w = 0.12;
      for (let x = 0.1; x < 0.3; x += 0.02) { const c = get(x, y); if (c && c[0] - c[1] > 0.12) w = x; else if (x > 0.14) break; }
      return w;
    },
  };
}
function baseInfo(base) {
  if (infoCache.has(base)) return infoCache.get(base);
  const sc = base.gltf.scene; sc.updateMatrixWorld(true);
  const mesh = n => { let o; sc.traverse(x => { if (x.isSkinnedMesh && x.name === n) o = x; }); return o; };
  const bone = n => sc.getObjectByName('mixamorig' + n);
  const bp = n => bone(n).getWorldPosition(new V());
  const body = mesh('Body'), bodyPos = restPositions(body);
  const eyes = restPositions(mesh('Eyes'));
  const eyeC = [new V(), new V()], cnt = [0, 0];
  for (let i = 0; i < eyes.length; i += 3) { const s = eyes[i] > 0 ? 0 : 1; eyeC[s].add(new V(eyes[i], eyes[i + 1], eyes[i + 2])); cnt[s]++; }
  eyeC[0].divideScalar(cnt[0]); eyeC[1].divideScalar(cnt[1]);
  // crâne : sommets du corps au-dessus des sourcils
  const eyeY = (eyeC[0].y + eyeC[1].y) / 2, head = { x0: 9, x1: -9, z0: 9, z1: -9, top: -9 };
  for (let i = 0; i < bodyPos.length; i += 3) {
    const x = bodyPos[i], y = bodyPos[i + 1], z = bodyPos[i + 2];
    if (y < eyeY + 0.02) continue;
    head.x0 = Math.min(head.x0, x); head.x1 = Math.max(head.x1, x); head.z0 = Math.min(head.z0, z); head.z1 = Math.max(head.z1, z); head.top = Math.max(head.top, y);
  }
  const surfaces = new Map();
  const info = {
    sc, body, bodyPos, bone, bp, eyeC, eyeY, head,
    boneInv: n => bone(n).matrixWorld.clone().invert(),
    surface(name) { // surface du vêtement porté (ou du corps)
      if (!surfaces.has(name)) { const m = mesh(name) || body; surfaces.set(name, surfaceOf(restPositions(m))); }
      return surfaces.get(name);
    },
  };
  infoCache.set(base, info);
  return info;
}

/* ===================================================================== */
/* Accessoires (construits en coordonnées monde de repos)                 */
/* ===================================================================== */
const spineWeights = y => {
  const ch = [['Hips', 1.0], ['Spine', 1.12], ['Spine1', 1.25], ['Spine2', 1.37], ['Neck', 1.55]];
  if (y <= ch[0][1]) return [['Hips', 1]];
  for (let k = 1; k < ch.length; k++) if (y <= ch[k][1] || k === ch.length - 1) { const f = THREE.MathUtils.clamp((y - ch[k - 1][1]) / (ch[k][1] - ch[k - 1][1]), 0, 1); return [[ch[k - 1][0], 1 - f], [ch[k][0], f]]; }
};
/** Géométrie monde (repos) → maillage skinné sur le squelette du corps cloné (suit la colonne comme le vêtement). */
function skinned(ch, info, geo, material, wfn, tag = 'accessoire') {
  const body = ch.model.getObjectByName('Body');
  const names = body.skeleton.bones.map(b => b.name), P = geo.attributes.position, n = P.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), v = new V();
  const inv = info.body.matrixWorld.clone().invert();
  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(P, i);
    wfn(v).forEach(([b, w], j) => { si[i * 4 + j] = Math.max(0, names.indexOf('mixamorig' + b)); sw[i * 4 + j] = w; });
    v.applyMatrix4(inv); P.setXYZ(i, v.x, v.y, v.z);
  }
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  geo.computeVertexNormals();
  const m = new THREE.SkinnedMesh(geo, material); m.bind(body.skeleton, body.bindMatrix);
  m.castShadow = m.receiveShadow = true; m.frustumCulled = false;
  m.userData.acc = tag; body.add(m); ch.attached.push(m); // enfant du corps : hérite de la transformation du nœud (sinon décalage / demi-tour)
  return m;
}
/** Objet construit en coordonnées monde de repos, attaché rigidement à un os. */
function onBone(ch, info, obj, boneName, tag = 'accessoire') {
  obj.userData.acc = tag;
  obj.applyMatrix4(info.boneInv(boneName));
  ch.bones[boneName].add(obj); obj.traverse(x => { if (x.isMesh) x.castShadow = true; });
  ch.attached.push(obj);
}
function ribbon(pts, closed, wdt, th, center) {
  const curve = new THREE.CatmullRomCurve3(pts, closed, 'centripetal');
  const N = Math.max(40, pts.length * 8), pos = [], idx = [];
  for (let i = 0; i <= N; i++) {
    const p = curve.getPointAt(i / N), t = curve.getTangentAt(i / N);
    const nrm = new V(p.x - center.x, 0, p.z - center.z).normalize();
    if (p.y > center.y) nrm.lerp(new V(0, 1, 0), sstep(center.y, center.y + 0.04, p.y) * 0.9).normalize(); // à plat sur l'épaule
    const b = new V().crossVectors(t, nrm).normalize();
    for (const [u, w] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) pos.push(...p.clone().addScaledVector(b, u * wdt).addScaledVector(nrm, w * th).toArray());
  }
  for (let i = 0; i < N; i++) for (let k = 0; k < 4; k++) { const a = i * 4 + k, b2 = i * 4 + (k + 1) % 4; idx.push(a, b2, a + 4, b2, b2 + 4, a + 4); }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  return g;
}
function glassesMesh(info, kind) {
  const g = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: kind === 'soleil' ? '#141414' : '#2b2018', roughness: 0.3, metalness: 0.3 });
  const lens = new THREE.MeshPhysicalMaterial({ color: kind === 'soleil' ? '#0d1116' : '#ffffff', roughness: 0.02, transparent: true, opacity: kind === 'soleil' ? 0.85 : 0.12, clearcoat: 1 });
  const [L, R] = info.eyeC, c = L.clone().add(R).multiplyScalar(0.5), ex = Math.abs(L.x - R.x) / 2;
  const z = Math.max(L.z, R.z) + 0.016, hx = (info.head.x1 - info.head.x0) / 2 + 0.004, back = info.head.z0 + (info.head.z1 - info.head.z0) * 0.45;
  for (const s of [-1, 1]) {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.0022, 8, 28), frame); ring.scale.set(1.15, 0.85, 1); ring.position.set(c.x + s * ex, c.y, z); g.add(ring);
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.02, 24), lens); l.scale.set(1.15, 0.85, 1); l.position.set(c.x + s * ex, c.y, z); g.add(l);
    // branche : du bord de la monture jusqu'au-dessus de l'oreille, contre la tempe
    const a = new V(c.x + s * (ex + 0.023), c.y + 0.004, z - 0.004), b = new V(c.x + s * hx, c.y + 0.006, back);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.0016, 0.0016, a.distanceTo(b), 6), frame);
    arm.position.copy(a).add(b).multiplyScalar(0.5); arm.quaternion.setFromUnitVectors(new V(0, 1, 0), b.clone().sub(a).normalize()); g.add(arm);
  }
  const bridge = new THREE.Mesh(new THREE.TorusGeometry(ex - 0.023, 0.002, 6, 12, Math.PI), frame); bridge.position.set(c.x, c.y + 0.002, z); bridge.scale.set(1, 0.4, 1); g.add(bridge);
  return g;
}
function watchMesh(info, kind) {
  // bracelet autour du poignet (rayon mesuré sur le corps), cadran sur le dessus
  const g = new THREE.Group();
  const strap = new THREE.MeshStandardMaterial({ color: kind === 'classique' ? '#3a2416' : '#151515', roughness: 0.6 });
  const caseM = new THREE.MeshStandardMaterial({ color: kind === 'classique' ? '#d4a94a' : '#2a2a2a', roughness: 0.25, metalness: kind === 'classique' ? 1 : 0.3 });
  const H = info.bp('LeftHand'), E = info.bp('LeftForeArm'), ax = H.clone().sub(E).normalize();
  const wrist = H.clone().addScaledVector(ax, -0.045);
  let r = 0; const P = info.bodyPos, p = new V();
  for (let i = 0; i < P.length; i += 3) { p.set(P[i], P[i + 1], P[i + 2]).sub(wrist); const t = p.dot(ax); if (Math.abs(t) < 0.008) { const rr = p.addScaledVector(ax, -t).length(); if (rr < 0.06) r = Math.max(r, rr); } }
  r = (r || 0.028) + 0.003;
  const band = new THREE.Mesh(new THREE.TorusGeometry(r, 0.0035, 8, 32), strap); band.scale.set(1, 0.8, 2.6); g.add(band);
  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.007, 24), caseM); face.position.y = r * 0.8 + 0.003; g.add(face);
  // repère : axe du tore (z local) = axe de l'avant-bras, cadran (y local) vers le haut
  const up = new V(0, 1, 0).addScaledVector(ax, -ax.y).normalize();
  g.applyMatrix4(new THREE.Matrix4().makeBasis(new V().crossVectors(up, ax), up, ax)); g.position.copy(wrist);
  return g;
}
function chainGeometry(info, surf, bulk = 0) {
  // repose sur le col dans le dos et sur les côtés, retombe sur la poitrine devant (surface du haut porté)
  const top = info.bp('Neck').y - 0.015, pts = [];
  for (let k = 0; k < 40; k++) {
    const ph = k / 40 * Math.PI * 2, c = Math.cos(ph), f = Math.max(0, c);
    const y = top - 0.12 * f * f, x = Math.sin(ph) * (0.065 + 0.03 * f), front = c > 0;
    pts.push(new V(x, y, surf.z(x, y, front) + (front ? 0.005 + bulk : -0.005 - bulk)));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), 120, 0.0022, 6, true);
}
function capGroup(info) {
  const g = new THREE.Group(), H = info.head;
  const fabric = new THREE.MeshStandardMaterial({ color: '#121214', roughness: 0.85 });
  const cx = (H.x0 + H.x1) / 2, cz = (H.z0 + H.z1) / 2 - 0.005, rx = (H.x1 - H.x0) / 2 + 0.014, rz = (H.z1 - H.z0) / 2 + 0.014;
  const base = info.eyeY + 0.035, ry = H.top - base + 0.016;
  const crown = new THREE.SphereGeometry(1, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2); crown.scale(rx, ry, rz); crown.translate(cx, base, cz);
  g.add(new THREE.Mesh(crown, fabric));
  const brim = new THREE.Shape(); brim.absellipse(0, 0, rx * 0.85, 0.07, 0, Math.PI, false);
  const bg = new THREE.ExtrudeGeometry(brim, { depth: 0.005, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 24 });
  bg.rotateX(-Math.PI / 2 + 0.15); bg.translate(cx, base + 0.004, cz + rz * 0.9);
  g.add(new THREE.Mesh(bg, fabric));
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 128; const c2 = cv.getContext('2d');
  c2.fillStyle = '#f4f1ea'; c2.font = '700 italic 54px Oswald'; c2.textAlign = 'center'; c2.fillText('ABIDJAN', 128, 84);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const logo = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.045), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.8 }));
  logo.position.set(cx, base + ry * 0.45, cz + rz * Math.cos(Math.asin(0.45)) + 0.003); logo.rotation.x = -0.45; g.add(logo);
  return g;
}
/** Matrice monde d'un os dans la pose de repos ANIMÉE (clip idle), pas dans la pose de liaison bras écartés. */
const idleCache = new Map();
function idleBoneMatrix(base, boneName) {
  const key = base.gltf.uuid + boneName;
  if (!idleCache.has(key)) {
    const root = SkeletonUtils.clone(base.gltf.scene), mixer = new THREE.AnimationMixer(root);
    mixer.clipAction(base.clips.idle).play(); mixer.setTime(0); root.updateMatrixWorld(true);
    idleCache.set(key, root.getObjectByName('mixamorig' + boneName).matrixWorld.clone());
  }
  return idleCache.get(key);
}
function briefcaseGroup(info) {
  const g = new THREE.Group();
  const leather = new THREE.MeshStandardMaterial({ color: '#1a1714', roughness: 0.45, metalness: 0.05 });
  const metal = new THREE.MeshStandardMaterial({ color: '#c9c3b5', roughness: 0.25, metalness: 1 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.31, 0.42, 2, 2, 2), leather); body.position.y = -0.2; g.add(body);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.009, 8, 16, Math.PI), leather); handle.rotation.y = Math.PI / 2; handle.position.y = -0.04; g.add(handle);
  for (const z of [-0.12, 0.12]) { const lock = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.02, 0.03), metal); lock.position.set(0.052, -0.07, z); g.add(lock); }
  return g;
}

/* ===================================================================== */
/* Application                                                             */
/* ===================================================================== */
const BODY_COMP = ['Spine', 'Spine1', 'Spine2', 'Neck', 'LeftShoulder', 'RightShoulder', 'LeftUpLeg', 'RightUpLeg', 'LeftLeg', 'RightLeg'];

/** Shader du corps : teint + peau masquée sous les vêtements portés (bits de _hidebits). */
function bodyMaterial(mat) {
  const m = mat.clone();
  m.userData.worn = { value: 0 };
  m.onBeforeCompile = sh => {
    sh.uniforms.uWorn = m.userData.worn;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float _hidebits; uniform int uWorn; flat varying int vHide;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHide = int(_hidebits + 0.5) & uWorn;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nflat varying int vHide;').replace('void main() {', 'void main() {\nif (vHide != 0) discard;');
  };
  m.customProgramCacheKey = () => 'babi-body-v1';
  return m;
}
/** Cheveux : texture désaturée puis teinte choisie ; découpe alpha nette (pas de tri de transparence). */
function hairMaterial(mat) {
  const m = mat.clone();
  m.userData.tint = { value: new THREE.Color('#111') };
  Object.assign(m, { transparent: false, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.75 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uHair = m.userData.tint;
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform vec3 uHair;')
      .replace('#include <map_fragment>', '#include <map_fragment>\nfloat hl = dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11));\ndiffuseColor.rgb = uHair * clamp(hl * 2.6, 0.25, 1.8);');
  };
  m.customProgramCacheKey = () => 'babi-hair-v1';
  return m;
}

/** Applique l'apparence à un Character (modèle cloné). Idempotent : peut être rappelé à chaque changement. */
export function applyAppearance(ch, look, base) {
  look = normalizeLook(look);
  const info = baseInfo(base), meta = base.meta;
  ch.look = look;
  const meshes = {};
  ch.model.traverse(o => { if (o.isMesh) meshes[o.name] = o; });
  // ---- matériaux propres à ce personnage (une fois) ----
  for (const [n, m] of Object.entries(meshes)) {
    if (m.userData.ownMat) continue;
    m.userData.ownMat = true;
    m.material = n === 'Body' ? bodyMaterial(m.material) : n.startsWith('H_') ? hairMaterial(m.material) : m.material.clone();
    if (n === 'Brows' || n === 'Lashes') Object.assign(m.material, { transparent: false, alphaTest: 0.4, side: THREE.DoubleSide });
    m.userData.baseColor = m.material.color.clone();
    // haut teintable : la texture d'origine (logo, taches) est retirée, le relief des plis (normal map) reste
    if (CLOTHES.top.some(t => t.tint && 'G_' + t.id === n)) { m.material.map = null; m.material.roughness = 0.9; m.material.needsUpdate = true; }
  }
  // ---- tenue : maillages visibles ----
  const top = CLOTHES.top.find(t => t.id === look.top.style);
  const worn = new Set(['G_' + look.top.style, 'G_' + look.shoes.style]);
  if (!top.full) worn.add('G_' + look.bottom.style);
  if (look.acc.hat === 'feutre') worn.add('G_feutre');
  const hairId = (HAIR_STYLES[look.gender].find(h => h.id === look.hair.style) || {}).mesh;
  const hatOn = look.acc.hat !== 'aucun';
  for (const [n, m] of Object.entries(meshes)) {
    if (n.startsWith('G_')) m.visible = worn.has(n);
    // sous un chapeau, seules les coiffures courtes restent (les volumineuses traverseraient)
    if (n.startsWith('H_')) m.visible = n === 'H_' + hairId && !(hatOn && /afro|bob|braid|ponytail|long/.test(n));
  }
  meshes.Body.material.userData.worn.value = meta.hideBits.reduce((acc, g, i) => acc | (worn.has('G_' + g) ? 1 << i : 0), 0);
  // ---- couleurs : teint, cheveux, haut teintable ----
  const tone = new THREE.Color(look.skin), ref = new THREE.Color(SKIN_REF);
  meshes.Body.material.color.setRGB(tone.r / ref.r, tone.g / ref.g, tone.b / ref.b);
  const hc = (HAIR_COLORS.find(h => h.id === look.hair.color) || HAIR_COLORS[0]).c;
  for (const [n, m] of Object.entries(meshes)) if (n.startsWith('H_')) m.material.userData.tint.value.set(hc);
  for (const t of CLOTHES.top) {
    const m = meshes['G_' + t.id]; if (!m) continue;
    if (t.tint && look.top.color) m.material.color.set(look.top.color).multiplyScalar(1.05); else m.material.color.copy(m.userData.baseColor);
  }
  // ---- visage et corpulence : morph targets (corps, vêtements, cheveux, yeux…) ----
  const sliders = { ...look.face, build: look.body.build };
  for (const m of Object.values(meshes)) {
    const dict = m.morphTargetDictionary; if (!dict) continue;
    for (const [k, v] of Object.entries(sliders)) {
      if (dict[k + '_plus'] !== undefined) m.morphTargetInfluences[dict[k + '_plus']] = Math.max(0, v);
      if (dict[k + '_moins'] !== undefined) m.morphTargetInfluences[dict[k + '_moins']] = Math.max(0, -v);
    }
  }
  // ---- carrure, jambes, taille : échelle des os (compensée sur les enfants) ----
  const B = ch.bones;
  for (const k of BODY_COMP) if (B[k]) B[k].scale.set(1, 1, 1);
  const sh = 1 + 0.1 * look.body.shoulders; if (B.Spine2) B.Spine2.scale.x = sh;
  for (const c of ['Neck', 'LeftShoulder', 'RightShoulder']) if (B[c]) B[c].scale.x = 1 / sh;
  const lg = 1 + 0.12 * look.body.legs; for (const s of ['Left', 'Right']) { if (B[s + 'UpLeg']) B[s + 'UpLeg'].scale.set(lg, 1, lg); if (B[s + 'Leg']) B[s + 'Leg'].scale.set(1 / lg, 1, 1 / lg); }
  const hs = 1 + 0.05 * look.body.height;
  ch.model.scale.setScalar(hs); ch.heightScale = hs;

  // ---- accessoires ----
  for (const o of ch.attached || []) o.parent && o.parent.remove(o);
  ch.attached = [];
  const topSurf = info.surface('G_' + top.id);
  if (look.acc.glasses !== 'aucune') onBone(ch, info, glassesMesh(info, look.acc.glasses), 'Head', 'lunettes');
  if (look.acc.watch !== 'aucune') onBone(ch, info, watchMesh(info, look.acc.watch), 'LeftHand', 'watch');
  if (look.acc.jewel === 'chaine' || look.acc.jewel === 'or')
    skinned(ch, info, chainGeometry(info, topSurf, 0.018 * Math.max(0, look.body.build)), new THREE.MeshStandardMaterial({ color: look.acc.jewel === 'or' ? '#d9a93f' : '#c9c9c9', metalness: 1, roughness: 0.2 }), p => p.y > 1.45 ? [['Spine2', 0.7], ['Neck', 0.3]] : spineWeights(p.y), 'chaîne');
  if (look.acc.jewel === 'boucles') {
    const gold = new THREE.MeshStandardMaterial({ color: '#d9a93f', metalness: 1, roughness: 0.2 }), grp = new THREE.Group(), H = info.head;
    for (const s of [-1, 1]) { const r = new THREE.Mesh(new THREE.TorusGeometry(0.008, 0.0015, 6, 16), gold); r.position.set(s > 0 ? H.x1 + 0.002 : H.x0 - 0.002, info.eyeY - 0.045, (H.z0 + H.z1) / 2 - 0.005); r.rotation.y = Math.PI / 2; grp.add(r); }
    onBone(ch, info, grp, 'Head', 'boucles');
  }
  if (look.acc.hat === 'casquette') onBone(ch, info, capGroup(info), 'Head', 'casquette');
  if (look.acc.bag === 'malette') {
    // construite verticale sous la main telle qu'elle est au repos animé (bras le long du corps), écartée de la cuisse
    const M = idleBoneMatrix(base, 'RightHand'), g = briefcaseGroup(info);
    g.position.setFromMatrixPosition(M).add(new V(-0.03, -0.05, 0));
    g.applyMatrix4(M.clone().invert()); g.userData.acc = 'mallette';
    ch.bones.RightHand.add(g); g.traverse(x => { if (x.isMesh) x.castShadow = true; }); ch.attached.push(g);
  }
  const nylon = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.62, metalness: 0.05 });
  const shoulderY = info.bp('LeftArm').y + 0.045, center = new V(0, shoulderY - 0.02, (topSurf.z(0, 1.3, true) + topSurf.z(0, 1.3, false)) / 2);
  // la corpulence (morphe) épaissit le haut d'environ 1,8 cm au maximum : les sangles restent posées dessus
  const bulk = 0.018 * Math.max(0, look.body.build) + 0.008 * Math.min(0, look.body.build);
  const on = (x, y, front, off = 0.006 + bulk) => new V(x, y, topSurf.z(x, y, front) + (front ? off : -off));
  if (look.acc.bag === 'dos') {
    // largeur de la poche limitée à celle du dos : les bras qui balancent passent à côté
    const back = topSurf.z(0, 1.3, false) - 0.006 - bulk, D = 0.13, HW = Math.min(0.135, 0.75 * topSurf.halfWidth(shoulderY - 0.24)), HH = 0.19;
    const g = new THREE.SphereGeometry(1, 28, 20), pp = g.attributes.position, v = new V();
    for (let i = 0; i < pp.count; i++) { // poche arrondie, face contre le dos presque plate
      v.fromBufferAttribute(pp, i); const se = (c, e) => Math.sign(c) * Math.pow(Math.abs(c), e);
      const z = se(v.z, 0.5) * D / 2;
      pp.setXYZ(i, se(v.x, 0.35) * HW, se(v.y, 0.3) * HH, z > 0 ? z * 0.25 : z);
    }
    g.translate(0, shoulderY - 0.24, back - D * 0.13 - 0.004);
    skinned(ch, info, g, nylon('#262a30'), p => spineWeights(p.y), 'sac-poche');
    for (const s of [-1, 1]) {
      // la bretelle descend devant puis passe sous l'aisselle, collée au torse (le bras balance de part et d'autre)
      const x0 = s * 0.075, tight = 0.003 + bulk, side = topSurf.halfWidth(shoulderY - 0.2) + tight;
      const pts = [on(x0, shoulderY - 0.07, false), new V(x0 + s * 0.008, shoulderY + 0.01, center.z - 0.02), on(x0 + s * 0.02, shoulderY - 0.05, true, tight),
        on(s * 0.1, shoulderY - 0.13, true, tight), on(s * (side - 0.03), shoulderY - 0.19, true, tight), new V(s * side, shoulderY - 0.21, center.z),
        on(s * (side - 0.03), shoulderY - 0.24, false, tight), on(s * 0.11, shoulderY - 0.35, false)];
      skinned(ch, info, ribbon(pts, false, 0.016, 0.0025, center), nylon('#262a30'), p => spineWeights(p.y), 'sac-bretelle');
    }
  }
  // PNJ : on retire les maillages jamais affichés (mémoire, temps de rendu)
  if (look.lod === 'npc') for (const [n, m] of Object.entries(meshes)) if ((n.startsWith('G_') || n.startsWith('H_')) && !m.visible) m.parent.remove(m);
}
