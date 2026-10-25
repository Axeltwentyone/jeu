import * as THREE from 'three';
import { createRenderer, Environment, Post, QUALITY } from './env.js';
import { onProgress, setMaxAnisotropy } from './assets.js';
import { buildWorld, world, blocked, heightAt, segHitsBox } from './world.js';
import { loadCharacters } from './characters.js';
import { Creator } from './creator.js';
import { defaultAppearance } from './appearance.js';
import { Game, OBJECTIVES, fmt, hourOf, dayOf, clockOf, newState, stepToward, WORO_PRICE } from './game.js';
import { loadGame, clearGame } from './save.js';
import { Phone } from './phone.js';
import { Editor } from './editor.js';
import { Traffic } from './vehicles.js';
import { paintedSign } from './proctex.js';
import { Ambience } from './audio.js';
import { windUniform } from './vegetation.js';

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isTouch = matchMedia('(pointer: coarse)').matches;

/* ================= Moteur ================= */
const renderer = createRenderer($('game'));
renderer.info.autoReset = false;
setMaxAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 6000);
camera.position.set(0, 3, 10);
const env = new Environment(renderer, scene, camera);
const post = new Post(renderer, scene, camera);
const audio = new Ambience();
let traffic = null;
const lightPool = [];

/** Qualité par défaut selon le GPU : Haute sur GPU dédié / Apple Silicon, Moyenne sur graphique intégré, Basse sur mobile. */
function defaultQuality() {
  if (isTouch) return 'low';
  try {
    const gl = renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : '';
    if (/Apple M\d|NVIDIA|GeForce|RTX|Radeon RX|Radeon Pro/i.test(gpu)) return 'high';
    return 'medium';
  } catch { return 'medium'; }
}
let qKey = localStorage.getItem('babi-quality') || defaultQuality();
let Q = QUALITY[qKey];
function applyQuality(key) {
  qKey = key; Q = QUALITY[key];
  localStorage.setItem('babi-quality', key);
  renderer.setPixelRatio(Math.min(devicePixelRatio * Q.pr, Q.prMax));
  renderer.shadowMap.type = Q.soft ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
  env.sun.shadow.mapSize.set(Q.shadow, Q.shadow);
  if (env.sun.shadow.map) { env.sun.shadow.map.dispose(); env.sun.shadow.map = null; }
  scene.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); });
  if (world.makeWater) world.makeWater(Q.water);
  if (game.state) setAreaVisibility(world.area);
  for (const g of world.grass) g.count = Math.floor(g.userData.maxCount * Math.min(1, Q.grass / 1.4));
  post.build(Q);
  document.querySelectorAll('#qSeg button').forEach(b => b.classList.toggle('on', b.dataset.q === key));
  $('qHint').textContent = Q.hint;
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  clearTimeout(window.__rs); window.__rs = setTimeout(() => post.build(Q), 150);
});

/* ================= Interface ================= */
let menuCtx = null;
const ui = {
  toast(msg, kind = '') {
    const t = document.createElement('div'); t.className = 'toast ' + kind; t.textContent = msg;
    $('toasts').appendChild(t); setTimeout(() => t.remove(), 4200);
    while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
  },
  labels: [],
  label(obj, html, cls, ttl, offset = 2.05) {
    const el = document.createElement('div'); el.className = 'lbl ' + cls; el.innerHTML = html;
    $('labels').appendChild(el);
    const l = { obj, el, ttl, life: ttl, offset }; this.labels.push(l); return l;
  },
  say(npc, text, ttl = 4.5) { if (npc.bubble) npc.bubble.life = 0; npc.bubble = this.label(npc.ch.root, esc(text), 'say', ttl, 2.25); },
  gain(obj, text) { this.label(obj, text, 'gain', 2.2, 2.1); },
  beginProgress(label) { $('progress').hidden = false; $('pgLabel').textContent = label + '…'; $('pgFill').style.width = '0%'; },
  progress(f) { $('pgFill').style.width = (f * 100).toFixed(1) + '%'; },
  endProgress() { $('progress').hidden = true; this.unfade(); },
  fade(html, ms, cb) {
    $('fadeTxt').innerHTML = html; $('fade').classList.add('on');
    if (ms) setTimeout(() => { cb && cb(); setTimeout(() => this.unfade(), 250); }, ms);
  },
  unfade() { $('fade').classList.remove('on'); },
  sound(n) { audio.play(n); },
  notify() { this.sound('click'); badge(); },
  closeAll() { closeMenu(); phone.toggle(false); },
  refreshMenu() { renderAgain(); },
  victory(s) { showVictory(s); },
  onAreaChange(area) {
    closeMenu();
    cam.curDist = Math.min(cam.curDist, area === 'outside' ? cam.dist : 3);
    cam.pitch = area === 'outside' ? 0.28 : 0.6;
    cam.yaw = game.player.root.rotation.y + Math.PI;
    cam.target.copy(game.player.root.position).add(new THREE.Vector3(0, 1.55, 0));
    setAreaVisibility(area);
  },
};

function closeMenu() { $('actionMenu').hidden = true; menuCtx = null; }
$('amClose').onclick = () => { ui.sound('click'); closeMenu(); };
function durTxt(m) { if (!m) return ''; if (m < 60) return `${Math.round(m)} min`; const h = m / 60; return (Math.round(h * 10) / 10).toString().replace('.', ',') + ' h'; }

/** Menu générique : liste d'options cliquables. */
function renderMenu(title, sub, items, ctx) {
  menuCtx = ctx;
  $('amTitle').textContent = title; $('amSub').innerHTML = sub;
  const list = $('amList'); list.innerHTML = '';
  for (const it of items) {
    const b = document.createElement('button'); b.className = 'act';
    const why = it.why ?? (it.action ? game.blockReason(it.action) : null);
    const a = it.action || {};
    const subTxt = why || it.d || [a.d, durTxt(a.minutes)].filter(Boolean).join(' · ');
    const price = it.pay ? `<span class="p gain">+${fmt(it.pay)}</span>` : a.price ? `<span class="p">${fmt(a.price)}</span>` : it.price ? `<span class="p">${fmt(it.price)}</span>` : '';
    b.innerHTML = `<div><div class="l">${esc(it.l)}</div><div class="s">${esc(subTxt || '')}</div></div>${price}`;
    b.disabled = !!why;
    b.onclick = () => { ui.sound('click'); it.run(); };
    list.appendChild(b);
  }
  $('actionMenu').hidden = false;
}
function renderAgain() {
  if (!menuCtx) return;
  if (menuCtx.place) openPlaceMenu(menuCtx.place);
  else if (menuCtx.npc) openNpc(menuCtx.npc);
}

const PLACES = {
  bed: ['Ton lit', 'Un bon sommeil remet d\'aplomb.'],
  stove: ['Coin cuisine', 'Réchaud à gaz, marmite et riz.'],
  shower: ['Salle d\'eau', 'Douche et lavabo.'],
  tv: ['Télévision', 'Le journal de 20h, les matchs, les séries.'],
  wardrobe: ['Ton armoire', 'Tes vêtements.'],
  rentTable: ['Avis de loyer', 'Studio de la Cour Kouassi — 30 000 FCFA par semaine.'],
  maquis: ["Maquis Le Jardin d'Awa", 'Tantie Awa : « Assieds-toi, on va bien te servir ! »'],
  maquisSeat: ["Maquis Le Jardin d'Awa", 'Les chaises monobloc et le ventilo t\'attendent.'],
  boutique: ['Alimentation Chez Moussa', 'Moussa : « Mon ami, qu\'est-ce qu\'il te faut ? »'],
  etal: ["L'étal de Maman Adjoua", 'Fruits et légumes du marché.'],
  atelier: ['Atelier Élégance', 'Prêt-à-porter et sur-mesure. Tantie Rose habille tout le quartier.'],
  coffee: ['Coin café', 'La machine de Babi Digital.'],
  bench: ['Bord de lagune', 'La brise de la lagune Ébrié et le Plateau au loin.'],
  pier: ['Le ponton', 'Les pêcheurs y amarrent leurs pirogues.'],
  alouer: ['Local à louer', 'Une trentaine de m² sur la rue : parfait pour un maquis…'],
};
function openPlaceMenu(id) {
  const [t, s] = PLACES[id] || [id, ''];
  const acts = game.actionsFor(id);
  renderMenu(t, esc(s), acts.map(a => ({ l: a.l, action: a, run: () => game.run(a, { place: id }) })), { place: id });
}
function openWoro(id) {
  const dests = game.destinations().filter(d => !(id === 'cour' && d.id === 'home') && !(id === 'bureau' && d.id === 'office'));
  renderMenu('Woro-woro', 'Taxi collectif : le chauffeur part dès que la voiture est pleine.', dests.map(d => ({ l: d.name, d: '≈ 12 min', price: WORO_PRICE, why: game.state.money < WORO_PRICE ? 'Solde insuffisant' : null, run: () => game.travel(d, 'woro') })), { woro: id });
}
function openNpc(npc) {
  const { text, opts } = game.dialog(npc);
  faceEachOther(npc);
  const d = npc.def;
  const items = opts.map(o => ({
    l: o.l, d: o.d, pay: o.pay,
    run: () => {
      if (o.interview) return interview(npc, 0, 0);
      if (o.accept) { game.acceptMission(o.accept); closeMenu(); return; }
      if (o.validate) { game.validateMission(); closeMenu(); return; }
      if (o.openPlace) return openPlaceMenu(o.openPlace);
    },
  }));
  items.push({ l: 'Au revoir', run: () => closeMenu() });
  renderMenu(d.name + (d.title ? ` — ${d.title}` : ''), `<div class="dlg">« ${esc(text)} »</div>`, items, { npc });
  if (!npc.seat) npc.ch.gesture('agree');
}
const QUESTIONS = [
  { q: 'Pour commencer : quelle balise HTML crée un lien vers une autre page ?', a: ['<a href="…">', '<link>', '<href>'], ok: 0 },
  { q: 'Et en JavaScript, que renvoie [1, 2, 3].length ?', a: ['2', '3', '4'], ok: 1 },
];
function interview(npc, i, score) {
  if (i >= QUESTIONS.length) { closeMenu(); game.interviewAnswer(score === QUESTIONS.length); npc.ch.gesture('agree'); return; }
  const q = QUESTIONS[i];
  renderMenu('Entretien — Mme Kouamé', `<div class="dlg">« ${esc(q.q)} »</div>`, q.a.map((a, k) => ({ l: a, run: () => { if (k !== q.ok) npc.ch.gesture('no'); interview(npc, i + 1, score + (k === q.ok ? 1 : 0)); } })), { interview: true });
}
function faceEachOther(npc) {
  const a = game.player.root.position, b = npc.ch.root.position;
  if (!npc.seat) npc.ch.root.rotation.y = Math.atan2(a.x - b.x, a.z - b.z);
  game.player.root.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  npc.talking = 30;
}

/* ---- HUD ---- */
function needColor(v) { return v > 50 ? '#4fbf74' : v > 25 ? '#e9b23c' : '#e2513f'; }
function badge() { const n = game.state ? game.state.messages.filter(m => !m.read).length : 0; $('phoneBadge').hidden = !n; $('phoneBadge').textContent = n; }
function updateHUD() {
  const s = game.state;
  $('hClock').textContent = clockOf(s.minutes);
  $('hDay').textContent = `Jour ${dayOf(s.minutes)}`;
  $('hWhere').textContent = world.area === 'outside' ? 'Marcory · rue de la Lagune' : world.areas[world.area].name;
  $('hMoney').textContent = fmt(s.money);
  $('hEnergy').style.width = s.needs.energie + '%'; $('hEnergy').style.background = needColor(s.needs.energie);
  $('hFood').style.width = s.needs.faim + '%'; $('hFood').style.background = needColor(s.needs.faim);
  const o = s.obj < OBJECTIVES.length ? OBJECTIVES[s.obj] : { t: 'Profite de ta vie à Marcory', d: 'Enchaîne les missions chez Babi Digital, garde la forme, fais-toi plaisir.' };
  $('objTitle').textContent = o.t; $('objDesc').textContent = o.d;
  badge();
}

/* ================= Entrées ================= */
const keys = {};
addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  keys[e.code] = true;
  if (!game.state || $('hud').hidden) return;
  if (e.code === 'Escape') {
    if (editor.open) editor.close();
    else if (phone.open) phone.toggle(false);
    else if (!$('actionMenu').hidden) closeMenu();
    else togglePause();
    return;
  }
  if (paused) return;
  if (e.code === 'KeyT' && !editor.open) { closeMenu(); phone.toggle(); }
  if (e.code === 'KeyE' && !editor.open && !phone.open) interact();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
addEventListener('beforeunload', () => { if (game.state) game.save(); });

const cam = { yaw: Math.PI, pitch: 0.28, dist: 4.6, target: new THREE.Vector3(), curDist: 4.6 };
let drag = null, goal = null, joy = { x: 0, y: 0 }, touchRun = false;
const canvas = renderer.domElement;
canvas.addEventListener('contextmenu', e => e.preventDefault());
canvas.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0, id: e.pointerId, btn: e.button }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
  drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
  if (drag.moved > 5) { cam.yaw -= dx * 0.0055; cam.pitch = clamp(cam.pitch + dy * 0.0042, 0.02, 1.2); }
});
canvas.addEventListener('pointerup', e => {
  if (!drag || drag.id !== e.pointerId) return;
  const click = drag.moved <= 5 && drag.btn === 0; drag = null;
  if (click && game.state && !game.action && !$('hud').hidden && !editor.open) clickTo(e.clientX, e.clientY);
});
canvas.addEventListener('wheel', e => { cam.dist = clamp(cam.dist + e.deltaY * 0.004, 1.8, 12); }, { passive: true });

const ray = new THREE.Raycaster(), v3 = new THREE.Vector3();
function toScreen(p, out = new THREE.Vector2()) { v3.copy(p).project(camera); return out.set((v3.x * 0.5 + 0.5) * innerWidth, (-v3.y * 0.5 + 0.5) * innerHeight); }
function clickTo(x, y) {
  closeMenu();
  ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  const p = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -game.player.root.position.y), new THREE.Vector3());
  if (p && p.distanceTo(game.player.root.position) < 40) goal = { pos: p };
}

/* ---- interactions : une seule action pertinente, selon distance, orientation et visibilité ---- */
function hotspotLabel(id, h) {
  const s = game.state, m = s.mission;
  switch (id) {
    case 'workDesk': return !m ? 'Ton poste (aucune mission en cours)' : m.stage === 'done' ? 'Mission envoyée — va voir Yannick' : m.stage === 'accepted' ? 'Commencer à travailler' : 'Reprendre la mission';
    case 'officeDoor': { const hr = hourOf(s.minutes); return hr >= 7 && hr < 20 ? 'Entrer dans l\'entreprise' : 'Babi Digital — fermé (7h–20h)'; }
    case 'maquis': return 'Commander au maquis';
    case 'boutique': return 'Acheter chez Moussa';
    case 'atelier': return 'Acheter des vêtements';
    case 'etal': return 'Acheter à l\'étal';
    case 'rentTable': return 'Payer le loyer';
    case 'coffee': return 'Prendre un café';
    default: return h.label;
  }
}
function lineOfSight(a, b) {
  for (const c of world.colliders) {
    if (!c.h || c.h < 1.2) continue;
    if (b.x > c.x0 - 0.05 && b.x < c.x1 + 0.05 && b.z > c.z0 - 0.05 && b.z < c.z1 + 0.05) continue;
    if (segHitsBox(a.x, a.z, b.x, b.z, c, 0)) return false;
  }
  return true;
}
function nearestInteractable() {
  const p = game.player.root, pp = p.position;
  const fwd = new THREE.Vector2(Math.sin(p.rotation.y), Math.cos(p.rotation.y));
  let best = null, bs = Infinity;
  const consider = (pos, r, payload) => {
    const dx = pos.x - pp.x, dz = pos.z - pp.z, d = Math.hypot(dx, dz);
    if (d > r) return;
    const dot = d > 0.01 ? (dx * fwd.x + dz * fwd.y) / d : 1;
    if (d > 0.8 && dot < -0.2) return;
    if (!lineOfSight(pp, pos)) return;
    const score = d * (1.6 - dot * 0.6);
    if (score < bs) { bs = score; best = payload; }
  };
  for (const [id, h] of Object.entries(world.hotspots)) {
    if ((h.area || 'outside') !== world.area) continue;
    if (id === 'maquisSeat') continue;
    consider(h.pos, h.r, { id, h, label: hotspotLabel(id, h) });
  }
  for (const npc of game.npcs) {
    if (!npc.ch.root.visible || npc.area !== world.area) continue;
    consider(npc.ch.root.position, 1.8, { npc, label: `Parler à ${npc.def.name}` });
  }
  return best;
}
function interact() {
  if (game.action || game.fainting) return;
  if (!$('actionMenu').hidden) { closeMenu(); return; }
  const it = nearestInteractable();
  if (!it) return;
  goal = null;
  ui.sound('click');
  if (it.npc) return openNpc(it.npc);
  const { id, h } = it;
  if (h.door) return game.doorAction(h.door);
  if (h.woro) return openWoro(h.woro);
  if (id === 'workDesk') return startWork();
  openPlaceMenu(id);
}

function startWork() {
  const m = game.state.mission;
  if (!m) { ui.toast('Aucune mission en cours. Va voir Yannick pour en accepter une.'); return; }
  if (m.stage === 'done') { ui.toast('Ta mission est envoyée : fais-la valider par Yannick.'); return; }
  const seat = world.hotspots.workDesk.seat;
  const p = game.player;
  p.root.position.set(seat.x, 0, seat.z); p.root.rotation.y = seat.rotY; p.sitting = true;
  editor.start();
}

// tactile
if (isTouch) {
  $('touch').hidden = false; $('controlsHint').hidden = true;
  const jz = $('joy'), knob = $('joyKnob');
  let jid = null;
  jz.addEventListener('pointerdown', e => { jid = e.pointerId; jz.setPointerCapture(jid); });
  jz.addEventListener('pointermove', e => {
    if (e.pointerId !== jid) return;
    const r = jz.getBoundingClientRect(); let x = (e.clientX - r.left) / r.width * 2 - 1, y = (e.clientY - r.top) / r.height * 2 - 1;
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    joy.x = x; joy.y = y; knob.style.transform = `translate(${x * 38}px, ${y * 38}px)`;
  });
  const end = () => { jid = null; joy.x = joy.y = 0; knob.style.transform = ''; };
  jz.addEventListener('pointerup', end); jz.addEventListener('pointercancel', end);
  $('touchE').addEventListener('pointerdown', e => { e.preventDefault(); interact(); });
  $('touchRun').addEventListener('pointerdown', e => { e.preventDefault(); touchRun = !touchRun; $('touchRun').classList.toggle('on', touchRun); });
  $('touchPhone').addEventListener('pointerdown', e => { e.preventDefault(); phone.toggle(); });
}
$('phoneBtn').onclick = () => { closeMenu(); phone.toggle(); };
$('pgCancel').onclick = () => game.cancelAction();

/* ================= Joueur ================= */
const vel = new THREE.Vector3();
function updatePlayer(dt) {
  const p = game.player, root = p.root;
  const locked = game.action || game.fainting || editor.open || phone.open || !$('actionMenu').hidden || paused;
  if (locked) { vel.set(0, 0, 0); p.update(dt, 0); return; }
  const G = { walk: p.walkSpeed, run: p.runSpeed };
  let fx = 0, fz = 0;
  if (keys.KeyW || keys.KeyZ || keys.ArrowUp) fz += 1;
  if (keys.KeyS || keys.ArrowDown) fz -= 1;
  if (keys.KeyA || keys.KeyQ || keys.ArrowLeft) fx -= 1;
  if (keys.KeyD || keys.ArrowRight) fx += 1;
  fx += joy.x; fz -= joy.y;
  const run = (keys.ShiftLeft || keys.ShiftRight || touchRun) && world.area === 'outside';
  const fwd = new THREE.Vector3(-Math.sin(cam.yaw), 0, -Math.cos(cam.yaw));
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const want = new THREE.Vector3().addScaledVector(fwd, fz).addScaledVector(right, fx);
  let speed = 0;
  if (want.lengthSq() > 0.01) {
    goal = null;
    const mag = Math.min(1, want.length()); want.normalize();
    vel.lerp(want.multiplyScalar((run ? Math.min(G.run, 5.2) : G.walk) * mag), Math.min(1, dt * 7));
  } else if (goal) {
    const r = stepToward(root, goal.pos, G.walk, dt, 0.3, false);
    speed = r.moved / Math.max(dt, 1e-4);
    if (r.dist < 0.3 || r.stuck) goal = null;
    vel.set(0, 0, 0);
  } else vel.lerp(new THREE.Vector3(), Math.min(1, dt * 9));
  if (vel.lengthSq() > 0.0004) {
    const nx = root.position.x + vel.x * dt, nz = root.position.z + vel.z * dt;
    const ox = root.position.x, oz = root.position.z;
    if (!blocked(nx, nz)) { root.position.x = nx; root.position.z = nz; }
    else if (!blocked(nx, oz)) root.position.x = nx;
    else if (!blocked(ox, nz)) root.position.z = nz;
    speed = Math.hypot(root.position.x - ox, root.position.z - oz) / dt;
    const wantRot = Math.atan2(vel.x, vel.z);
    root.rotation.y += Math.atan2(Math.sin(wantRot - root.rotation.y), Math.cos(wantRot - root.rotation.y)) * Math.min(1, dt * 10);
  }
  root.position.y = THREE.MathUtils.lerp(root.position.y, heightAt(root.position.x, root.position.z), Math.min(1, dt * 12));
  p.update(dt, speed);
}

/* ================= Caméra 3e personne ================= */
function rayBox(o, d, maxT, b) {
  let t0 = 0, t1 = maxT;
  for (const [p, dd, lo, hi] of [[o.x, d.x, b.x0, b.x1], [o.y, d.y, -1, b.h], [o.z, d.z, b.z0, b.z1]]) {
    if (Math.abs(dd) < 1e-8) { if (p < lo || p > hi) return null; continue; }
    let ta = (lo - p) / dd, tb = (hi - p) / dd; if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); if (t0 > t1) return null;
  }
  return t0;
}
function updateCamera(dt) {
  const p = game.player.root.position;
  const inside = world.area !== 'outside';
  const sit = game.player.sitT || 0;
  cam.target.lerp(v3.set(p.x, p.y + 1.55 - sit * 0.45, p.z), Math.min(1, dt * 10));
  const want = inside ? Math.min(cam.dist + 0.4, 3.6) : cam.dist;
  const pitch = inside ? clamp(cam.pitch, 0.4, 0.85) : cam.pitch;
  const dir = new THREE.Vector3(Math.sin(cam.yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(cam.yaw) * Math.cos(pitch));
  let maxD = want;
  for (const b of world.colliders) { if (!b.h) continue; const t = rayBox(cam.target, dir, want, b); if (t !== null && t < maxD) maxD = Math.max(0.5, t - 0.22); }
  if (inside) { const A = world.areas[world.area]; for (const [lo, hi, o, d] of [[A.x0, A.x1, cam.target.x, dir.x], [A.z0, A.z1, cam.target.z, dir.z]]) { if (d > 0) maxD = Math.min(maxD, (hi - 0.15 - o) / d); if (d < 0) maxD = Math.min(maxD, (lo + 0.15 - o) / d); } }
  cam.curDist = maxD < cam.curDist ? maxD : THREE.MathUtils.lerp(cam.curDist, maxD, Math.min(1, dt * 3));
  camera.position.copy(cam.target).addScaledVector(dir, Math.max(0.4, cam.curDist));
  if (inside) camera.position.y = Math.min(camera.position.y, world.areas[world.area].ceiling - 0.15);
  if (camera.position.y < 0.3) camera.position.y = 0.3;
  const right = new THREE.Vector3(Math.cos(cam.yaw), 0, -Math.sin(cam.yaw));
  const sh = inside ? 0.15 : 0.35 * Math.min(1, cam.curDist / 4);
  camera.position.addScaledVector(right, sh);
  camera.lookAt(cam.target.x + right.x * sh, cam.target.y, cam.target.z + right.z * sh);
}
let attractT = 0;
function attractCamera(dt) {
  attractT += dt;
  const t = attractT * 0.035, x = Math.sin(t) * 22 - 4;
  camera.position.set(x, 3.4 + Math.sin(t * 1.7) * 0.6, 8.5 + Math.cos(t * 0.8) * 2);
  camera.lookAt(x * 0.7, 2.2, -8);
}

/* ================= Repère d'objectif ================= */
function resolveTarget() {
  const s = game.state;
  let pos = null, area = 'outside', name = '';
  if (game.gps) { pos = new THREE.Vector3(game.gps.x, 0, game.gps.z); name = game.gps.label; }
  else {
    const o = OBJECTIVES[s.obj]; if (!o || !o.target) return null;
    if (o.target.startsWith('npc:')) { const n = game.npc(o.target.slice(4)); pos = n.ch.root.position.clone(); area = n.area; name = n.def.name; }
    else { const h = world.hotspots[o.target]; if (!h) return null; pos = h.pos.clone(); area = h.area || 'outside'; name = PLACES[o.target]?.[0] || h.label; }
  }
  if (area !== world.area) {
    if (world.area !== 'outside') { const ex = world.hotspots[world.area === 'studio' ? 'exitStudio' : 'exitOffice']; return { pos: ex.pos.clone(), name: 'Sortie' }; }
    const door = world.hotspots[area === 'studio' ? 'homeDoor' : 'officeDoor']; return { pos: door.pos.clone(), name: area === 'studio' ? 'Ton studio' : 'Babi Digital' };
  }
  if (game.gps && Math.hypot(pos.x - game.player.root.position.x, pos.z - game.player.root.position.z) < 2) { game.gps = null; ui.toast('Tu es arrivé·e.'); }
  return { pos, name };
}
function updateMarker() {
  const t = !editor.open && !phone.open && resolveTarget();
  const el = $('marker');
  if (!t) { el.hidden = true; return; }
  const pp = game.player.root.position;
  const d = Math.hypot(t.pos.x - pp.x, t.pos.z - pp.z);
  if (d < 1.6) { el.hidden = true; return; }
  const sp = toScreen(t.pos.clone().add(new THREE.Vector3(0, 1.7, 0)));
  const behind = v3.z > 1;
  let x = sp.x, y = sp.y;
  const m = 40, off = behind || x < m || x > innerWidth - m || y < m || y > innerHeight - m;
  if (behind) { x = innerWidth - x; y = innerHeight - m; }
  x = clamp(x, m, innerWidth - m); y = clamp(y, m + 60, innerHeight - m - 40);
  el.hidden = false; el.classList.toggle('edge', off);
  el.style.left = x + 'px'; el.style.top = y + 'px';
  $('markerTxt').textContent = `${t.name} · ${Math.round(d)} m`;
}

/* ================= Étiquettes ================= */
function updateLabels(dt) {
  const pp = game.player?.root.position;
  for (const npc of game.npcs) {
    const d = pp ? npc.ch.root.position.distanceTo(pp) : 99;
    const show = npc.ch.root.visible && d < 8 && !$('hud').hidden && npc.area === world.area;
    if (show && !npc.tag) npc.tag = ui.label(npc.ch.root, esc(npc.def.name), 'name', Infinity, npc.ch.sitting ? 1.55 : 2.0);
    if (!show && npc.tag) { npc.tag.life = 0; npc.tag = null; }
  }
  for (let i = ui.labels.length - 1; i >= 0; i--) {
    const l = ui.labels[i];
    l.life -= dt;
    if (l.life <= 0 || !l.obj.visible) { l.el.remove(); ui.labels.splice(i, 1); continue; }
    const rise = l.el.classList.contains('gain') ? (1 - l.life / l.ttl) * 0.8 : 0;
    const s = toScreen(l.obj.position.clone().setY(l.obj.position.y + l.offset + rise));
    const vis = v3.z < 1 && v3.z > -1 && !editor.open;
    const hasBubble = l.el.classList.contains('name') && game.npcs.some(n => n.tag === l && n.bubble && n.bubble.life > 0);
    l.el.style.display = vis && !hasBubble ? '' : 'none';
    l.el.style.left = s.x + 'px'; l.el.style.top = s.y + 'px';
    if (isFinite(l.ttl)) l.el.style.opacity = Math.min(1, l.life * 2);
  }
}

/* ================= Boucle ================= */
const game = new Game(scene, ui);
const phone = new Phone(game, {
  sound: n => ui.sound(n), badge,
  target: () => { const t = game.state && resolveTarget(); return t && world.area === 'outside' ? t.pos : null; },
  playerMapPos: () => {
    if (world.area === 'outside') return { x: game.player.root.position.x, z: game.player.root.position.z, rot: game.player.root.rotation.y };
    const d = world.hotspots[world.area === 'studio' ? 'homeDoor' : 'officeDoor'].pos; return { x: d.x, z: d.z, rot: Math.PI };
  },
});
const editor = new Editor(game, {
  sound: n => ui.sound(n), toast: (m, k) => ui.toast(m, k),
  onClose: () => { const p = game.player; p.sitting = false; p.root.position.z += 0.5; updateHUD(); },
});
const clock = new THREE.Clock();
let menuHour = 17.4, hudT = 0, saveT = 0, fpsAcc = 0, fpsN = 0, lowFpsT = 0, warnedFps = false, paused = false;

function simulate(dt) {
  const playing = game.state && !$('hud').hidden && !paused;
  let hour = menuHour;
  if (playing) {
    let mult = editor.open ? 0 : game.speed;
    if (game.action) mult = Math.max(game.speed, game.action.a.minutes / 4.5);
    if (mult > 0) game.tick(dt * mult);
    hour = hourOf(game.state.minutes);
    updatePlayer(dt);
    game.updateNPCs(dt, hour, world.area);
  } else if (game.npcs.length) game.updateNPCs(dt, hour, 'outside');
  if (traffic) traffic.update(dt, 1 - env.dayFactor);
  return { playing, hour };
}

function ensureSize() {
  // si la page a démarré cachée (taille nulle) ou si la fenêtre a changé sans événement, on réajuste
  const w = innerWidth, h = innerHeight, cur = renderer.getSize(new THREE.Vector2());
  if (w > 0 && h > 0 && (cur.x !== w || cur.y !== h)) {
    renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); post.build(Q);
  }
}
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;
  ensureSize();
  if (creator.active) { creator.render(dt); requestAnimationFrame(frame); return; }
  windUniform.value = t;
  const { playing, hour } = simulate(dt);
  if (playing) {
    updateCamera(dt);
    const it = !game.action && $('actionMenu').hidden && !editor.open && !phone.open ? nearestInteractable() : null;
    $('prompt').hidden = !it; if (it) $('promptTxt').textContent = it.label;
    updateMarker();
    hudT += dt; if (hudT > 0.25) { hudT = 0; updateHUD(); if (phone.open && phone.view !== 'map') phone.refresh(); }
    saveT += dt; if (saveT > 10) { saveT = 0; game.save(); }
  } else if (!game.state || $('hud').hidden) attractCamera(dt);

  const inside = playing && world.area !== 'outside';
  const focus = playing ? game.player.root.position : camera.position;
  const { day } = env.update(hour, t, inside ? new THREE.Vector3(0, 0, 0) : focus);
  const night = 1 - day;
  // pool de lumières réaffecté à la zone courante
  const zone = playing ? world.area : 'outside';
  let li = 0;
  for (const L of world.lights) {
    if (L.area !== zone || li >= lightPool.length) continue;
    const p = lightPool[li++], s = L.light;
    p.position.copy(s.position); p.color.copy(s.color); p.distance = s.distance;
    p.intensity = L.kind === 'ember' ? s.intensity : L.kind === 'interior' ? (L.daylight ? L.base * day : L.base * (0.55 + 0.45 * night)) : L.base * THREE.MathUtils.smoothstep(night, 0.2, 0.8);
  }
  for (; li < lightPool.length; li++) lightPool[li].intensity = 0;
  for (const e of world.emissives) if (!e.always) e.mat.emissiveIntensity = e.base * THREE.MathUtils.smoothstep(night, 0.15, 0.7);
  for (const m of world.windowGlows || []) { m.emissiveIntensity = 0.15 + day * 1.3; m.emissive.set(day > 0.3 ? '#dcecff' : '#22304a'); }
  if (world.studioFan?.blades && game.state?.upgrades.fan) world.studioFan.blades.rotation.y += dt * 7;
  if (inside) { env.sun.intensity = 0; scene.environmentIntensity = 0.16; env.night.intensity = 0.12; }
  if (world.haze) { world.haze.color.value.copy(env.horizon); world.haze.amount.value = 0.3 + day * 0.12; }
  if (world.water) {
    world.water.material.uniforms.sunDirection.value.copy(env.sunDir.y > 0 ? env.sunDir : new THREE.Vector3(-0.35, 0.8, 0.45).normalize());
    world.water.material.uniforms.sunColor.value.copy(env.sun.color).multiplyScalar(day > 0.05 ? 1 : 0.3);
  }
  for (const f of world.animated) f(dt, t);
  updateLabels(dt);
  if (audio.ctx) audio.update(dt, hour, playing && !inside ? game.player.root.position.distanceTo(world.maquisCenter) : 60, inside ? 0.3 : day);
  renderer.info.reset();
  post.render(dt, t, night, playing ? cam.curDist : 14);

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 1) {
    const fps = fpsN / fpsAcc; fpsAcc = 0; fpsN = 0;
    $('fpsLine').textContent = `${Math.round(fps)} images/s · ${renderer.info.render.calls} appels de rendu · ${(renderer.info.render.triangles / 1000).toFixed(0)}k triangles`;
    if (playing && fps < 28 && qKey !== 'low' && document.visibilityState === 'visible' && document.hasFocus()) { lowFpsT++; if (lowFpsT > 8 && !warnedFps) { warnedFps = true; ui.toast('Le jeu rame ? Baisse la qualité graphique (Échap → Graphismes).'); } } else lowFpsT = 0;
  }
  requestAnimationFrame(frame);
}

/* ================= Écrans ================= */
function togglePause() { paused = !paused; $('pause').hidden = !paused; if (paused) game.save(); }
$('btnResume').onclick = togglePause;
$('btnQuit').onclick = () => { game.save(); paused = false; $('pause').hidden = true; $('hud').hidden = true; showMenu(); };
$('btnPauseSettings').onclick = () => { $('settings').hidden = false; };
$('btnSettings').onclick = () => { $('settings').hidden = false; };
$('btnSettingsClose').onclick = () => { $('settings').hidden = true; };
document.querySelectorAll('#qSeg button').forEach(b => b.onclick = () => applyQuality(b.dataset.q));
document.querySelectorAll('#sndSeg button').forEach(b => b.onclick = () => { audio.setEnabled(b.dataset.s === '1'); document.querySelectorAll('#sndSeg button').forEach(x => x.classList.toggle('on', x === b)); });
document.querySelectorAll('#speedSeg button').forEach(b => b.onclick = () => { game.speed = +b.dataset.s; document.querySelectorAll('#speedSeg button').forEach(x => x.classList.toggle('on', x === b)); });

function showMenu() {
  setAreaVisibility('outside');
  $('menuScreen').hidden = false; $('menuMain').hidden = false;
  const ex = loadGame();
  $('btnContinue').hidden = !ex;
  if (ex) $('btnContinue').textContent = `Continuer — ${ex.name}, jour ${dayOf(ex.minutes)}, ${fmt(ex.money)}`;
}
// ---- création du personnage (aperçu 3D) ----
const creator = new Creator(renderer, {
  sound: n => ui.sound(n),
  onCancel: mode => { if (mode === 'new') showMenu(); else { $('hud').hidden = false; } },
  onConfirm: (look, id, mode) => {
    if (mode === 'new') { clearGame(); begin(newState({ first: id.first, last: id.last, look })); return; }
    game.state.look = look; game.player.setLook(look); game.save();
    $('hud').hidden = false; ui.toast('Nouvelle apparence enregistrée.', 'good');
  },
});
$('btnNew').onclick = () => {
  if (loadGame() && !confirm('Une partie existe déjà. Commencer une nouvelle vie l\'effacera. Continuer ?')) return;
  ui.sound('click'); audio.start();
  $('menuScreen').hidden = true;
  creator.open('new', defaultAppearance(Math.random() < 0.5 ? 'm' : 'f'));
};
ui.openCreatorEdit = () => { closeMenu(); $('hud').hidden = true; creator.open('edit', game.state.look); };
$('btnContinue').onclick = () => { const s = loadGame(); if (s) begin(s); };

function begin(state) {
  audio.start();
  game.start(state);
  $('menuScreen').hidden = true; $('hud').hidden = false; $('victory').hidden = true;
  cam.yaw = game.player.root.rotation.y + Math.PI; cam.pitch = 0.25; cam.curDist = 2.4;
  cam.target.copy(game.player.root.position).add(new THREE.Vector3(0, 1.55, 0));
  ui.onAreaChange(world.area);
  if (state.won) setRentSign(state.name);
  updateHUD();
  if (state.obj === 0) setTimeout(() => { ui.toast(`Bienvenue, ${state.name}. Ton téléphone vibre…`); ui.notify(); }, 800);
  game.save();
}
function setRentSign(name) {
  if (!world.alouerMesh) return;
  world.alouerMesh.material.map = paintedSign({ w: 1024, h: 384, bg: '#1f6a3a', border: '#f6e7c8', seed: 77, wear: 0.4, lines: [{ text: `MAQUIS CHEZ ${name.toUpperCase()}`, size: 0.34, color: '#fff3d6', shadow: '#0b2a16' }, { text: 'Ouvert tous les jours · Ambiance garantie', size: 0.17, font: 'Oswald', weight: 700, color: '#ffd36a' }] });
  world.alouerMesh.material.needsUpdate = true;
}
function showVictory(s) {
  $('victoryTxt').innerHTML = `Après <b>${dayOf(s.minutes)} jours</b> à Marcory et <b>${s.missionsDone.length} missions</b> chez Babi Digital, ${esc(s.name)} ouvre le « Maquis Chez ${esc(s.name)} » au bord de la lagune.`;
  setRentSign(s.name);
  setTimeout(() => { $('victory').hidden = false; }, 600);
}
$('btnKeepPlaying').onclick = () => { $('victory').hidden = true; };

/* ---- n'afficher que la zone où se trouve le joueur (le quartier n'est pas rendu depuis un intérieur) ---- */
const zoneSets = { outside: [], inside: [] };
function classifyScene() {
  const skip = new Set([env.sky, env.clouds, env.stars, env.sun, env.sun.target, env.night, world.water, world.simpleWater]);
  const box = new THREE.Box3(), c = new THREE.Vector3();
  for (const o of scene.children) {
    if (skip.has(o) || o.isLight) continue;
    box.setFromObject(o);
    if (box.isEmpty()) continue;
    box.getCenter(c);
    (c.x > 400 && c.z < -200 ? zoneSets.inside : zoneSets.outside).push(o);
  }
}
function setAreaVisibility(area) {
  const out = area === 'outside';
  for (const o of zoneSets.outside) o.visible = out;
  for (const o of zoneSets.inside) o.visible = !out;
  env.sun.castShadow = out;
  if (world.water) world.water.visible = out && Q.water > 0;
  if (world.simpleWater) world.simpleWater.visible = out && !Q.water;
}

/* ================= Chargement ================= */
const TIPS = [
  'Le garba, c\'est de l\'attiéké avec du thon frit : le repas préféré des Abidjanais pressés.',
  'Le woro-woro est le taxi collectif d\'Abidjan : on le partage avec d\'autres passagers.',
  'Les fenêtres à lames de verre (naco) laissent passer l\'air : indispensable sous ce climat.',
  'Ton salaire est versé à chaque mission validée par ton responsable. Garde de quoi payer le loyer !',
  'Appuie sur T pour ouvrir ton téléphone : carte, missions, argent, messages.',
];
$('loadTip').textContent = TIPS[Math.floor(Math.random() * TIPS.length)];
onProgress((f, label) => { $('loadFill').style.width = (f * 100).toFixed(0) + '%'; $('loadPct').textContent = Math.round(f * 100) + '%'; $('loadLabel').textContent = 'Chargement : ' + label; });
if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('sw.js').catch(() => {});

async function boot() {
  const T0 = performance.now(), lap = l => console.log(`[babi] ${l} ${((performance.now() - T0) / 1000).toFixed(1)}s`);
  try {
    await Promise.all(['Anton', 'Oswald', 'Permanent Marker'].map(f => document.fonts.load(`40px "${f}"`)));
    await Promise.all([
      buildWorld(scene, Q).then(() => lap('monde')),
      loadCharacters().then(() => lap('personnages')).catch(e => { throw new Error('modèles des personnages (' + e.message + ')'); }),
    ]);
    traffic = new Traffic(scene, {
      isObstacle: (x, z) => {
        if (world.area === 'outside' && game.player) { const p = game.player.root.position; if (Math.abs(p.x - x) < 1.3 && Math.abs(p.z - z) < 1.4) return true; }
        for (const n of game.npcs) if (n.area === 'outside' && n.ch.root.visible) { const p = n.ch.root.position; if (Math.abs(p.x - x) < 1.1 && Math.abs(p.z - z) < 1.3) return true; }
        return false;
      },
      onHonk: pos => { if (world.area === 'outside' && game.player && pos.distanceTo(game.player.root.position) < 35) ui.sound('honk'); },
    });
    world.dynamic = () => traffic.boxes();
    const counts = {}; for (const L of world.lights) counts[L.area] = (counts[L.area] || 0) + 1;
    for (let i = 0; i < Math.max(...Object.values(counts)); i++) { const p = new THREE.PointLight('#fff', 0, 10, 2); scene.add(p); lightPool.push(p); }
    classifyScene();
    applyQuality(qKey);
    $('loadLabel').textContent = 'Préparation des shaders…';
    env.update(menuHour, 0, camera.position, true);
    game.spawnNPCs();
    await renderer.compileAsync(scene, camera);
    lap('shaders');
    frame();
    setTimeout(() => { $('loading').hidden = true; showMenu(); }, 300);
  } catch (err) {
    console.error(err);
    $('loadLabel').textContent = 'Chargement interrompu';
    $('loadError').hidden = false;
    $('loadError').innerHTML = `Une ressource essentielle n'a pas pu être chargée : <b>${esc(err.message)}</b>.<br>Vérifie ta connexion internet puis recharge la page. Si le problème persiste, le CDN (jsDelivr / Poly Haven) est peut-être indisponible.`;
  }
}
boot();

// Outils de test (console) : simulation accélérée sans rendu.
window.babi = {
  creator, game, world, scene, camera, renderer, env, applyQuality, ui, begin, newState, cam, post, phone, editor, keys,
  get traffic() { return traffic; },
  interact, nearestInteractable, openPlaceMenu,
  step(n = 60, dt = 1 / 30) { for (let i = 0; i < n; i++) simulate(dt); updateHUD(); },
};
