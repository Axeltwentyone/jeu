// Outil de développement : détecte les accessoires qui traversent le corps.
// Bras et jambes approchés par des capsules (rayon mesuré sur le corps au repos) ; on compte, pour chaque accessoire,
// les sommets qui entrent dans une capsule sur 16 phases de repos / marche / course.
// Usage dans la console du jeu, éditeur de personnage ouvert :
//   const { clipTest } = await import('/tools/cliptest.js'); await clipTest(babi.creator, { 'acc.bag': 'dos' })
import * as THREE from 'three';
import { getBase } from '/src/characters.js';

const V = THREE.Vector3;
const dist = (p, A, B) => { const ab = B.clone().sub(A), t = Math.max(0, Math.min(1, p.clone().sub(A).dot(ab) / ab.lengthSq())); return p.distanceTo(A.clone().addScaledVector(ab, t)); };

export async function clipTest(creator, patch = {}, { skip = /watch/ } = {}) {
  const ch = creator.ch, L = creator.look;
  for (const [k, v] of Object.entries(patch)) { const [a, b] = k.split('.'); if (b) L[a][b] = v; else L[a] = v; }
  ch.setLook(L);
  const B = ch.bones, segs = [];
  for (const s of ['Left', 'Right']) segs.push([s + 'Arm', s + 'ForeArm'], [s + 'ForeArm', s + 'Hand'], [s + 'Hand', null], [s + 'UpLeg', s + 'Leg'], [s + 'Leg', s + 'Foot']);
  const ends = (a, b, bp) => [bp(a), b ? bp(b) : bp(a).clone().add(bp(a).clone().sub(bp(a.replace('Hand', 'ForeArm'))).setLength(0.09))];
  // rayons : 80e centile de la distance des sommets du corps au segment, au repos
  const sc = getBase(ch.gender).gltf.scene; sc.updateMatrixWorld(true);
  let body; sc.traverse(o => { if (o.isSkinnedMesh && o.name === 'Body') body = o; }); body.skeleton.update();
  const P = body.geometry.attributes.position, pts = [], v = new V();
  for (let i = 0; i < P.count; i += 2) { v.fromBufferAttribute(P, i); body.applyBoneTransform(i, v); pts.push(v.clone().applyMatrix4(body.matrixWorld)); }
  const restBp = n => sc.getObjectByName('mixamorig' + n).getWorldPosition(new V());
  const radii = segs.map(([a, b]) => { const [A, E] = ends(a, b, restBp); const d = pts.map(p => dist(p, A, E)).filter(x => x < 0.09).sort((x, y) => x - y); return d[Math.floor(d.length * 0.8)] || 0.04; });
  const res = {}, upd = ch.update; ch.update = () => {};
  for (const anim of ['idle', 'walk', 'run']) {
    const a = ch.actions[anim]; ch.mixer.stopAllAction(); a.reset().play(); a.setEffectiveWeight(1);
    for (let k = 0; k < 16; k++) {
      a.time = k / 16 * a._clip.duration; ch.mixer.update(0); ch.root.updateMatrixWorld(true);
      const S = segs.map(([x, y]) => ends(x, y, n => B[n].getWorldPosition(new V()))), sh = ch.model.scale.x;
      for (const o of ch.attached) o.traverse(m => {
        if (!m.isMesh) return;
        const tag = (o.userData.acc || 'accessoire'); if (skip && skip.test(tag)) return;
        const g = m.geometry.attributes.position;
        for (let i = 0; i < g.count; i += 2) {
          v.fromBufferAttribute(g, i); if (m.isSkinnedMesh) m.applyBoneTransform(i, v); v.applyMatrix4(m.matrixWorld);
          S.forEach(([A, E], j) => { if (dist(v, A, E) < radii[j] * sh * 0.9) { const key = tag + ' → ' + segs[j][0]; res[key] = res[key] || {}; res[key][anim] = (res[key][anim] || 0) + 1; } });
        }
      });
    }
  }
  ch.mixer.stopAllAction(); ch.current = null; ch.play('idle', 0); ch.update = upd;
  return res;
}
