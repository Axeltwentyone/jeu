// Personnages : modèles riggés + animations Mixamo partagées entre squelettes.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { threeModel, localModel } from './assets.js';
import { applyAppearance, randomAppearance } from './appearance.js';

export const SKIN_TONES = ['#3b2418', '#4d2e1f', '#5e3a27', '#71472f', '#86573a', '#a06d4c'];

let BASE = null;
const SHOULDER_DROP = 0.14; // radians (~8°)
const _fwd = new THREE.Vector3(), _axis = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();

/**
 * Retargeting en espace monde : pour chaque os cible, on reproduit la rotation monde de l'os source
 * (corrigée de la différence de pose de repos), puis on "bake" le résultat en clip natif du squelette cible.
 */
function retarget(srcScene, clip, tgtScene, mapName, { fps = 30, inPlace = true } = {}) {
  const Q = THREE.Quaternion, V = THREE.Vector3;
  const src = SkeletonUtils.clone(srcScene), tgt = SkeletonUtils.clone(tgtScene);
  src.updateMatrixWorld(true); tgt.updateMatrixWorld(true);
  const sBones = {}; src.traverse(o => { if (o.isBone) sBones[o.name] = o; });
  const pairs = [];
  tgt.traverse(o => { if (o.isBone && sBones[mapName(o.name)]) pairs.push({ tb: o, sb: sBones[mapName(o.name)] }); });
  // Les poses de repos diffèrent (Ready Player Me est en pose « A », Mixamo/X Bot en pose « T ») :
  // on met d'abord le squelette cible dans la même pose de repos que la source, os par os (parents d'abord),
  // en alignant la direction de chaque os vers son enfant. Sans cela, l'écart de 59° des bras s'ajoute
  // à l'animation et les mains partent derrière le dos.
  const pairOf = new Map(pairs.map(p => [p.tb, p]));
  // os de référence pour la direction : l'enfant dans l'axe du corps (colonne, cou, tête), pas une jambe ni une épaule —
  // sinon le bassin s'aligne sur la cuisse gauche et tout le personnage penche
  const childPair = tb => {
    const kids = tb.children.map(c => pairOf.get(c)).filter(Boolean);
    return kids.find(p => /Spine|Neck|Head/.test(p.tb.name)) || kids[0];
  };
  for (const p of pairs) {
    // seuls les membres sont réalignés (bras en T contre bras en A) : la colonne, le cou et la tête gardent la posture
    // naturelle du modèle — les redresser comme ceux du robot tirait la tête en arrière et bombait la poitrine
    if (!/Shoulder|Arm|Hand|UpLeg|Leg|Foot/.test(p.tb.name)) continue;
    const cp = childPair(p.tb);
    if (!cp) continue;
    const wp = o => o.getWorldPosition(new V());
    const dT = wp(cp.tb).sub(wp(p.tb)), dS = wp(cp.sb).sub(wp(p.sb));
    if (dT.lengthSq() < 1e-8 || dS.lengthSq() < 1e-8) continue;
    const swing = new Q().setFromUnitVectors(dT.normalize(), dS.normalize());
    const newWorld = swing.multiply(p.tb.getWorldQuaternion(new Q()));
    p.tb.quaternion.copy(p.tb.parent.getWorldQuaternion(new Q()).invert().multiply(newWorld));
    p.tb.updateMatrixWorld(true);
  }
  const offset = new Map();
  for (const { tb, sb } of pairs) offset.set(tb, sb.getWorldQuaternion(new Q()).invert().multiply(tb.getWorldQuaternion(new Q())));
  const hips = pairs.find(p => /Hips$/.test(p.tb.name));
  const sHips0 = hips.sb.getWorldPosition(new V()), tHips0 = hips.tb.getWorldPosition(new V());
  const scale = tHips0.y / sHips0.y;
  const tHipsLocal0 = hips.tb.position.clone();
  const hipParentQinv = hips.tb.parent.getWorldQuaternion(new Q()).invert();
  const hipParentS = hips.tb.parent.getWorldScale(new V());
  const restParentQ = new Map(pairs.map(p => [p.tb, p.tb.parent.getWorldQuaternion(new Q())]));

  const mixer = new THREE.AnimationMixer(src);
  mixer.clipAction(clip).play();
  const n = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(n);
  const qv = new Map(pairs.map(p => [p.tb, new Float32Array(n * 4)]));
  const pv = new Float32Array(n * 3);
  const world = new Map(), q = new Q(), v = new V();
  for (let i = 0; i < n; i++) {
    const t = Math.min(clip.duration, i / fps); times[i] = t;
    mixer.setTime(t); src.updateMatrixWorld(true);
    world.clear();
    for (const { tb, sb } of pairs) {
      const desired = sb.getWorldQuaternion(new Q()).multiply(offset.get(tb));
      const parentW = world.get(tb.parent) || restParentQ.get(tb);
      q.copy(parentW).invert().multiply(desired);
      world.set(tb, desired);
      q.toArray(qv.get(tb), i * 4);
    }
    v.copy(hips.sb.getWorldPosition(new V())).sub(sHips0).multiplyScalar(scale);
    if (inPlace) { v.x = 0; v.z = 0; }
    v.applyQuaternion(hipParentQinv).divide(hipParentS).add(tHipsLocal0);
    v.toArray(pv, i * 3);
  }
  const tracks = pairs.map(({ tb }) => new THREE.QuaternionKeyframeTrack(tb.name + '.quaternion', times, qv.get(tb)));
  tracks.push(new THREE.VectorKeyframeTrack(hips.tb.name + '.position', times, pv));
  return new THREE.AnimationClip(clip.name, clip.duration, tracks);
}

export async function loadCharacters() {
  // personnages MakeHuman (tools/blender/build_characters.py) ; animations Mixamo de X Bot, danse de Michelle
  const [mModel, fModel, michelle, xbot] = await Promise.all([localModel('assets/characters/babi_m.glb'), localModel('assets/characters/babi_f.glb'), threeModel('Michelle.glb'), threeModel('Xbot.glb')]);
  const xc = Object.fromEntries(xbot.animations.map(a => [a.name, a]));
  const samba = michelle.animations.find(a => a.name === 'SambaDance');
  const build = tgt => ({
    idle: retarget(xbot.scene, xc.idle, tgt, n => n),
    walk: retarget(xbot.scene, xc.walk, tgt, n => n),
    run: retarget(xbot.scene, xc.run, tgt, n => n),
    agree: retarget(xbot.scene, xc.agree, tgt, n => n),
    no: retarget(xbot.scene, xc.headShake, tgt, n => n),
    dance: retarget(michelle.scene, samba, tgt, n => n, { fps: 24 }),
  });
  BASE = {
    m: { gltf: mModel, meta: mModel.meta, clips: build(mModel.scene), prefix: 'mixamorig' },
    f: { gltf: fModel, meta: fModel.meta, clips: build(fModel.scene), prefix: 'mixamorig' },
  };
  for (const b of Object.values(BASE)) {
    b.walkSpeed = gaitSpeed(b.gltf.scene, b.clips.walk, b.prefix) || 1.3;
    b.runSpeed = gaitSpeed(b.gltf.scene, b.clips.run, b.prefix) || 3.8;
  }
  console.log('[babi] vitesses naturelles', Object.fromEntries(Object.entries(BASE).map(([k, b]) => [k, [b.walkSpeed.toFixed(2), b.runSpeed.toFixed(2)]])));
}

/**
 * Vitesse "naturelle" d'un cycle de marche/course : vitesse horizontale du pied posé au sol.
 * En calant la cadence de l'animation sur la vitesse réelle du personnage, les pieds ne glissent plus.
 */
function gaitSpeed(scene, clip, prefix) {
  const root = SkeletonUtils.clone(scene);
  const mixer = new THREE.AnimationMixer(root); mixer.clipAction(clip).play();
  const feet = ['LeftToeBase', 'RightToeBase'].map(n => root.getObjectByName(prefix + n) || root.getObjectByName(prefix + n.replace('ToeBase', 'Foot')));
  if (feet.some(f => !f)) return null;
  const N = 120, dt = clip.duration / N;
  const samples = [];
  for (let i = 0; i <= N; i++) {
    mixer.setTime(i * dt); root.updateMatrixWorld(true);
    samples.push(feet.map(f => f.getWorldPosition(new THREE.Vector3())));
  }
  let minY = Infinity; for (const s of samples) for (const p of s) minY = Math.min(minY, p.y);
  let sum = 0, n = 0;
  for (let i = 1; i < samples.length; i++) for (let k = 0; k < 2; k++) {
    const a = samples[i - 1][k], b = samples[i][k];
    if (a.y < minY + 0.035 && b.y < minY + 0.035) { sum += Math.hypot(b.x - a.x, b.z - a.z) / dt; n++; }
  }
  return n ? sum / n : null;
}
export function gait(gender, scale = 1) { const b = BASE[gender]; return { walk: b.walkSpeed * scale, run: b.runSpeed * scale }; }
export function getBase(gender) { return BASE[gender]; }

export class Character {
  constructor({ gender = 'm', skin = SKIN_TONES[2], name = '', look = null } = {}) {
    const base = BASE[gender];
    this.gender = gender; this.name = name;
    this.root = new THREE.Group();
    this.model = SkeletonUtils.clone(base.gltf.scene);
    this.root.add(this.model);
    this.prefix = base.prefix;
    this.walkSpeed = base.walkSpeed; this.runSpeed = base.runSpeed;
    this.bones = {};
    this.model.traverse(o => {
      if (o.isBone) this.bones[o.name.replace(base.prefix, '')] = o;
      if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; }
    });
    this.setLook(look || Object.assign(randomAppearance(gender), { skin }));
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = {};
    for (const [k, clip] of Object.entries(base.clips)) {
      const a = this.mixer.clipAction(clip);
      if (k === 'agree' || k === 'no') { a.setLoop(THREE.LoopOnce, 1); a.clampWhenFinished = false; }
      this.actions[k] = a;
    }
    this.mixer.addEventListener('finished', () => { if (this.oneShot) { this.oneShot = null; this.play(this.base || 'idle', 0.3); } });
    this.current = null; this.base = 'idle';
    this.play('idle', 0);
    this.mixer.update(Math.random() * 2);
    this.speed = 0; this.sitting = false; this.sitT = 0;
    this.visible = true;
  }

  /** Apparence complète (visage, corps, coiffure, tenue, accessoires) — voir appearance.js. */
  setLook(look) {
    const base = BASE[this.gender];
    applyAppearance(this, look, base);
    this.walkSpeed = base.walkSpeed * (this.heightScale || 1);
    this.runSpeed = base.runSpeed * (this.heightScale || 1);
  }

  play(name, fade = 0.25) {
    const a = this.actions[name];
    if (!a || this.current === a) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }
  gesture(name) {
    this.oneShot = name;
    this.current?.fadeOut(0.2);
    const a = this.actions[name]; a.reset().fadeIn(0.2).play(); this.current = a;
  }
  setBase(name) { this.base = name; if (!this.oneShot) this.play(name); }

  /** speed en m/s : choisit marche / course et cale la cadence pour limiter le glissement des pieds. */
  update(dt, speed) {
    this.speed = speed;
    if (!this.oneShot && !this.sitting) {
      if (this.base === 'dance') this.play('dance');
      else if (speed > (this.walkSpeed + this.runSpeed) / 2) { this.play('run', 0.22); this.actions.run.timeScale = speed / this.runSpeed; }
      else if (speed > 0.12) { this.play('walk', 0.22); this.actions.walk.timeScale = THREE.MathUtils.clamp(speed / this.walkSpeed, 0.5, 1.6); }
      else this.play('idle', 0.3);
    }
    this.mixer.update(dt);
    this.dropShoulders();
    // pose assise procédurale (pas de clip dédié)
    this.sitT += ((this.sitting ? 1 : 0) - this.sitT) * Math.min(1, dt * 6);
    if (this.sitT > 0.01) {
      const k = this.sitT, B = this.bones;
      for (const s of ['Left', 'Right']) {
        if (B[s + 'UpLeg']) B[s + 'UpLeg'].rotation.x += -1.5 * k;
        if (B[s + 'Leg']) B[s + 'Leg'].rotation.x += 1.55 * k;
        if (B[s + 'Foot']) B[s + 'Foot'].rotation.x += -0.1 * k;
      }
      if (B.Spine) B.Spine.rotation.x += 0.08 * k;
      this.model.position.y = -0.47 * k * (this.heightScale || 1);
    } else this.model.position.y = 0;
  }

  /** Les clavicules de l'animation source (X Bot) sont hautes : on les abaisse autour de l'axe avant du personnage. */
  dropShoulders() {
    const fwd = _fwd.set(0, 0, 1).applyQuaternion(this.root.getWorldQuaternion(_q1));
    for (const [side, sign] of [['Left', -1], ['Right', 1]]) {
      const b = this.bones[side + 'Shoulder']; if (!b) continue;
      const axis = _axis.copy(fwd).applyQuaternion(b.parent.getWorldQuaternion(_q2).invert());
      b.quaternion.premultiply(_q3.setFromAxisAngle(axis, sign * SHOULDER_DROP));
    }
  }

  get position() { return this.root.position; }
}
