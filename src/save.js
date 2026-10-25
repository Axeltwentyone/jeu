// Sauvegarde. Le jeu ne parle qu'à cette interface : on pourra brancher un fournisseur serveur
// (fetch vers une API) sans toucher au reste, tant qu'il expose load / save / clear.
const KEY = 'babi-save-v2';
export const SAVE_VERSION = 4;
import { defaultAppearance, normalizeLook } from './appearance.js';

export const localProvider = {
  load() { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } },
  save(data) { try { localStorage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; } },
  clear() { try { localStorage.removeItem(KEY); } catch {} },
};

let provider = localProvider;
export function setSaveProvider(p) { provider = p; }

export function saveGame(state) {
  return provider.save({ ...state, v: SAVE_VERSION, savedAt: Date.now() });
}
export function loadGame() {
  const s = provider.load();
  if (!s) return null;
  if (s.v === 2) { // migration : l'apparence détaillée remplace teint + tenue
    s.look = Object.assign(defaultAppearance(s.gender), { skin: s.skin || defaultAppearance(s.gender).skin });
    s.lastName = ''; delete s.outfit; delete s.outfitsOwned; delete s.skin;
    s.v = 3;
  }
  if (s.v === 3) { // migration : nouveaux personnages MakeHuman, articles renommés (achats conservés tels quels)
    s.look = normalizeLook(s.look);
    s.v = SAVE_VERSION;
  }
  if (s.v !== SAVE_VERSION || !s.look) return null;
  return s;
}
export function clearGame() { provider.clear(); }
