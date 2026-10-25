// Poste de travail : éditeur de code où le joueur corrige réellement les bugs de sa mission.
import { clockOf } from './game.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export class Editor {
  constructor(game, hooks) {
    this.game = game; this.hooks = hooks; this.open = false;
    $('edPause').onclick = () => this.close();
    $('edHint').onclick = () => this.hint();
    $('edTest').onclick = () => this.runTests();
    $('edPush').onclick = () => this.push();
  }
  get m() { return this.game.state.mission; }

  start() {
    const m = this.m;
    if (!m) return;
    this.open = true; this.cur = m.fixed.findIndex(f => !f); if (this.cur < 0) this.cur = 0;
    this.sel = null; this.tested = m.fixed.every(Boolean) && m.stage === 'done';
    $('editor').hidden = false;
    $('edTerm').innerHTML = `<span class="info">babi@poste-06</span>:~/clients/${m.def.client.toLowerCase().replace(/[^a-z]+/g, '-')}$ git pull\nDéjà à jour.\n`;
    $('edTitle').textContent = `${m.def.title} — ${m.def.client}`;
    $('edMission').innerHTML = `<b>${esc(m.def.title)}</b><br>${esc(m.def.brief)}<br><br>Paiement à la validation : <b>${m.def.pay.toLocaleString('fr-FR')} FCFA</b>`;
    this.render();
  }
  close() {
    this.open = false; $('editor').hidden = true;
    this.hooks.onClose();
  }

  render() {
    const m = this.m, t = m.def.tasks[this.cur], s = this.game.state;
    $('edTime').textContent = `${clockOf(s.minutes)} · Énergie ${Math.round(s.needs.energie)}%`;
    $('edEnergy').style.width = s.needs.energie + '%';
    $('edEnergy').style.background = s.needs.energie > 30 ? '#4fbf74' : '#e2513f';
    $('edTasks').innerHTML = m.def.tasks.map((x, i) => `<div class="ed-task ${i === this.cur ? 'cur' : ''} ${m.fixed[i] ? 'ok' : ''}" data-i="${i}"><span class="chk"></span><span>${esc(x.goal)}</span></div>`).join('');
    $('edTasks').querySelectorAll('.ed-task').forEach(el => el.onclick = () => { this.cur = +el.dataset.i; this.sel = null; this.render(); });
    $('edTab').textContent = '📄 ' + t.file;
    $('edGoal').textContent = m.fixed[this.cur] ? '✓ Corrigé. Passe au ticket suivant.' : `Ticket : ${t.goal} — Clique sur la ligne qui pose problème.`;
    const lines = t.lines.map((l, i) => (m.fixed[this.cur] && i === t.bug) ? t.options[t.correct] : l);
    $('edLines').innerHTML = lines.map((l, i) => `<div class="ln ${m.fixed[this.cur] && i === t.bug ? 'fixed' : ''} ${this.sel === i ? 'sel' : ''} ${this.hintLine === i && !m.fixed[this.cur] ? 'hint' : ''}" data-i="${i}"><span class="no">${i + 1}</span><span>${esc(l) || ' '}</span></div>`).join('');
    $('edLines').querySelectorAll('.ln').forEach(el => el.onclick = () => this.pickLine(+el.dataset.i, el));
    $('edFix').hidden = true;
    const all = m.fixed.every(Boolean);
    $('edTest').disabled = !all || this.tested;
    $('edTest').hidden = this.tested;
    $('edPush').hidden = !this.tested || m.stage === 'done';
    $('edHint').disabled = m.fixed[this.cur];
  }

  tired() {
    if (this.game.state.needs.energie < 8) { this.hooks.toast('Tu es épuisé·e : impossible de te concentrer. Va te reposer ou prends un café.', 'bad'); return true; }
    return false;
  }

  pickLine(i, el) {
    const m = this.m, t = m.def.tasks[this.cur];
    if (m.fixed[this.cur] || this.tired()) return;
    this.hooks.sound('key');
    if (i !== t.bug) {
      el.classList.add('bad'); setTimeout(() => el.classList.remove('bad'), 400);
      this.game.spendWorkTime(10);
      this.log(`<span class="ko">✗ Ligne ${i + 1} : rien d'anormal ici. (−10 min)</span>`);
      this.render(); return;
    }
    this.sel = i; this.render();
    const fx = $('edFix'); fx.hidden = false;
    fx.innerHTML = `<div class="q">Ligne ${i + 1} : choisis le bon correctif</div>` + t.options.map((o, k) => `<button class="ed-opt" data-k="${k}">${esc(o) || '(supprimer la ligne)'}</button>`).join('');
    fx.querySelectorAll('.ed-opt').forEach(b => b.onclick = () => this.pickFix(+b.dataset.k));
  }

  pickFix(k) {
    const m = this.m, t = m.def.tasks[this.cur];
    if (this.tired()) return;
    this.hooks.sound('key');
    if (k !== t.correct) {
      this.game.spendWorkTime(15);
      this.log(`<span class="ko">✗ npm test → 1 test en échec : « ${esc(t.goal)} » (−15 min)</span>`);
      this.render(); return;
    }
    this.game.fixTask(this.cur);
    this.log(`<span class="ok">✓ ${esc(t.file)} corrigé.</span> ${esc(t.explain)}`);
    this.hintLine = null; this.sel = null;
    const next = m.fixed.findIndex(f => !f);
    if (next >= 0) this.cur = next;
    this.render();
    if (next < 0) this.log('<span class="info">Tous les tickets sont corrigés. Lance les tests.</span>');
  }

  hint() {
    const m = this.m, t = m.def.tasks[this.cur];
    if (m.fixed[this.cur]) return;
    this.game.spendWorkTime(20);
    this.hintLine = t.bug;
    this.log(`<span class="info">Indice : regarde la ligne ${t.bug + 1}. (−20 min)</span>`);
    this.render();
  }

  runTests() {
    const m = this.m;
    if (!m.fixed.every(Boolean)) return;
    $('edTest').disabled = true;
    this.game.spendWorkTime(20);
    const lines = ['$ npm test', ...m.def.tasks.map(t => `  ✓ ${t.goal.replace(/\.$/, '')} — corrigé`), '', `Tests : ${m.def.tasks.length} réussis, 0 en échec`];
    let i = 0;
    const step = () => {
      if (i < lines.length) { this.log(i === 0 ? `<span class="info">${lines[i]}</span>` : lines[i].startsWith('  ✓') ? `<span class="ok">${esc(lines[i])}</span>` : esc(lines[i])); i++; this.hooks.sound('key'); setTimeout(step, 260); }
      else { this.tested = true; this.render(); }
    };
    step();
  }

  push() {
    if (!this.tested) return;
    this.game.spendWorkTime(10);
    this.log('<span class="info">$ git push origin main</span>\nÉcriture des objets : 100% — déployé en production.');
    if (this.game.submitMission()) { this.hooks.sound('objective'); this.render(); setTimeout(() => this.close(), 1600); }
  }

  log(html) { const t = $('edTerm'); t.innerHTML += html + '\n'; t.scrollTop = t.scrollHeight; }
}
