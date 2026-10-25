// Règles du jeu : besoins, argent, logement, emploi de développeur web, objectifs, PNJ.
import * as THREE from 'three';
import { Character, SKIN_TONES } from './characters.js';
import { clothesFor, ACCESSORIES, randomAppearance } from './appearance.js';
import { world, blocked, heightAt, segHitsBox } from './world.js';
import { MISSIONS, maintenanceMission } from './missions.js';
import { saveGame } from './save.js';

export const RENT = 30000, LATE_FEE = 5000, DREAM = 150000, WORO_PRICE = 300, TAXI_PRICE = 1000;
export const OFFICE_HOURS = [7, 20];
const DECAY = { faim: 4.2, energie: 3.4 }; // par heure de jeu

export const fmt = n => Math.round(n).toLocaleString('fr-FR').replace(/[  ]/g, ' ') + ' FCFA';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pick = a => a[Math.floor(Math.random() * a.length)];
export const hourOf = m => (m / 60) % 24;
export const dayOf = m => Math.floor(m / 1440) + 1;
export const clockOf = m => { const h = hourOf(m); return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };

export function newState({ first, last = '', look }) {
  const name = first;
  return {
    name, lastName: last, gender: look.gender, look,
    money: 12000, minutes: 7 * 60, needs: { faim: 60, energie: 82 },
    area: 'studio', pos: null, rot: Math.PI,
    job: null, mission: null, missionsDone: [], lastMaintDay: 0,
    history: [{ t: 7 * 60, label: 'Économies de départ', amount: 12000, cat: 'revenu' }],
    rent: { amount: RENT, dueDay: 7, late: false },
    upgrades: {}, obj: 0, flags: {}, won: false, rels: {}, messages: [
      { id: 'welcome', from: 'Mme Kouamé — Babi Digital', t: 6 * 60 + 40, read: false,
        text: `Bonjour ${name}, suite à votre candidature, nous aimerions vous rencontrer pour le poste de développeur·se web junior. Passez à l'accueil de Babi Digital (rue de la Lagune, Marcory) entre 7h et 20h. Cordialement, Awa Kouamé, RH.` },
      { id: 'rent1', from: 'M. Kouassi (propriétaire)', t: 6 * 60 + 50, read: false,
        text: `Bonjour ${name}, je vous rappelle que le loyer du studio (30 000 FCFA) est à régler avant la fin du jour 7. Vous pouvez payer depuis le studio ou par mobile money. Merci.` },
    ],
  };
}

/* ================= Objectifs ================= */
export const OBJECTIVES = [
  { t: 'Un message important', d: 'Ton téléphone a vibré. Ouvre-le (touche T ou bouton en bas à droite) et lis tes messages.', done: s => s.flags.readWelcome, target: null },
  { t: 'Sortir de chez toi', d: 'Sors de ton studio par la porte d\'entrée.', done: s => s.area === 'outside' || s.job, target: 'exitStudio' },
  { t: 'Trouver l\'entreprise', d: 'Rends-toi chez Babi Digital (repère à l\'écran et sur la carte du téléphone) et entre dans les locaux.', done: s => s.area === 'office' || s.job, target: 'officeDoor' },
  { t: 'L\'entretien d\'embauche', d: 'Parle à Mme Kouamé, la responsable RH, à l\'accueil.', done: s => !!s.job, target: 'npc:kouame' },
  { t: 'Ta première mission', d: 'Va voir Yannick, le responsable technique, près du tableau, et accepte une mission.', done: s => !!s.mission || s.missionsDone.length > 0, target: 'npc:yannick' },
  { t: 'Au travail', d: 'Installe-toi à ton poste de travail (près des baies vitrées) et corrige les bugs de la mission.', done: s => (s.mission && s.mission.stage !== 'accepted') || s.missionsDone.length > 0, target: 'workDesk' },
  { t: 'Terminer la mission', d: 'Corrige tous les bugs, lance les tests et envoie ton code.', done: s => (s.mission && s.mission.stage === 'done') || s.missionsDone.length > 0, target: 'workDesk' },
  { t: 'Recevoir ton salaire', d: 'Fais valider ta mission par Yannick pour être payé·e.', done: s => s.missionsDone.length > 0, target: 'npc:yannick' },
  { t: 'Faire tes courses', d: 'Achète à manger (maquis, boutique ou étal), puis vérifie tes dépenses dans l\'appli Argent du téléphone.', done: s => s.flags.boughtFood && s.flags.viewedMoney, target: 'maquis' },
  { t: 'Payer ton loyer', d: `Règle le loyer de la semaine (${fmt(RENT)}) depuis ton studio ou l'appli Argent.`, done: s => s.flags.rentPaid, target: 'rentTable' },
  { t: 'Améliorer ta vie', d: 'Offre-toi une nouvelle tenue à l\'atelier Élégance ou équipe ton studio (boutique de Moussa).', done: s => s.flags.upgraded, target: 'atelier' },
  { t: 'Le grand rêve', d: `Économise ${fmt(DREAM)} et loue le local « À louer » pour ouvrir ton propre maquis.`, done: s => s.won, target: 'alouer' },
];

/* ================= PNJ ================= */
const LINES = [
  'On dit quoi ?', 'Ça va un peu, et toi ?', 'Y a pas drap, on est là !', 'Babi c\'est doux hein !', 'Faut pas fatiguer, on est ensemble.',
  'Le woro-woro a encore augmenté ce matin…', 'Tu as vu le match des Éléphants ?', 'C\'est comment ? Ça va aller !', 'Tchié, il fait chaud aujourd\'hui !',
  'Ici tout le monde se connaît.', 'Ce soir maquis, on va s\'enjailler !', 'Doucement, doucement, c\'est pas la course.',
];
const CHAT = ['Mais non, c\'est pas comme ça !', 'Je te dis que c\'est vrai !', 'Hahaha, toi aussi…', 'Attends, attends, écoute-moi.', 'Le prix du garba a monté encore.', 'On va voir dimanche.'];

const NPC_DEFS = [
  // commerçants
  { id: 'awa', name: 'Tantie Awa', gender: 'f', skin: SKIN_TONES[1], hue: 0.0, role: 'shop', place: 'maquis', home: () => world.hotspots.maquis.pos.clone().add(new THREE.Vector3(0.2, 0, -0.9)), face: 0 },
  { id: 'moussa', name: 'Moussa', gender: 'm', skin: SKIN_TONES[0], outfit: { top: '#e9e6df', bottom: '#5b4a3a' }, role: 'shop', place: 'boutique', home: () => world.hotspots.boutique.pos.clone().add(new THREE.Vector3(1.4, 0, -0.5)), face: 0 },
  { id: 'adjoua', name: 'Maman Adjoua', gender: 'f', skin: SKIN_TONES[2], hue: 0.45, role: 'shop', place: 'etal', home: () => world.hotspots.etal.pos.clone().add(new THREE.Vector3(0.6, 0, 2.1)), face: Math.PI },
  { id: 'rose', name: 'Tantie Rose', gender: 'f', skin: SKIN_TONES[3], hue: 0.72, role: 'shop', place: 'atelier', home: () => world.hotspots.atelier.pos.clone().add(new THREE.Vector3(-1.6, 0, -0.3)), face: 0.3 },
  // passants
  { id: 'koffi', name: 'Koffi', gender: 'm', skin: SKIN_TONES[2], outfit: 1, role: 'walker' },
  { id: 'ibrahim', name: 'Ibrahim', gender: 'm', skin: SKIN_TONES[3], outfit: 5, role: 'walker' },
  // deux amis qui discutent sur la promenade
  { id: 'yao', name: 'Yao', gender: 'm', skin: SKIN_TONES[4], outfit: 2, role: 'chat', spot: [-21.2, 11.3], face: Math.PI / 2 },
  { id: 'aya', name: 'Aya', gender: 'f', skin: SKIN_TONES[4], hue: 0.25, role: 'chat', spot: [-19.8, 11.3], face: -Math.PI / 2 },
  // client du maquis
  { id: 'salif', name: 'Salif', gender: 'm', skin: SKIN_TONES[1], outfit: 4, role: 'seated' },
  // employés qui vont au bureau le matin et en repartent le soir
  { id: 'marc', name: 'Marc', gender: 'm', skin: SKIN_TONES[3], outfit: 3, role: 'commuter', from: [-6, 6.6] },
  { id: 'fatou', name: 'Fatou', gender: 'f', skin: SKIN_TONES[2], hue: 0.6, role: 'commuter', from: [-1.5, 6.4] },
  // dans les bureaux
  { id: 'kouame', name: 'Mme Kouamé', gender: 'f', skin: SKIN_TONES[0], hue: 0.58, role: 'office', spot: 'recruiter', title: 'Responsable RH' },
  { id: 'yannick', name: 'Yannick', gender: 'm', skin: SKIN_TONES[1], outfit: 3, role: 'office', spot: 'lead', title: 'Responsable technique' },
  { id: 'serge', name: 'Serge', gender: 'm', skin: SKIN_TONES[4], outfit: 2, role: 'office', desk: 0 },
  { id: 'ines', name: 'Inès', gender: 'f', skin: SKIN_TONES[3], hue: 0.15, role: 'office', desk: 3 },
];

export class Game {
  constructor(scene, ui) {
    this.scene = scene; this.ui = ui;
    this.state = null; this.player = null; this.npcs = [];
    this.action = null; this.speed = 1;
  }

  /* ---------- démarrage ---------- */
  start(state) {
    this.state = state;
    if (this.player) this.scene.remove(this.player.root);
    this.player = new Character({ gender: state.look.gender, look: state.look, name: state.name });
    this.scene.add(this.player.root);
    world.area = state.area || 'outside';
    if (state.pos) { this.player.root.position.set(state.pos[0], 0, state.pos[1]); }
    else { const A = world.areas.studio; this.player.root.position.copy(A.spawn).add(new THREE.Vector3(2.2, 0, -1.4)); }
    this.player.root.rotation.y = state.rot ?? Math.PI;
    if (blocked(this.player.root.position.x, this.player.root.position.z)) this.placeAtAreaSpawn(world.area);
    if (!this.npcs.length) this.spawnNPCs();
    this.action = null;
    this.state.flags.dayChecked = dayOf(state.minutes);
    this.checkRent(true);
  }
  placeAtAreaSpawn(area) {
    if (area === 'outside') { this.player.root.position.copy(world.places.home ? new THREE.Vector3(world.places.home.x, 0, world.places.home.z + 1.2) : world.spawn); }
    else { const A = world.areas[area]; this.player.root.position.copy(A.spawn); this.player.root.rotation.y = A.spawnRot; }
  }
  save() {
    const s = this.state, p = this.player.root;
    s.pos = [p.position.x, p.position.z]; s.rot = p.rotation.y; s.area = world.area;
    saveGame(s);
  }

  spawnNPCs() {
    for (const d of NPC_DEFS) {
      // chaque PNJ a sa propre apparence (déterministe d'une partie à l'autre)
      const seed = [...d.id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7);
      const look = Object.assign(randomAppearance(d.gender, seed), { skin: d.skin, lod: 'npc' }, d.look || {});
      if (d.role === 'office' || d.role === 'commuter') {
        look.acc.hat = 'aucun';
        if (d.id !== 'serge') Object.assign(look, d.gender === 'm' ? { top: { style: 'costume' }, bottom: { style: 'pantalon_costume' }, shoes: { style: 'chaussures_ville' } } : { top: { style: 'chemisier' }, bottom: { style: 'jupe' }, shoes: { style: 'bottines' } });
      }
      const c = new Character({ gender: d.gender, look, name: d.name });
      const npc = { def: d, ch: c, target: null, wait: Math.random() * 5, talking: 0, bubble: null, area: d.role === 'office' ? 'office' : 'outside' };
      const r = c.root;
      if (d.home) { r.position.copy(d.home()); r.rotation.y = d.face; }
      else if (d.role === 'seated') { const s = world.maquisSeats[2]; r.position.set(s.x, 0.2, s.z); r.rotation.y = s.rotY; c.sitting = true; npc.seat = s; }
      else if (d.role === 'chat') { r.position.set(d.spot[0], 0, d.spot[1]); r.rotation.y = d.face; npc.chatT = Math.random() * 4; }
      else if (d.role === 'commuter') { r.position.set(d.from[0], 0, d.from[1]); }
      else if (d.role === 'office') {
        if (d.spot) { const sp = world.officeSpots[d.spot]; r.position.set(sp.x, 0, sp.z); r.rotation.y = sp.rotY; }
        else { const s = world.officeDesks[d.desk]; r.position.set(s.x, 0, s.z); r.rotation.y = s.rotY; c.sitting = true; npc.seat = s; }
      }
      else r.position.copy(pick(world.waypoints));
      this.scene.add(r);
      this.npcs.push(npc);
    }
  }
  npc(id) { return this.npcs.find(n => n.def.id === id); }

  /* ---------- argent ---------- */
  /** Débite si le solde suffit. Retourne false sans rien modifier sinon : jamais de solde négatif. */
  pay(amount, label, cat = 'dépense') {
    const s = this.state;
    if (!(amount > 0)) return true;
    if (s.money < amount) { this.ui.toast(`Solde insuffisant : il te faut ${fmt(amount)}`, 'bad'); this.ui.sound('error'); return false; }
    s.money -= amount;
    s.history.push({ t: s.minutes, label, amount: -amount, cat });
    this.ui.sound('cash');
    this.ui.toast(`−${fmt(amount)} · ${label}`);
    this.save();
    return true;
  }
  earn(amount, label, cat = 'revenu') {
    const s = this.state;
    s.money += amount;
    s.history.push({ t: s.minutes, label, amount, cat });
    this.ui.sound('cash');
    this.ui.gain(this.player.root, '+' + fmt(amount));
    this.save();
  }

  /* ---------- temps, besoins, loyer ---------- */
  tick(gameMin) {
    const s = this.state, n = s.needs;
    const sleeping = this.action?.a.sleep;
    const fan = s.upgrades.fan ? 0.85 : 1;
    n.faim = clamp(n.faim - DECAY.faim / 60 * gameMin * (sleeping ? 0.35 : 1), 0, 100);
    if (!sleeping) n.energie = clamp(n.energie - DECAY.energie / 60 * gameMin * fan, 0, 100);
    if (this.action) {
      const { a } = this.action;
      const step = Math.min(gameMin, a.minutes - this.action.done);
      for (const k in a.fx || {}) n[k] = clamp(n[k] + a.fx[k] * step / a.minutes, 0, 100);
      this.action.done += step;
      this.ui.progress(this.action.done / a.minutes);
      if (this.action.done >= a.minutes - 1e-6) this.finishAction(false);
    }
    s.minutes += gameMin;
    if (dayOf(s.minutes) !== s.flags.dayChecked) { s.flags.dayChecked = dayOf(s.minutes); this.checkRent(false); }
    for (const k of ['faim', 'energie']) {
      if (n[k] < 15 && !s.flags['warn_' + k]) { s.flags['warn_' + k] = true; this.ui.toast(k === 'faim' ? 'Tu as très faim : va manger quelque chose.' : 'Tu tombes de fatigue : rentre dormir.', 'bad'); }
      if (n[k] > 30) s.flags['warn_' + k] = false;
    }
    if ((n.energie <= 0 || n.faim <= 0) && !this.fainting) this.faint(n.energie <= 0 ? 'de fatigue' : 'de faim');
    this.checkObjective();
  }

  checkRent(silent) {
    const s = this.state, d = dayOf(s.minutes);
    if (d > s.rent.dueDay && !s.rent.late) {
      s.rent.late = true; s.rent.amount += LATE_FEE;
      this.message('M. Kouassi (propriétaire)', `${s.name}, le loyer est en retard. Une pénalité de ${fmt(LATE_FEE)} s'ajoute : ${fmt(s.rent.amount)} à régler au plus vite.`);
      if (!silent) this.ui.toast('Loyer en retard : pénalité de ' + fmt(LATE_FEE), 'bad');
    } else if (!silent && d === s.rent.dueDay) this.ui.toast(`Dernier jour pour payer ton loyer (${fmt(s.rent.amount)}).`);
  }
  payRent(via = 'studio') {
    const s = this.state;
    const label = `Loyer jusqu'au jour ${s.rent.dueDay + 7}${s.rent.late ? ' (avec pénalité)' : ''}`;
    if (!this.pay(s.rent.amount, label, 'loyer')) return false;
    s.rent.dueDay += 7; s.rent.amount = RENT; s.rent.late = false; s.flags.rentPaid = true;
    this.ui.toast(`Loyer payé ${via === 'phone' ? 'par mobile money' : 'à M. Kouassi'}. Prochaine échéance : jour ${s.rent.dueDay}.`, 'good');
    this.checkObjective(); this.save();
    return true;
  }
  message(from, text) {
    const s = this.state;
    s.messages.push({ id: 'm' + s.messages.length + '-' + Math.round(s.minutes), from, text, t: s.minutes, read: false });
    this.ui.notify();
  }

  checkObjective() {
    const s = this.state;
    let changed = false;
    while (s.obj < OBJECTIVES.length && OBJECTIVES[s.obj].done(s)) { s.obj++; changed = true; }
    if (changed) { this.ui.sound('objective'); if (s.obj < OBJECTIVES.length) this.ui.toast(`Nouvel objectif : ${OBJECTIVES[s.obj].t}`, 'good'); this.save(); }
  }

  faint(why) {
    this.fainting = true;
    if (this.action) { this.action = null; this.ui.endProgress(); }
    this.ui.closeAll();
    this.ui.fade(`Tu t'es évanoui·e ${why}…<br><small>Un voisin t'a ramené·e chez toi. Médicaments : −2 000 FCFA</small>`, 2800, () => {
      const s = this.state;
      const fee = Math.min(2000, s.money);
      if (fee > 0) { s.money -= fee; s.history.push({ t: s.minutes, label: 'Pharmacie (malaise)', amount: -fee, cat: 'santé' }); }
      s.minutes += 300;
      s.needs.energie = Math.max(s.needs.energie, 45); s.needs.faim = Math.max(s.needs.faim, 35);
      this.enterArea('studio', true);
      this.player.sitting = false; this.player.root.visible = true;
      this.fainting = false; this.save();
    });
  }

  /* ---------- zones : extérieur / studio / bureaux ---------- */
  enterArea(area, instant = false) {
    const go = () => {
      world.area = area;
      this.state.area = area;
      this.placeAtAreaSpawn(area);
      if (area === 'outside') {
        const from = this.lastDoor === 'office' ? world.hotspots.officeDoor.pos : world.hotspots.homeDoor.pos;
        this.player.root.position.copy(from).add(new THREE.Vector3(0, 0, 0.6));
        this.player.root.rotation.y = 0;
      }
      this.lastDoor = area === 'outside' ? this.lastDoor : area;
      this.ui.onAreaChange(area);
      this.checkObjective(); this.save();
    };
    this.ui.sound('door');
    if (instant) go(); else this.ui.fade(area === 'outside' ? '' : world.areas[area].name, 700, go);
  }
  doorAction(door) {
    const h = hourOf(this.state.minutes);
    if (door === 'office') {
      const [o, c] = OFFICE_HOURS;
      if (h < o || h >= c) { this.ui.toast(`Babi Digital est fermé. Ouverture de ${o}h à ${c}h.`, 'bad'); return; }
    }
    if (door === 'out') this.enterArea('outside'); else this.enterArea(door);
  }

  /* ---------- transport ---------- */
  travel(dest, mode) {
    const price = mode === 'taxi' ? TAXI_PRICE : WORO_PRICE;
    const label = mode === 'taxi' ? `Taxi vers ${dest.name}` : `Woro-woro vers ${dest.name}`;
    if (!this.pay(price, label, 'transport')) return;
    this.ui.closeAll();
    this.ui.fade(mode === 'taxi' ? 'Course en taxi…' : 'Trajet en woro-woro…', 1400, () => {
      this.state.minutes += mode === 'taxi' ? 8 : 12;
      world.area = 'outside'; this.state.area = 'outside';
      this.player.root.position.set(dest.x, 0, dest.z + 0.6);
      this.player.root.rotation.y = 0;
      this.ui.onAreaChange('outside');
      this.save();
    });
  }
  destinations() {
    const P = world.places;
    return [
      { id: 'home', name: 'Cour Kouassi (ton studio)', x: P.woro_cour.x, z: P.woro_cour.z },
      { id: 'office', name: 'Babi Digital', x: P.woro_bureau.x, z: P.woro_bureau.z },
      { id: 'maquis', name: "Maquis Le Jardin d'Awa", x: -12, z: -3.2 },
      { id: 'lagune', name: 'Bord de lagune', x: -2, z: 11 },
    ];
  }

  /* ---------- actions par lieu ---------- */
  actionsFor(id) {
    const s = this.state, h = hourOf(s.minutes), A = [];
    switch (id) {
      case 'bed': {
        const night = h >= 19 || h < 5;
        const mins = night ? (((31 - h) % 24) * 60) : 480;
        A.push({ l: night ? 'Dormir jusqu\'au matin' : 'Dormir 8 heures', d: `Réveil vers ${clockOf(s.minutes + mins)}`, minutes: mins, fx: { energie: s.upgrades.mattress ? 110 : 100 }, sleep: true, fade: 'Bonne nuit…', hide: true });
        A.push({ l: 'Faire une sieste', d: '2 heures', minutes: 120, fx: { energie: s.upgrades.mattress ? 35 : 28 }, sleep: true, fade: 'Petite sieste…', hide: true });
        break;
      }
      case 'stove': A.push({ l: 'Cuisiner riz sauce graine', d: 'Ingrédients compris', minutes: 60, price: 1200, fx: { faim: 65 }, food: true, fade: 'Ça mijote…', hide: true, cat: 'nourriture' }); break;
      case 'shower': A.push({ l: 'Prendre une douche', d: 'Ça réveille !', minutes: 20, fx: { energie: 6 }, fade: 'Douche…', hide: true }); break;
      case 'tv': A.push({ l: 'Regarder le journal télévisé', minutes: 45, fx: { energie: -2 }, tv: true }); break;
      case 'wardrobe':
        A.push({ l: 'Changer de tenue, de coiffure ou d\'accessoires', d: 'Devant le miroir · aperçu 3D', minutes: 0, openCreator: true });
        break;
      case 'rentTable':
        A.push({ l: 'Payer le loyer', d: `Échéance : fin du jour ${s.rent.dueDay}${s.rent.late ? ' · EN RETARD' : ''}`, minutes: 0, price: s.rent.amount, rent: true });
        break;
      case 'maquis':
        A.push({ l: 'Garba', d: 'Attiéké + thon frit', minutes: 20, price: 300, fx: { faim: 38 }, food: true, sit: true, cat: 'nourriture' });
        A.push({ l: 'Alloco poulet', minutes: 30, price: 1500, fx: { faim: 55 }, food: true, sit: true, cat: 'nourriture' });
        A.push({ l: 'Poisson braisé attiéké', minutes: 45, price: 2500, fx: { faim: 85 }, food: true, sit: true, cat: 'nourriture' });
        A.push({ l: 'Bissap glacé', minutes: 15, price: 200, fx: { faim: 4, energie: 3 }, food: true, sit: true, cat: 'nourriture' });
        break;
      case 'maquisSeat': A.push({ l: 'Se poser à une table', d: 'Sous la tôle, au ventilo', minutes: 30, fx: { energie: 4 }, sit: true }); break;
      case 'boutique':
        A.push({ l: 'Pain beurre', minutes: 5, price: 250, fx: { faim: 16 }, food: true, cat: 'nourriture' });
        A.push({ l: 'Sachet d\'eau fraîche', minutes: 2, price: 50, fx: { energie: 1 }, food: true, cat: 'nourriture' });
        A.push({ l: 'Ventilateur pour le studio', d: s.upgrades.fan ? 'Déjà installé' : 'Tu te fatigues 15 % moins vite', minutes: 0, price: 15000, upgrade: 'fan', disabled: s.upgrades.fan ? 'Déjà acheté' : null, cat: 'équipement' });
        A.push({ l: 'Matelas neuf', d: s.upgrades.mattress ? 'Déjà installé' : 'Le sommeil récupère plus vite', minutes: 0, price: 25000, upgrade: 'mattress', disabled: s.upgrades.mattress ? 'Déjà acheté' : null, cat: 'équipement' });
        break;
      case 'etal': A.push({ l: 'Mangues bien mûres', minutes: 5, price: 500, fx: { faim: 18 }, food: true, cat: 'nourriture' }); A.push({ l: 'Bananes plantain', minutes: 5, price: 300, fx: { faim: 12 }, food: true, cat: 'nourriture' }); break;
      case 'atelier':
        for (const [slot, list] of [...['top', 'bottom', 'shoes'].map(k => [k, clothesFor(k, s.look.gender)]), ...Object.entries(ACCESSORIES).map(([k, v]) => ['acc.' + k, v])])
          for (const it of list) if (!it.starter && !s.look.owned.includes(it.id))
            A.push({ l: it.name, d: slot.startsWith('acc') ? 'Accessoire' : 'Vêtement', minutes: 0, price: it.price, buyItem: { slot, id: it.id, name: it.name }, cat: slot.startsWith('acc') ? 'accessoires' : 'vêtements' });
        if (!A.length) A.push({ l: 'Tu as déjà toute la collection', minutes: 0, disabled: 'Revenez bientôt' });
        break;
      case 'coffee': A.push({ l: 'Café', d: 'Énergie +8', minutes: 5, price: 200, fx: { energie: 8 }, food: true, cat: 'nourriture' }); break;
      case 'bench': A.push({ l: 'Regarder la lagune', minutes: 40, fx: { energie: 5 }, sit: true }); break;
      case 'pier': A.push({ l: 'Contempler le Plateau', minutes: 30, fx: { energie: 3 } }); break;
      case 'alouer':
        A.push({ l: 'Appeler le propriétaire', d: `Bail + caution : ${fmt(DREAM)}`, minutes: 0, dream: true,
          req: () => s.missionsDone.length < 3 ? `Il faut un emploi stable (3 missions, ${s.missionsDone.length}/3)` : s.money < DREAM ? `Il te manque ${fmt(DREAM - s.money)}` : null });
        break;
    }
    return A;
  }

  blockReason(a) {
    const s = this.state;
    if (a.disabled) return a.disabled;
    if (a.price && s.money < a.price) return 'Solde insuffisant';
    if (a.req) return a.req();
    return null;
  }

  /** Exécute une action. Les paiements sont faits une seule fois, au lancement. */
  run(a, ctx = {}) {
    if (this.action) return;
    const why = this.blockReason(a);
    if (why) { this.ui.toast(why, 'bad'); this.ui.sound('error'); return; }
    const s = this.state, p = this.player;
    // achats instantanés
    if (a.rent) { this.payRent('studio'); this.ui.refreshMenu(); return; }
    if (a.openCreator) { this.ui.openCreatorEdit(); return; }
    if (a.buyItem) {
      const { slot, id, name } = a.buyItem;
      if (s.look.owned.includes(id)) return;
      if (!this.pay(a.price, `${a.cat === 'accessoires' ? 'Accessoire' : 'Vêtement'} : ${name}`, a.cat)) return;
      s.look.owned.push(id);
      const [k1, k2] = slot.split('.');
      if (k2) s.look[k1][k2] = id; else s.look[k1].style = id;
      p.setLook(s.look);
      s.flags.upgraded = true; this.ui.toast('Tenue achetée et enfilée. Elle t\'attend aussi dans ton armoire.', 'good');
      this.checkObjective(); this.save(); this.ui.refreshMenu(); return;
    }
    if (a.upgrade) {
      if (!this.pay(a.price, a.l, 'équipement')) return;
      s.upgrades[a.upgrade] = true; s.flags.upgraded = true;
      this.ui.toast(a.upgrade === 'fan' ? 'Ventilateur livré et installé dans ton studio.' : 'Matelas neuf livré dans ton studio.', 'good');
      this.checkObjective(); this.save(); this.ui.refreshMenu(); return;
    }
    if (a.dream) {
      if (!this.pay(DREAM, 'Bail du local commercial', 'investissement')) return;
      s.won = true; this.checkObjective(); this.save(); this.ui.victory(s); return;
    }
    // actions qui prennent du temps
    if (a.price && !this.pay(a.price, a.l, a.cat || 'dépense')) return;
    if (a.food) s.flags.boughtFood = true;
    this.action = { a, ctx, done: 0 };
    if (a.sit) {
      const seat = (ctx.place === 'maquis' || ctx.place === 'maquisSeat') ? this.freeSeat() : null;
      if (seat) { p.root.position.set(seat.x, 0.2, seat.z); p.root.rotation.y = seat.rotY; this.action.seat = seat; }
      if (ctx.place === 'bench') { p.root.position.set(-2, 0, 12.55); p.root.rotation.y = Math.PI; }
      p.sitting = true;
    }
    if (a.tv && world.studioTv) world.studioTv.emissiveIntensity = 1.2;
    if (a.fade) this.ui.fade(a.fade);
    if (a.hide) p.root.visible = false;
    this.ui.closeAll();
    this.ui.beginProgress(a.l);
  }

  freeSeat() {
    const taken = new Set(this.npcs.filter(n => n.seat).map(n => n.seat));
    const pp = this.player.root.position;
    return world.maquisSeats.filter(s => !taken.has(s)).sort((a, b) => Math.hypot(a.x - pp.x, a.z - pp.z) - Math.hypot(b.x - pp.x, b.z - pp.z))[0];
  }

  finishAction(cancelled) {
    const { a } = this.action, p = this.player;
    if (a.tv && world.studioTv) world.studioTv.emissiveIntensity = 0;
    p.sitting = false; p.root.visible = true;
    if (this.action.seat) { const sr = this.action.seat.rotY; p.root.position.x += Math.sin(sr) * 0.6; p.root.position.z += Math.cos(sr) * 0.6; }
    if (!cancelled && a.sleep) this.ui.toast(`Tu te sens reposé·e. Il est ${clockOf(this.state.minutes)}.`, 'good');
    this.action = null;
    this.ui.endProgress();
    this.checkObjective(); this.save();
  }
  cancelAction() { if (this.action) this.finishAction(true); }

  /* ---------- emploi : recrutement et missions ---------- */
  dialog(npc) {
    const s = this.state, d = npc.def, h = hourOf(s.minutes);
    const opts = [];
    let text = pick(LINES);
    if (d.id === 'kouame') {
      if (!s.job) {
        text = `Bonjour ${s.name}, merci d'être venu·e. Je vais vous poser deux petites questions avant de vous présenter l'équipe.`;
        opts.push({ l: 'Passer l\'entretien', interview: true });
      } else text = 'Bon courage pour aujourd\'hui ! Yannick vous attend près du tableau pour les missions.';
    } else if (d.id === 'yannick') {
      if (!s.job) text = 'Salut ! Passe d\'abord voir Mme Kouamé à l\'accueil, elle s\'occupe des recrutements.';
      else if (!s.mission) {
        const avail = this.availableMissions();
        text = avail.length ? 'On a du travail pour toi. Choisis une mission :' : 'Plus de mission pour aujourd\'hui. Repasse demain, il y aura de la maintenance.';
        for (const m of avail) opts.push({ l: `${m.title} — ${m.client}`, d: `${m.tasks.length} bugs à corriger`, pay: m.pay, accept: m });
      } else if (s.mission.stage === 'done') {
        text = 'Montre-moi ça… Les tests passent, le client est content. Bon travail !';
        opts.push({ l: 'Faire valider la mission', validate: true, pay: s.mission.def.pay });
      } else text = `Ta mission « ${s.mission.def.title} » t'attend. Installe-toi à ton poste, près des baies vitrées.`;
    } else if (d.role === 'office') {
      text = pick(['Le café est au fond, à droite.', 'Ce client change d\'avis tous les jours…', 'Tu as vu le nouveau design ? C\'est propre.', 'Je suis en plein débogage, on se parle à la pause !']);
    } else if (d.role === 'shop') {
      const places = { maquis: 'Viens manger, c\'est bien chaud !', boutique: 'Mon ami, qu\'est-ce qu\'il te faut ?', etal: 'Mes mangues sont bien mûres aujourd\'hui.', atelier: 'J\'ai reçu de nouveaux tissus, viens voir.' };
      text = places[d.place];
      opts.push({ l: d.place === 'atelier' ? 'Voir les vêtements' : 'Acheter', openPlace: d.place });
    } else if (d.role === 'commuter') text = h < 12 ? 'Je file au bureau, je suis déjà en retard !' : 'Longue journée… je rentre.';
    npc.talking = 6;
    s.rels[d.id] = Math.min(100, (s.rels[d.id] || 0) + 2);
    return { text, opts };
  }

  availableMissions() {
    const s = this.state, done = s.missionsDone, out = [];
    for (const m of MISSIONS) if (!done.includes(m.id) && done.length >= m.level) out.push(m);
    const day = dayOf(s.minutes);
    if (!out.length && s.lastMaintDay !== day) out.push(maintenanceMission(day));
    return out.slice(0, 2);
  }

  interviewAnswer(correct) {
    const s = this.state;
    s.job = { employer: 'Babi Digital', title: 'Développeur·se web junior', since: dayOf(s.minutes), earned: 0 };
    this.ui.toast(correct ? 'Mme Kouamé : « Parfait, vous êtes embauché·e ! »' : 'Mme Kouamé : « Hum… on vous donne votre chance. Bienvenue ! »', 'good');
    this.message('Mme Kouamé — Babi Digital', 'Bienvenue dans l\'équipe ! Horaires : 7h–20h. Yannick vous confiera vos missions. Vous êtes payé·e à chaque mission validée.');
    this.checkObjective(); this.save();
  }

  acceptMission(def) {
    const s = this.state;
    if (s.mission) return;
    s.mission = { def: JSON.parse(JSON.stringify(def)), stage: 'accepted', fixed: def.tasks.map(() => false), started: s.minutes };
    if (def.maintenance) s.lastMaintDay = dayOf(s.minutes);
    this.ui.toast(`Mission acceptée : ${def.title}. Va à ton poste.`, 'good');
    this.checkObjective(); this.save();
  }

  /** Une tâche du mini-jeu a été réussie (appelé par l'éditeur). */
  fixTask(i) {
    const m = this.state.mission;
    if (!m || m.fixed[i]) return;
    m.fixed[i] = true; m.stage = 'working';
    this.state.minutes += 45;
    this.state.needs.energie = clamp(this.state.needs.energie - 6, 0, 100);
    this.checkObjective(); this.save();
  }
  spendWorkTime(min) { this.state.minutes += min; this.state.needs.energie = clamp(this.state.needs.energie - min / 15, 0, 100); }
  submitMission() {
    const m = this.state.mission;
    if (!m || !m.fixed.every(Boolean)) return false;
    m.stage = 'done';
    this.ui.toast('Code envoyé ! Va voir Yannick pour faire valider la mission.', 'good');
    this.checkObjective(); this.save();
    return true;
  }
  /** Paiement unique : l'étape passe à « paid » avant de créditer, donc impossible de payer deux fois. */
  validateMission() {
    const s = this.state, m = s.mission;
    if (!m || m.stage !== 'done') return;
    m.stage = 'paid';
    s.missionsDone.push(m.def.id);
    s.job.earned += m.def.pay;
    s.mission = null;
    this.earn(m.def.pay, `Salaire : ${m.def.title} (${m.def.client})`, 'salaire');
    this.ui.toast(`Mission validée. ${fmt(m.def.pay)} versés sur ton compte.`, 'good');
    this.checkObjective(); this.save();
  }

  /* ---------- IA des PNJ ---------- */
  updateNPCs(dt, hour, area) {
    const night = hour >= 22.5 || hour < 5.5;
    for (const npc of this.npcs) {
      const c = npc.ch, d = npc.def;
      const sameArea = npc.area === area;
      let visible = sameArea, speed = 0;
      if (npc.talking > 0) npc.talking -= dt;
      if (d.role === 'walker') {
        visible = sameArea && (!night || d.id === 'ibrahim');
        if (visible && npc.talking <= 0) {
          const dance = hour >= 20.5 && hour < 23.5 && d.id === 'koffi';
          if (dance) {
            const spot = world.maquisCenter.clone().add(new THREE.Vector3(1.4, 0, 0.6));
            if (c.root.position.distanceTo(spot) > 0.5) npc.target = spot; else { npc.target = null; c.setBase('dance'); }
          } else if (c.base === 'dance') c.setBase('idle');
          if (!npc.target) { npc.wait -= dt; if (npc.wait <= 0) npc.target = pick(world.waypoints).clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, (Math.random() - 0.5) * 2)); }
          else { const r = stepToward(c.root, npc.target, c.walkSpeed, dt); speed = r.moved / Math.max(dt, 1e-4); if (r.dist < 0.4 || r.stuck) { npc.target = null; npc.wait = 2 + Math.random() * 7; } }
        }
      } else if (d.role === 'chat') {
        visible = sameArea && hour > 6.5 && hour < 21;
        const other = this.npc(d.id === 'yao' ? 'aya' : 'yao');
        if (visible && npc.talking <= 0) {
          const want = Math.atan2(other.ch.root.position.x - c.root.position.x, other.ch.root.position.z - c.root.position.z);
          c.root.rotation.y += Math.atan2(Math.sin(want - c.root.rotation.y), Math.cos(want - c.root.rotation.y)) * Math.min(1, dt * 3);
          npc.chatT -= dt;
          if (npc.chatT <= 0) { npc.chatT = 3 + Math.random() * 4; c.gesture(pick(['agree', 'no', 'agree'])); if (Math.random() < 0.5 && area === 'outside') this.ui.say(npc, pick(CHAT), 3); }
        }
      } else if (d.role === 'seated') {
        visible = sameArea && hour >= 12 && hour < 23.5;
      } else if (d.role === 'commuter') {
        // matin : arrêt de woro → bureau ; soir : bureau → arrêt
        const door = world.places.office;
        const goWork = hour >= 7.3 && hour < 8.6, goHome = hour >= 17.5 && hour < 19;
        const atWork = hour >= 8.6 && hour < 17.5;
        visible = sameArea && (goWork || goHome || hour < 7.3 || (hour >= 19 && hour < 21));
        if (atWork) visible = false;
        if (visible) {
          const tgt = goWork ? new THREE.Vector3(door.x, 0, door.z) : new THREE.Vector3(d.from[0], 0, d.from[1]);
          if (goHome && !npc.leftOffice) { c.root.position.set(door.x, 0, door.z); npc.leftOffice = true; }
          if (!goHome) npc.leftOffice = false;
          if (npc.talking <= 0 && c.root.position.distanceTo(tgt) > 0.6) { const r = stepToward(c.root, tgt, c.walkSpeed * 1.1, dt); speed = r.moved / Math.max(dt, 1e-4); }
          else if (goWork) visible = false; // entré dans l'immeuble
        }
      } else if (d.role === 'office') {
        visible = sameArea;
        if (visible && npc.talking <= 0 && Math.random() < dt * 0.04 && !npc.seat) c.gesture(pick(['agree', 'no']));
      } else if (d.home && npc.talking <= 0 && sameArea) {
        const hm = d.home();
        if (c.root.position.distanceTo(hm) > 0.5) { const r = stepToward(c.root, hm, c.walkSpeed, dt); speed = r.moved / Math.max(dt, 1e-4); }
        else { const dr = Math.atan2(Math.sin(d.face - c.root.rotation.y), Math.cos(d.face - c.root.rotation.y)); c.root.rotation.y += dr * Math.min(1, dt * 2); }
        if (Math.random() < dt * 0.03) c.gesture(pick(['agree', 'no']));
      }
      c.root.visible = visible;
      if (!visible) continue;
      if (!c.sitting) c.root.position.y = THREE.MathUtils.lerp(c.root.position.y, heightAt(c.root.position.x, c.root.position.z), Math.min(1, dt * 10));
      c.update(dt, speed);
      if (area === 'outside' && npc.talking <= 0 && d.role !== 'chat' && Math.random() < dt * 0.008) this.ui.say(npc, pick(LINES), 3.5);
    }
  }
}

/* ---------- déplacement des PNJ avec contournement d'obstacles ---------- */
export function nextWaypoint(pos, target, r = 0.3) {
  const hit = world.colliders.find(o => segHitsBox(pos.x, pos.z, target.x, target.z, o, r));
  if (!hit) return target;
  const m = r + 0.35;
  const corners = [[hit.x0 - m, hit.z0 - m], [hit.x1 + m, hit.z0 - m], [hit.x0 - m, hit.z1 + m], [hit.x1 + m, hit.z1 + m]];
  let best = null, bestD = Infinity;
  for (const [cx, cz] of corners) {
    if (Math.hypot(cx - pos.x, cz - pos.z) < 0.25 || segHitsBox(pos.x, pos.z, cx, cz, hit, r)) continue;
    const dd = Math.hypot(cx - pos.x, cz - pos.z) + Math.hypot(target.x - cx, target.z - cz) + (segHitsBox(cx, cz, target.x, target.z, hit, r) ? 12 : 0);
    if (dd < bestD) { bestD = dd; best = new THREE.Vector3(cx, 0, cz); }
  }
  return best || target;
}
export function stepToward(obj, target, speed, dt, r = 0.3, isNpc = true) {
  const pos = obj.position;
  const wp = nextWaypoint(pos, target, r);
  const dx = wp.x - pos.x, dz = wp.z - pos.z;
  const dist = Math.hypot(dx, dz);
  const total = Math.hypot(target.x - pos.x, target.z - pos.z);
  if (dist < 0.02) return { dist: total, moved: 0, stuck: total > 0.4 };
  const step = Math.min(dist, speed * dt);
  const nx = pos.x + dx / dist * step, nz = pos.z + dz / dist * step;
  const ox = pos.x, oz = pos.z;
  if (!blocked(nx, nz, r, isNpc)) { pos.x = nx; pos.z = nz; }
  else if (!blocked(nx, pos.z, r, isNpc)) pos.x = nx;
  else if (!blocked(pos.x, nz, r, isNpc)) pos.z = nz;
  const moved = Math.hypot(pos.x - ox, pos.z - oz);
  const want = Math.atan2(dx, dz);
  obj.rotation.y += Math.atan2(Math.sin(want - obj.rotation.y), Math.cos(want - obj.rotation.y)) * Math.min(1, dt * 8);
  return { dist: Math.hypot(target.x - pos.x, target.z - pos.z), moved, stuck: moved < step * 0.2 };
}
