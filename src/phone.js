// Téléphone du joueur : point d'accès aux missions, à l'emploi, à l'argent, à la carte et au personnage.
import { world } from './world.js';
import { OBJECTIVES, fmt, dayOf, clockOf, hourOf, OFFICE_HOURS, TAXI_PRICE } from './game.js';
import { CLOTHES, ACCESSORIES, HAIR_STYLES } from './appearance.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const APPS = [
  { id: 'messages', name: 'Messages', ic: '💬', bg: '#2e9e5b' },
  { id: 'missions', name: 'Missions', ic: '🎯', bg: '#f08a24' },
  { id: 'job', name: 'Emploi', ic: '💼', bg: '#3b6fd8' },
  { id: 'money', name: 'Argent', ic: '💰', bg: '#c99a1e' },
  { id: 'map', name: 'Carte', ic: '🗺️', bg: '#18a3a3' },
  { id: 'me', name: 'Personnage', ic: '🙂', bg: '#8e5bd8' },
];

export class Phone {
  constructor(game, hooks) {
    this.game = game; this.hooks = hooks; this.view = 'home'; this.open = false;
    $('phBack').onclick = () => this.show('home');
    $('phHome').onclick = () => this.show('home');
    $('phClose').onclick = () => this.toggle(false);
    $('phone').addEventListener('pointerdown', e => { if (e.target.id === 'phone') this.toggle(false); });
  }
  toggle(force) {
    this.open = force ?? !this.open;
    $('phone').hidden = !this.open;
    if (this.open) { this.hooks.sound('click'); this.show(this.view === 'map' ? 'map' : 'home'); }
  }
  unread() { return this.game.state.messages.filter(m => !m.read).length; }
  show(view) {
    this.view = view;
    const s = this.game.state;
    $('phClock').textContent = clockOf(s.minutes);
    $('phBack').style.visibility = view === 'home' ? 'hidden' : 'visible';
    const el = $('phScreen');
    el.innerHTML = this['v_' + view]();
    if (view === 'map') this.drawMap();
    el.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { this.hooks.sound('click'); this.show(b.dataset.go); });
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => this.act(b.dataset.act, b.dataset.arg));
    this.hooks.badge();
  }
  refresh() { if (this.open) this.show(this.view); }

  act(a, arg) {
    const g = this.game;
    if (a === 'payrent') { g.payRent('phone'); this.show('money'); }
    if (a === 'gps') { const p = this.places().find(p => p.id === arg); g.gps = p ? { x: p.x, z: p.z, label: p.name } : null; this.hooks.sound('click'); this.show('map'); }
    if (a === 'gpsoff') { g.gps = null; this.show('map'); }
    if (a === 'taxi') { const d = g.destinations().find(d => d.id === arg); this.toggle(false); g.travel(d, 'taxi'); }
  }

  /* ---------- vues ---------- */
  v_home() {
    const s = this.game.state, u = this.unread();
    return `<div style="text-align:center;margin-top:24px"><div style="font-size:54px;font-weight:300;font-variant-numeric:tabular-nums">${clockOf(s.minutes)}</div>
      <div style="color:var(--muted);font-weight:600">Jour ${dayOf(s.minutes)} · Marcory</div></div>
      <div class="ph-grid">${APPS.map(a => `<button class="ph-app" data-go="${a.id}"><span class="ph-ic" style="background:${a.bg}">${a.ic}</span>${a.name}${a.id === 'messages' && u ? `<span class="badge">${u}</span>` : ''}</button>`).join('')}</div>
      <div class="ph-card" style="margin-top:26px"><div class="ph-k" style="margin-top:0">Objectif</div><b>${esc(this.objective().t)}</b><br><span style="color:#bbb">${esc(this.objective().d)}</span></div>`;
  }
  objective() { const s = this.game.state; return s.obj < OBJECTIVES.length ? OBJECTIVES[s.obj] : { t: 'Profite de ta vie à Marcory', d: 'Enchaîne les missions, garde la forme et fais-toi plaisir.' }; }

  v_messages() {
    const s = this.game.state;
    const list = [...s.messages].reverse().map(m => `<div class="ph-msg ${m.read ? '' : 'unread'}"><div class="from"><span>${esc(m.from)}</span><small>J${dayOf(m.t)} ${clockOf(m.t)}</small></div><p>${esc(m.text)}</p></div>`).join('');
    s.messages.forEach(m => { m.read = true; if (m.id === 'welcome') s.flags.readWelcome = true; });
    setTimeout(() => this.game.checkObjective(), 0);
    return `<div class="ph-h">Messages</div>${list || '<p>Aucun message.</p>'}`;
  }

  v_missions() {
    const s = this.game.state, m = s.mission;
    let h = `<div class="ph-h">Missions</div>`;
    h += `<div class="ph-card"><div class="ph-k" style="margin-top:0">Objectif principal</div><b>${esc(this.objective().t)}</b><br>${esc(this.objective().d)}</div>`;
    if (m) {
      const n = m.fixed.filter(Boolean).length;
      const stage = { accepted: 'À démarrer à ton poste', working: 'En cours', done: 'Terminée — à faire valider par Yannick' }[m.stage];
      h += `<div class="ph-card"><div class="ph-k" style="margin-top:0">Mission en cours</div><b>${esc(m.def.title)}</b> — ${esc(m.def.client)}<br>${esc(m.def.brief)}
        <div class="ph-row"><span>État</span><span>${stage}</span></div><div class="ph-row"><span>Bugs corrigés</span><span>${n} / ${m.fixed.length}</span></div>
        <div class="ph-row"><span>Paiement à la validation</span><span class="amt pos">${fmt(m.def.pay)}</span></div>
        <ul class="ph-steps">${m.def.tasks.map((t, i) => `<li class="${m.fixed[i] ? 'ok' : ''}">${esc(t.goal)}</li>`).join('')}</ul></div>`;
    } else if (s.job) {
      const av = this.game.availableMissions();
      h += `<div class="ph-k">Disponibles (à accepter auprès de Yannick)</div>` + (av.length ? av.map(x => `<div class="ph-card"><b>${esc(x.title)}</b> — ${esc(x.client)}<div class="ph-row"><span>${x.tasks.length} bugs</span><span class="amt pos">${fmt(x.pay)}</span></div></div>`).join('') : '<div class="ph-card">Aucune mission pour aujourd\'hui. Reviens demain.</div>');
    } else h += `<div class="ph-card">Tu n'as pas encore d'emploi. Babi Digital recrute : passe à l'accueil.</div>`;
    if (s.missionsDone.length) h += `<div class="ph-k">Terminées</div><div class="ph-card">${s.missionsDone.length} mission(s) validée(s).</div>`;
    return h;
  }

  v_job() {
    const s = this.game.state, j = s.job, [o, c] = OFFICE_HOURS;
    if (!j) return `<div class="ph-h">Emploi</div><div class="ph-card"><div class="ph-k" style="margin-top:0">Annonce</div><b>Babi Digital recrute</b><br>Développeur·se web junior (HTML, CSS, JavaScript). Paiement à la mission, de 15 000 à 32 000 FCFA.<br><br>Se présenter à l'accueil, rue de la Lagune, de ${o}h à ${c}h.</div><button class="ph-btn ghost" data-act="gps" data-arg="office">Itinéraire vers Babi Digital</button>`;
    const avg = s.missionsDone.length ? j.earned / s.missionsDone.length : 0;
    return `<div class="ph-h">Emploi</div><div class="ph-card"><b>${esc(j.title)}</b><br>${esc(j.employer)} · depuis le jour ${j.since}
      <div class="ph-row"><span>Horaires</span><span>${o}h – ${c}h</span></div>
      <div class="ph-row"><span>Responsable</span><span>Yannick</span></div>
      <div class="ph-row"><span>Missions validées</span><span>${s.missionsDone.length}</span></div>
      <div class="ph-row"><span>Total perçu</span><span class="amt pos">${fmt(j.earned)}</span></div>
      <div class="ph-row"><span>Moyenne par mission</span><span>${fmt(avg)}</span></div></div>
      <div class="ph-card">Le salaire est versé à chaque mission validée par le responsable technique.</div>`;
  }

  v_money() {
    const s = this.game.state, r = s.rent;
    s.flags.viewedMoney = true; setTimeout(() => this.game.checkObjective(), 0);
    const spent = s.history.filter(h => h.amount < 0).reduce((a, h) => a - h.amount, 0);
    const earned = s.history.filter(h => h.amount > 0 && h.cat !== 'revenu').reduce((a, h) => a + h.amount, 0);
    const late = r.late ? '<span style="color:#ff9b8c;font-weight:800"> · EN RETARD</span>' : '';
    return `<div class="ph-h">Argent</div>
      <div class="ph-card"><div class="ph-k" style="margin-top:0">Solde</div><div class="ph-big">${fmt(s.money)}</div>
      <div class="ph-row"><span>Gagné (salaires)</span><span class="amt pos">${fmt(earned)}</span></div><div class="ph-row"><span>Dépensé</span><span class="amt neg">${fmt(spent)}</span></div></div>
      <div class="ph-card"><div class="ph-k" style="margin-top:0">Loyer du studio</div><b>${fmt(r.amount)}</b> avant la fin du jour ${r.dueDay}${late}
      <button class="ph-btn" data-act="payrent" ${s.money < r.amount ? 'disabled' : ''}>Payer par mobile money</button></div>
      <div class="ph-k">Historique</div>
      ${[...s.history].reverse().slice(0, 40).map(h => `<div class="ph-row"><span>${esc(h.label)}<small>Jour ${dayOf(h.t)} · ${clockOf(h.t)} · ${esc(h.cat)}</small></span><span class="amt ${h.amount >= 0 ? 'pos' : 'neg'}">${h.amount >= 0 ? '+' : '−'}${fmt(Math.abs(h.amount))}</span></div>`).join('')}`;
  }

  v_me() {
    const s = this.game.state, n = s.needs;
    const bar = (v, c) => `<div class="ph-bar"><i style="width:${v}%;background:${c}"></i></div>`;
    return `<div class="ph-h">${esc(s.name)} ${esc(s.lastName || '')}</div>
      <div class="ph-card"><div class="ph-row"><span>Métier</span><span>${s.job ? esc(s.job.title) : 'Sans emploi'}</span></div>
      <div class="ph-row"><span>Logement</span><span>Studio, Cour Kouassi</span></div>
      <div class="ph-row"><span>Tenue</span><span>${esc(CLOTHES.top.find(t => t.id === s.look.top.style)?.name || '')}</span></div>
      <div class="ph-row"><span>Coiffure</span><span>${esc(HAIR_STYLES[s.look.gender].find(h => h.id === s.look.hair.style)?.name || '')}</span></div>
      <div class="ph-row"><span>Jour</span><span>${dayOf(s.minutes)}</span></div></div>
      <div class="ph-card">Énergie ${Math.round(n.energie)}%${bar(n.energie, '#4fbf74')}<br>Faim ${Math.round(n.faim)}%${bar(n.faim, '#e9b23c')}</div>
      <div class="ph-card"><div class="ph-k" style="margin-top:0">Équipement du studio</div>${s.upgrades.fan ? '✓ Ventilateur' : '✗ Ventilateur'}<br>${s.upgrades.mattress ? '✓ Matelas neuf' : '✗ Matelas neuf'}</div>
      <div class="ph-card"><div class="ph-k" style="margin-top:0">Articles achetés</div>${s.look.owned.length ? s.look.owned.map(id => esc([...CLOTHES.top, ...CLOTHES.bottom, ...CLOTHES.shoes, ...Object.values(ACCESSORIES).flat()].find(i => i.id === id)?.name || id)).join('<br>') : 'Aucun pour l\'instant.'}</div>`;
  }

  places() {
    const H = world.hotspots, P = world.places;
    return [
      { id: 'home', name: 'Ton studio', x: P.home.x, z: P.home.z, c: '#8fe3a8' },
      { id: 'office', name: 'Babi Digital', x: P.office.x, z: P.office.z, c: '#f08a24' },
      { id: 'maquis', name: "Maquis d'Awa", x: H.maquis.pos.x, z: -5.4, c: '#ff6b5a' },
      { id: 'boutique', name: 'Boutique Moussa', x: H.boutique.pos.x, z: H.boutique.pos.z, c: '#ffd36a' },
      { id: 'atelier', name: 'Atelier Élégance', x: H.atelier.pos.x, z: H.atelier.pos.z, c: '#c79bff' },
      { id: 'etal', name: 'Étal Adjoua', x: H.etal.pos.x, z: H.etal.pos.z, c: '#ffd36a' },
      { id: 'woro_cour', name: 'Woro-woro (cour)', x: P.woro_cour.x, z: P.woro_cour.z, c: '#f2c230' },
      { id: 'woro_bureau', name: 'Woro-woro (bureau)', x: P.woro_bureau.x, z: P.woro_bureau.z, c: '#f2c230' },
      { id: 'alouer', name: 'Local à louer', x: H.alouer.pos.x, z: H.alouer.pos.z, c: '#9fd3e6' },
    ];
  }

  v_map() {
    const g = this.game, out = world.area === 'outside';
    const taxi = out ? g.destinations().map(d => `<button class="ph-btn ghost" data-act="taxi" data-arg="${d.id}">Taxi → ${esc(d.name)} · ${fmt(TAXI_PRICE)}</button>`).join('') : '<div class="ph-card">Sors pour commander un taxi.</div>';
    return `<div class="ph-h">Carte</div><canvas id="phMap" width="700" height="330"></canvas>
      <div class="ph-k">GPS : touche un lieu</div>
      <div class="ph-legend">${this.places().map(p => `<button class="${g.gps && g.gps.label === p.name ? 'on' : ''}" data-act="gps" data-arg="${p.id}">${esc(p.name)}</button>`).join('')}${g.gps ? '<button data-act="gpsoff">✕ Effacer</button>' : ''}</div>
      <div class="ph-k">Commander un taxi</div>${taxi}`;
  }

  drawMap() {
    const c = $('phMap'); if (!c) return;
    const g = c.getContext('2d'), W = c.width, Hh = c.height;
    const X0 = -46, X1 = 46, Z0 = -22, Z1 = 20;
    const sx = x => (x - X0) / (X1 - X0) * W, sz = z => (z - Z0) / (Z1 - Z0) * Hh;
    g.fillStyle = '#8f5a3c'; g.fillRect(0, 0, W, Hh);                       // latérite
    g.fillStyle = '#2b6f86'; g.fillRect(0, sz(15.8), W, Hh);                 // lagune
    g.fillStyle = '#d9c49a'; g.fillRect(sx(11), sz(15.6), sx(46) - sx(11), sz(18) - sz(15.6));
    g.fillStyle = '#4a7a3a'; for (const a of world.grassAreas || []) g.fillRect(sx(a.x0), sz(a.z0), sx(a.x1) - sx(a.x0), sz(a.z1) - sz(a.z0));
    g.fillStyle = '#3c3f44'; g.fillRect(0, sz(-3.5), W, sz(3.5) - sz(-3.5)); // route
    g.fillStyle = '#9a958c'; g.fillRect(0, sz(-6.95), W, sz(-4.3) - sz(-6.95));
    g.strokeStyle = '#d8d2c0'; g.setLineDash([10, 12]); g.lineWidth = 2; g.beginPath(); g.moveTo(0, sz(0)); g.lineTo(W, sz(0)); g.stroke(); g.setLineDash([]);
    g.fillStyle = '#d8d0c2';
    for (const b of world.colliders) if (b.h > 2 && b.x1 > X0 && b.x0 < X1 && b.z1 > Z0 && b.z0 < Z1 && b.x0 < 200) g.fillRect(sx(b.x0), sz(b.z0), sx(b.x1) - sx(b.x0), sz(b.z1) - sz(b.z0));
    g.font = '700 13px Inter'; g.textAlign = 'center';
    for (const p of this.places()) {
      g.fillStyle = p.c; g.beginPath(); g.arc(sx(p.x), sz(p.z), 7, 0, 7); g.fill();
      g.strokeStyle = '#111'; g.lineWidth = 2; g.stroke();
      const ly = sz(p.z) + (p.z > 0 ? 22 : -12); g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,.85)'; g.lineWidth = 4; g.strokeText(p.name, sx(p.x), ly); g.fillText(p.name, sx(p.x), ly);
    }
    const t = this.hooks.target();
    if (t) { g.strokeStyle = '#ffd08a'; g.lineWidth = 3; g.beginPath(); g.arc(sx(t.x), sz(t.z), 13, 0, 7); g.stroke(); }
    // joueur (position extérieure, même s'il est dans un bâtiment)
    const pp = this.hooks.playerMapPos();
    g.save(); g.translate(sx(pp.x), sz(pp.z)); g.rotate(-pp.rot + Math.PI);
    g.fillStyle = '#4fd1ff'; g.beginPath(); g.moveTo(0, -12); g.lineTo(8, 9); g.lineTo(0, 4); g.lineTo(-8, 9); g.closePath(); g.fill(); g.strokeStyle = '#06222e'; g.lineWidth = 2; g.stroke();
    g.restore();
    c.onclick = e => {
      const r = c.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * Hh;
      let best = null, bd = 30;
      for (const p of this.places()) { const d = Math.hypot(sx(p.x) - x, sz(p.z) - y); if (d < bd) { bd = d; best = p; } }
      if (best) this.act('gps', best.id);
    };
  }
}
