// Écran de création / modification du personnage, avec aperçu 3D (rotation 360°, zoom, vues visage/buste/entier).
// Le personnage affiché est un vrai Character avec applyAppearance() : c'est exactement celui qui apparaît dans le monde.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { Character } from './characters.js';
import {
  SKIN_TONES, HAIR_COLORS, HAIR_STYLES, BEARDS, CLOTHES, ACCESSORIES, FACE_SLIDERS, BODY_SLIDERS, COLORS,
  defaultAppearance, randomAppearance, SKINS, applySkin, clothesFor,
} from './appearance.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clone = o => JSON.parse(JSON.stringify(o));
const fmt = n => n.toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA';

const VIEWS = { full: { y: 0.95, d: 4.6 }, bust: { y: 1.42, d: 2.1 }, face: { y: 1.66, d: 1.35 } };

export class Creator {
  constructor(renderer, hooks) {
    this.renderer = renderer; this.hooks = hooks; this.active = false;
    const scene = this.scene = new THREE.Scene();
    // fond studio dégradé
    const cv = document.createElement('canvas'); cv.width = 16; cv.height = 256; const g = cv.getContext('2d');
    const grd = g.createLinearGradient(0, 0, 0, 256); grd.addColorStop(0, '#2b2622'); grd.addColorStop(0.6, '#16130f'); grd.addColorStop(1, '#0b0a09');
    g.fillStyle = grd; g.fillRect(0, 0, 16, 256);
    const bg = new THREE.CanvasTexture(cv); bg.colorSpace = THREE.SRGBColorSpace; scene.background = bg;
    const pm = new THREE.PMREMGenerator(renderer);
    scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.55;
    const key = new THREE.DirectionalLight('#fff1e0', 2.6); key.position.set(2.2, 3.5, 3); key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024); Object.assign(key.shadow.camera, { left: -1.5, right: 1.5, top: 2.5, bottom: -0.5, near: 0.5, far: 10 }); key.shadow.bias = -0.0005;
    const rim = new THREE.DirectionalLight('#9fc4ff', 1.8); rim.position.set(-2.5, 2.5, -2.5);
    const fill = new THREE.DirectionalLight('#ffd9b0', 0.6); fill.position.set(-3, 1.2, 2);
    scene.add(key, key.target, rim, fill);
    const floor = new THREE.Mesh(new THREE.CircleGeometry(1.6, 64), new THREE.MeshStandardMaterial({ color: '#2a2622', roughness: 0.6, metalness: 0.1 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.58, 1.62, 64), new THREE.MeshBasicMaterial({ color: '#f08a24' }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring);
    this.camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.05, 50);
    this.view = 'full'; this.cam = { y: 0.95, d: 4.4, zoom: 1 };
    this.yaw = 0.35;
    this.bindUI();
  }

  /* ---------- ouverture ---------- */
  open(mode, look, identity = {}) {
    this.mode = mode;
    this.look = clone(look || defaultAppearance('m'));
    this.identity = { first: identity.first || '', last: identity.last || '' };
    this.tab = mode === 'new' ? 'identite' : 'cheveux';
    this.active = true;
    $('creator').hidden = false;
    $('crTitle').textContent = mode === 'new' ? 'Crée ton personnage' : 'Ton apparence';
    $('crSub').textContent = mode === 'new' ? 'Étudiant·e à l\'université, Abidjan 2026' : 'Coiffure, tenue et accessoires — changements gratuits';
    $('crBack').textContent = mode === 'new' ? 'Retour' : 'Annuler';
    this.rebuild();
    this.renderTabs(); this.renderBody();
    this.savedExposure = this.renderer.toneMappingExposure;
  }
  close() {
    this.active = false; $('creator').hidden = true;
    if (this.ch) { this.scene.remove(this.ch.root); this.ch = null; }
    this.renderer.toneMappingExposure = this.savedExposure ?? this.renderer.toneMappingExposure;
  }

  rebuild() {
    if (this.ch) this.scene.remove(this.ch.root);
    this.ch = new Character({ gender: this.look.gender, look: this.look, name: this.identity.first });
    this.ch.root.rotation.y = this.yaw;
    this.scene.add(this.ch.root);
  }
  apply() {
    // regroupe les changements rapides (curseurs) en une seule mise à jour par image
    if (this.pending) return;
    this.pending = true;
    requestAnimationFrame(() => { this.pending = false; if (this.ch) this.ch.setLook(this.look); });
  }

  /* ---------- interface ---------- */
  tabs() {
    const all = [['identite', 'Identité'], ['visage', 'Visage'], ['cheveux', 'Cheveux'], ['corps', 'Corps'], ['tenue', 'Tenue'], ['accessoires', 'Accessoires']];
    return this.mode === 'new' ? all : all.filter(t => ['cheveux', 'tenue', 'accessoires'].includes(t[0]));
  }
  renderTabs() {
    $('crTabs').innerHTML = this.tabs().map(([id, n]) => `<button data-t="${id}" class="${id === this.tab ? 'on' : ''}">${n}</button>`).join('');
    $('crTabs').querySelectorAll('button').forEach(b => b.onclick = () => {
      this.tab = b.dataset.t; this.hooks.sound('click'); this.renderTabs(); this.renderBody();
      this.setView(this.tab === 'visage' || this.tab === 'cheveux' ? 'face' : this.tab === 'accessoires' ? 'bust' : 'full');
    });
  }
  available(item) { return this.mode === 'new' ? item.starter : (item.starter || this.look.owned.includes(item.id)); }

  renderBody() {
    const L = this.look, el = $('crBody');
    const sw = (key, list, cur) => `<div class="swatches">${list.map((c, i) => `<div class="sw${c === cur ? ' on' : ''}" data-k="${key}" data-v="${c}" style="background:${c}"></div>`).join('')}</div>`;
    const opts = (key, list, cur, gate = false) => `<div class="cr-opts">${list.map(o => { const ok = !gate || this.available(o); return `<button data-k="${key}" data-v="${o.id}" class="${o.id === cur ? 'on' : ''}" ${ok ? '' : 'disabled'} title="${ok ? '' : 'À acheter à l\'atelier Élégance'}">${esc(o.name)}${ok ? '' : `<small>${fmt(o.price)}</small>`}</button>`; }).join('')}</div>`;
    const slider = (key, label, v) => `<label class="cr-sl"><span>${label}</span><input type="range" min="-1" max="1" step="0.05" value="${v}" data-k="${key}"></label>`;
    let h = '';
    if (this.tab === 'identite') {
      h += `<div class="field"><label>Prénom</label><input id="crFirst" maxlength="16" value="${esc(this.identity.first)}" placeholder="Ex. Aya, Koffi, Salif…"></div>`;
      h += `<div class="field"><label>Nom</label><input id="crLast" maxlength="20" value="${esc(this.identity.last)}" placeholder="Ex. Kouassi, Traoré, Bamba…"></div>`;
      h += `<div class="field"><label>Sexe</label><div class="seg"><button data-k="gender" data-v="m" class="${L.gender === 'm' ? 'on' : ''}">Homme</button><button data-k="gender" data-v="f" class="${L.gender === 'f' ? 'on' : ''}">Femme</button></div></div>`;
      h += `<div class="field"><label>Teint</label>${sw('skin', SKIN_TONES, L.skin)}</div>`;
    }
    if (this.tab === 'visage') h += `<p class="hint">Les curseurs déforment le visage 3D (formes MakeHuman).</p>` + FACE_SLIDERS.map(([k, n]) => slider('face.' + k, n, L.face[k])).join('');
    if (this.tab === 'corps') h += `<p class="hint">La corpulence modifie le corps et les vêtements ; taille, carrure et jambes agissent sur le squelette.</p>` + BODY_SLIDERS.map(([k, n]) => slider('body.' + k, n, L.body[k])).join('');
    if (this.tab === 'cheveux') {
      h += `<div class="field"><label>Coiffure</label>${opts('hair.style', HAIR_STYLES[L.gender], L.hair.style)}</div>`;
      h += `<div class="field"><label>Couleur</label><div class="cr-opts">${HAIR_COLORS.map(c => `<button data-k="hair.color" data-v="${c.id}" class="${c.id === L.hair.color ? 'on' : ''}"><i class="dot" style="background:${c.c}"></i>${c.name}</button>`).join('')}</div></div>`;
      if (BEARDS.length && L.gender === 'm') h += `<div class="field"><label>Barbe et moustache</label>${opts('beard', BEARDS, L.beard)}</div>`;
    }
    if (this.tab === 'tenue') {
      h += `<div class="field"><label>Styles complets</label><div class="cr-skins">${SKINS.map(k => `<button data-skin="${k.id}" class="${L.skin_id === k.id ? 'on' : ''}"><b>${k.name}</b><small>${k.desc}</small></button>`).join('')}</div></div>`;
      h += `<div class="field"><label>Haut</label>${opts('top.style', clothesFor('top', L.gender), L.top.style, true)}</div>`;
      const topIt = clothesFor('top', L.gender).find(t => t.id === L.top.style);
      if (topIt && topIt.tint) h += `<div class="field"><label>Couleur du haut</label>${sw('top.color', COLORS, L.top.color)}</div>`;
      if (!topIt || !topIt.full) h += `<div class="field"><label>Bas</label>${opts('bottom.style', clothesFor('bottom', L.gender), L.bottom.style, true)}</div>`;
      h += `<div class="field"><label>Chaussures</label>${opts('shoes.style', clothesFor('shoes', L.gender), L.shoes.style, true)}</div>`;
      h += `<p class="hint">Les articles grisés s'achètent à l'atelier Élégance, rue de la Lagune.</p>`;
    }
    if (this.tab === 'accessoires') {
      h += `<div class="field"><label>Lunettes</label>${opts('acc.glasses', ACCESSORIES.glasses, L.acc.glasses, true)}</div>`;
      h += `<div class="field"><label>Montre</label>${opts('acc.watch', ACCESSORIES.watch, L.acc.watch, true)}</div>`;
      h += `<div class="field"><label>Bijoux</label>${opts('acc.jewel', ACCESSORIES.jewel, L.acc.jewel, true)}</div>`;
      h += `<div class="field"><label>Sac</label>${opts('acc.bag', ACCESSORIES.bag, L.acc.bag, true)}</div>`;
      h += `<div class="field"><label>Chapeau</label>${opts('acc.hat', ACCESSORIES.hat, L.acc.hat, true)}</div>`;
    }
    el.innerHTML = h;
    el.querySelectorAll('[data-skin]').forEach(b => b.onclick = () => { applySkin(this.look, b.dataset.skin); this.hooks.sound('click'); this.ch.setLook(this.look); this.renderBody(); this.setView('full'); });
    el.querySelectorAll('[data-k]').forEach(c => {
      const ev = c.tagName === 'INPUT' ? 'input' : 'click';
      c.addEventListener(ev, () => this.change(c.dataset.k, c.tagName === 'INPUT' ? +c.value : c.dataset.v));
    });
    const f = $('crFirst'), l = $('crLast');
    if (f) f.oninput = () => { this.identity.first = f.value; };
    if (l) l.oninput = () => { this.identity.last = l.value; };
  }

  change(key, val) {
    const L = this.look;
    if (key === 'gender') {
      if (val === L.gender) return;
      const keep = { skin: L.skin, owned: L.owned };
      this.look = Object.assign(defaultAppearance(val), keep);
      this.hooks.sound('click'); this.rebuild(); this.renderBody(); return;
    }
    const [a, b] = key.split('.');
    if (b) L[a][b] = val; else L[a] = val;
    if (typeof val !== 'number') { this.hooks.sound('click'); this.renderBody(); }
    this.apply();
  }

  bindUI() {
    $('crRandom').onclick = () => {
      const g = this.look.gender, owned = this.look.owned;
      const r = randomAppearance(g);
      const ok = (cat, list, v) => (list.find(i => i.id === v) && this.available(list.find(i => i.id === v))) ? v : list.find(i => this.available(i)).id;
      r.top.style = ok('top', clothesFor('top', g), r.top.style); r.bottom.style = ok('b', clothesFor('bottom', g), r.bottom.style); r.shoes.style = ok('s', clothesFor('shoes', g), r.shoes.style);
      for (const k of Object.keys(r.acc)) r.acc[k] = ok(k, ACCESSORIES[k], r.acc[k]);
      if (this.mode !== 'new') { r.face = this.look.face; r.body = this.look.body; r.skin = this.look.skin; }
      r.owned = owned; this.look = r;
      this.hooks.sound('click'); this.ch.setLook(this.look); this.renderBody();
    };
    $('crBack').onclick = () => { this.hooks.sound('click'); this.close(); this.hooks.onCancel(this.mode); };
    $('crOk').onclick = () => {
      if (this.mode === 'new' && !this.identity.first.trim()) { this.tab = 'identite'; this.renderTabs(); this.renderBody(); $('crFirst').focus(); $('crFirst').classList.add('err'); return; }
      this.hooks.sound('objective');
      const look = clone(this.look), id = { first: this.identity.first.trim(), last: this.identity.last.trim() };
      this.close(); this.hooks.onConfirm(look, id, this.mode);
    };
    document.querySelectorAll('#crViews button[data-v]').forEach(b => b.onclick = () => this.setView(b.dataset.v));
    // aperçu de l'animation (vérifier que les vêtements suivent la marche et la course)
    this.anim = 0;
    document.querySelectorAll('#crViews button[data-a]').forEach(b => b.onclick = () => {
      this.anim = +b.dataset.a;
      document.querySelectorAll('#crViews button[data-a]').forEach(x => x.classList.toggle('on', x === b));
    });
    // rotation 360° et zoom
    const cvs = this.renderer.domElement;
    let drag = null;
    cvs.addEventListener('pointerdown', e => { if (this.active) drag = { x: e.clientX }; });
    addEventListener('pointerup', () => { drag = null; });
    cvs.addEventListener('pointermove', e => { if (this.active && drag) { this.yaw += (e.clientX - drag.x) * 0.012; drag.x = e.clientX; } });
    cvs.addEventListener('wheel', e => { if (this.active) this.cam.zoom = THREE.MathUtils.clamp(this.cam.zoom + e.deltaY * 0.001, 0.45, 1.6); }, { passive: true });
    $('crRotL').onclick = () => { this.yaw -= Math.PI / 4; };
    $('crRotR').onclick = () => { this.yaw += Math.PI / 4; };
  }
  setView(v) {
    this.view = v; this.cam.zoom = 1;
    document.querySelectorAll('#crViews button[data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  }

  render(dt) {
    if (!this.ch) return;
    const hs = this.ch.heightScale || 1, V = VIEWS[this.view];
    // cadrage sur la tête réelle (les modèles n'ont pas la même taille)
    const headY = this.ch.bones.Head ? this.ch.bones.Head.getWorldPosition(new THREE.Vector3()).y + 0.08 : 1.6 * hs;
    const ty = this.view === 'face' ? headY : this.view === 'bust' ? headY - 0.28 : headY * 0.55;
    this.cam.y += (ty - this.cam.y) * Math.min(1, dt * 6);
    this.cam.d += (V.d * this.cam.zoom - this.cam.d) * Math.min(1, dt * 6);
    this.ch.root.rotation.y += (this.yaw - this.ch.root.rotation.y) * Math.min(1, dt * 8);
    this.ch.update(dt, this.anim === 2 ? this.ch.runSpeed : this.anim === 1 ? this.ch.walkSpeed : 0);
    // centre le personnage dans la zone libre (à droite du panneau, ou au-dessus sur mobile)
    const W = innerWidth, Hh = innerHeight, narrow = W <= 800;
    const panel = document.querySelector('.cr-panel').getBoundingClientRect();
    this.camera.aspect = W / Hh;
    if (narrow) this.camera.setViewOffset(W, Hh, 0, panel.height / 2, W, Hh);
    else this.camera.setViewOffset(W, Hh, -panel.width / 2, 0, W, Hh);
    this.camera.position.set(0, this.cam.y + 0.05, this.cam.d);
    this.camera.lookAt(0, this.cam.y, 0);
    this.renderer.toneMappingExposure = 0.95;
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }
}
