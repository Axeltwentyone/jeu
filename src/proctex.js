// Textures générées : enseignes peintes, pagnes wax, feuilles, façades.
import * as THREE from 'three';

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function toTex(c, srgb = true, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
function rng(seed) { let s = seed >>> 0 || 1; return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296; }

/** Salissures : bruit, coulures, éclats — pour vieillir une peinture. */
function weather(g, w, h, r, amount = 1) {
  // grain
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * 26 * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  // coulures de pluie (fréquentes sous les tropiques)
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 40 * amount; i++) {
    const x = r() * w, y = r() * h * 0.6, len = h * (0.2 + r() * 0.8);
    const grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, `rgba(90,70,50,${0.18 * amount})`); grd.addColorStop(1, 'rgba(90,70,50,0)');
    g.fillStyle = grd; g.fillRect(x, y, 1 + r() * 3, len);
  }
  // taches
  for (let i = 0; i < 18 * amount; i++) {
    g.fillStyle = `rgba(${110 + r() * 40},${90 + r() * 30},${70},${0.08 + r() * 0.12})`;
    g.beginPath(); g.ellipse(r() * w, r() * h, 10 + r() * 60, 6 + r() * 30, r() * 3, 0, 7); g.fill();
  }
  g.globalCompositeOperation = 'source-over';
  // écaillures
  for (let i = 0; i < 26 * amount; i++) {
    g.fillStyle = `rgba(225,215,195,${0.35 + r() * 0.4})`;
    const x = r() * w, y = r() * h, s = 2 + r() * 9;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) g.lineTo(x + (r() - 0.5) * s * 2, y + (r() - 0.5) * s * 2);
    g.fill();
  }
}

/**
 * Enseigne peinte à la main.
 * lines: [{ text, font, color, size }] ; bg: couleur ou dégradé
 */
export function paintedSign({ w = 1024, h = 256, bg = '#1c5aa6', lines = [], border = '#f2f2f2', seed = 1, art, wear = 1 }) {
  const [c, g] = canvas(w, h);
  const r = rng(seed);
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  if (border) { g.strokeStyle = border; g.lineWidth = h * 0.035; g.strokeRect(h * 0.05, h * 0.05, w - h * 0.1, h - h * 0.1); }
  if (art) art(g, w, h, r);
  let total = lines.reduce((s, l) => s + l.size * h, 0) * 1.08;
  let y = (h - total) / 2;
  for (const l of lines) {
    const size = l.size * h;
    g.font = `${l.weight || ''} ${size}px ${l.font || 'Anton'}`;
    let fs = size;
    while (g.measureText(l.text).width > w * 0.9 && fs > 10) { fs -= 2; g.font = `${l.weight || ''} ${fs}px ${l.font || 'Anton'}`; }
    g.textAlign = 'center'; g.textBaseline = 'top';
    if (l.shadow) { g.fillStyle = l.shadow; g.fillText(l.text, w / 2 + size * 0.04, y + size * 0.05); }
    g.fillStyle = l.color || '#fff';
    // léger tremblé du pinceau
    g.save(); g.translate(w / 2, y); g.rotate((r() - 0.5) * 0.015); g.fillText(l.text, 0, 0); g.restore();
    y += size * 1.08;
  }
  weather(g, w, h, r, wear);
  return toTex(c);
}

/** Pagne wax : motifs géométriques à fortes couleurs, tuilables. */
const WAX_PALETTES = [
  ['#1d2f6f', '#f2a81d', '#e4572e', '#f5f1e6'],
  ['#0f5e3c', '#f6c90e', '#d7263d', '#1b1b1b'],
  ['#6a1b9a', '#ff8f00', '#00897b', '#fff8e1'],
  ['#b71c1c', '#1565c0', '#fbc02d', '#fafafa'],
  ['#004d40', '#ff7043', '#ffd54f', '#263238'],
  ['#283593', '#26a69a', '#ef6c00', '#f3e5f5'],
];
export function waxTexture(seed = 1, size = 512) {
  const [c, g] = canvas(size, size);
  const r = rng(seed * 7919);
  const [a, b, cc, dd] = WAX_PALETTES[seed % WAX_PALETTES.length];
  g.fillStyle = a; g.fillRect(0, 0, size, size);
  const n = 4, s = size / n;
  const type = seed % 4;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const x = i * s + s / 2, y = j * s + s / 2, alt = (i + j) % 2;
    g.save(); g.translate(x, y);
    if (type === 0) { // cercles concentriques
      for (let k = 4; k > 0; k--) { g.fillStyle = [b, cc, dd, a][(k + alt) % 4]; g.beginPath(); g.arc(0, 0, s * 0.11 * k, 0, 7); g.fill(); }
    } else if (type === 1) { // feuilles / gouttes
      for (let k = 0; k < 6; k++) { g.rotate(Math.PI / 3); g.fillStyle = alt ? b : cc; g.beginPath(); g.ellipse(0, s * 0.22, s * 0.08, s * 0.2, 0, 0, 7); g.fill(); }
      g.fillStyle = dd; g.beginPath(); g.arc(0, 0, s * 0.08, 0, 7); g.fill();
    } else if (type === 2) { // losanges
      g.rotate(Math.PI / 4); g.fillStyle = alt ? b : dd; g.fillRect(-s * 0.3, -s * 0.3, s * 0.6, s * 0.6);
      g.fillStyle = cc; g.fillRect(-s * 0.15, -s * 0.15, s * 0.3, s * 0.3);
    } else { // éventails
      for (let k = 0; k < 5; k++) { g.fillStyle = [b, cc, dd][k % 3]; g.beginPath(); g.moveTo(0, s * 0.3); g.arc(0, s * 0.3, s * (0.5 - k * 0.09), -Math.PI * 0.9, -Math.PI * 0.1); g.fill(); }
    }
    g.restore();
  }
  // effet "crack" de la cire
  g.globalAlpha = 0.18; g.strokeStyle = dd; g.lineWidth = 1.2;
  for (let i = 0; i < 70; i++) { g.beginPath(); let x = r() * size, y = r() * size; g.moveTo(x, y); for (let k = 0; k < 5; k++) { x += (r() - 0.5) * 40; y += (r() - 0.5) * 40; g.lineTo(x, y); } g.stroke(); }
  g.globalAlpha = 1;
  // trame tissu
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const k = (y * size + x) * 4, t = ((x % 3 === 0) || (y % 3 === 0)) ? -10 : 4;
    d[k] += t; d[k + 1] += t; d[k + 2] += t;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, true, true);
}

/** Feuille (alpha) pour les feuillages instanciés. */
export function leafTexture(kind = 'mango') {
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  const draw = (cx, cy, len, wid, ang, col) => {
    g.save(); g.translate(cx, cy); g.rotate(ang);
    const grd = g.createLinearGradient(-wid, 0, wid, 0);
    grd.addColorStop(0, col[0]); grd.addColorStop(0.5, col[1]); grd.addColorStop(1, col[0]);
    g.fillStyle = grd;
    g.beginPath(); g.moveTo(0, 0);
    g.bezierCurveTo(wid, -len * 0.25, wid * 0.8, -len * 0.75, 0, -len);
    g.bezierCurveTo(-wid * 0.8, -len * 0.75, -wid, -len * 0.25, 0, 0);
    g.fill();
    g.strokeStyle = 'rgba(200,220,150,.5)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(0, -len * 0.95); g.stroke();
    g.restore();
  };
  if (kind === 'mango') {
    // bouquet de feuilles allongées, vert profond et brillant
    const cols = [['#1f4a17', '#3b7a26'], ['#234f1a', '#468a2d'], ['#2c5e1f', '#5a9a35']];
    for (let i = 0; i < 7; i++) draw(128 + (Math.random() - 0.5) * 40, 236, 150 + Math.random() * 60, 22 + Math.random() * 8, (i - 3) * 0.32 + (Math.random() - 0.5) * 0.2, cols[i % 3]);
  } else {
    draw(128, 250, 240, 70, 0, ['#2f5f22', '#5c9a3a']);
  }
  return toTex(c);
}

/** Façade de tour la nuit (fenêtres allumées) pour la skyline du Plateau. */
export function towerTextures(seed = 1, cols = 8, rows = 24) {
  const [c, g] = canvas(256, 512);
  const [e, ge] = canvas(256, 512);
  const r = rng(seed * 31);
  g.fillStyle = '#8b98a3'; g.fillRect(0, 0, 256, 512);
  ge.fillStyle = '#000'; ge.fillRect(0, 0, 256, 512);
  const cw = 256 / cols, rh = 512 / rows;
  for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
    const shade = 40 + r() * 40;
    g.fillStyle = `rgb(${shade},${shade + 10},${shade + 22})`;
    g.fillRect(i * cw + 2, j * rh + 3, cw - 4, rh - 6);
    if (r() < 0.42) { ge.fillStyle = r() < 0.7 ? '#ffd9a0' : '#cfe6ff'; ge.globalAlpha = 0.5 + r() * 0.5; ge.fillRect(i * cw + 2, j * rh + 3, cw - 4, rh - 6); ge.globalAlpha = 1; }
  }
  return { map: toTex(c, true, true), emissive: toTex(e, true, true) };
}
