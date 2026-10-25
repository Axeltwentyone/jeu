// Missions de développeur web. Chaque tâche = un vrai bug dans un extrait de code :
// le joueur doit trouver la ligne fautive, puis choisir le bon correctif.

export const MISSIONS = [
  {
    id: 'm1', title: 'Formulaire de contact', client: "Maquis Le Jardin d'Awa", pay: 18000, level: 0,
    brief: "Tantie Awa ne reçoit plus les réservations envoyées depuis son site. Le formulaire de contact est cassé.",
    tasks: [
      {
        file: 'contact.js', goal: 'Les numéros ivoiriens valides (10 chiffres) sont refusés.',
        lines: [
          'function validerFormulaire(form) {',
          '  const nom = form.nom.value.trim();',
          '  const tel = form.telephone.value.replace(/\\s/g, "");',
          '  if (nom.length < 2) {',
          '    return erreur("Indique ton nom");',
          '  }',
          '  if (tel.length > 10) {',
          '    return erreur("Numéro invalide");',
          '  }',
          '  return true;',
          '}',
        ],
        bug: 6, options: ['  if (tel.length !== 10) {', '  if (tel.length >= 10) {', '  if (tel = 10) {'], correct: 0,
        explain: 'Un numéro ivoirien compte exactement 10 chiffres : on refuse tout ce qui est différent de 10.',
      },
      {
        file: 'index.html', goal: 'Cliquer sur « Réserver » ne fait rien.',
        lines: [
          '<form id="reservation" onsubmit="return envoyer(event)">',
          '  <label for="nom">Nom</label>',
          '  <input id="nom" name="nom" required>',
          '  <label for="telephone">Téléphone</label>',
          '  <input id="telephone" name="telephone" type="tel">',
          '  <button type="button">Réserver</button>',
          '</form>',
        ],
        bug: 5, options: ['  <button type="reset">Réserver</button>', '  <button type="submit">Réserver</button>', '  <a href="#">Réserver</a>'], correct: 1,
        explain: 'Un bouton de type « button » ne soumet pas le formulaire. Il faut type="submit".',
      },
      {
        file: 'contact.js', goal: "Le serveur reçoit « [object Object] » au lieu des données.",
        lines: [
          'async function envoyer(event) {',
          '  event.preventDefault();',
          '  const data = Object.fromEntries(new FormData(event.target));',
          '  await fetch("/api/reservations", {',
          '    method: "POST",',
          '    headers: { "Content-Type": "application/json" },',
          '    body: data,',
          '  });',
          '  confirmer("Réservation envoyée !");',
          '}',
        ],
        bug: 6, options: ['    body: data.toString(),', '    body: JSON.parse(data),', '    body: JSON.stringify(data),'], correct: 2,
        explain: 'fetch attend une chaîne : on sérialise l’objet en JSON avec JSON.stringify.',
      },
    ],
  },
  {
    id: 'm2', title: 'Catalogue en ligne', client: 'Pharmacie de la Riviera', pay: 24000, level: 0,
    brief: 'La pharmacie veut que son catalogue soit lisible sur téléphone et que la recherche fonctionne.',
    tasks: [
      {
        file: 'catalogue.css', goal: 'Sur téléphone, les produits sont minuscules (4 par ligne).',
        lines: [
          '.grille {',
          '  display: grid;',
          '  grid-template-columns: repeat(4, 1fr);',
          '  gap: 16px;',
          '}',
          '@media (max-width: 600px) {',
          '  .grille { grid-template-columns: repeat(4, 1fr); }',
          '}',
        ],
        bug: 6, options: ['  .grille { grid-template-columns: repeat(2, 1fr); }', '  .grille { display: block; gap: 4px; }', '  .grille { grid-template-columns: 4fr; }'], correct: 0,
        explain: 'Sur petit écran, on passe à 2 colonnes dans la media query.',
      },
      {
        file: 'catalogue.js', goal: 'La recherche « doliprane » ne trouve pas « Doliprane 1000 ».',
        lines: [
          'function filtrer(produits, recherche) {',
          '  return produits.filter(p =>',
          '    p.nom.includes(recherche)',
          '  );',
          '}',
        ],
        bug: 2, options: ['    p.nom == recherche', '    p.nom.toLowerCase().includes(recherche.toLowerCase())', '    p.nom.startsWith(recherche)'], correct: 1,
        explain: 'On compare en minuscules des deux côtés pour ignorer la casse.',
      },
      {
        file: 'catalogue.js', goal: 'Les prix s’affichent « 2500FCFA » au lieu de « 2 500 FCFA ».',
        lines: [
          'function carteProduit(p) {',
          '  return `<article class="produit">',
          '    <img src="${p.image}" alt="${p.nom}">',
          '    <h3>${p.nom}</h3>',
          '    <p class="prix">${p.prix + "FCFA"}</p>',
          '  </article>`;',
          '}',
        ],
        bug: 4, options: ['    <p class="prix">${p.prix}+" FCFA"</p>', '    <p class="prix">${p.prix.toFixed(2)} FCFA</p>', '    <p class="prix">${p.prix.toLocaleString("fr-FR")} FCFA</p>'], correct: 2,
        explain: 'toLocaleString("fr-FR") ajoute l’espace des milliers, comme on l’écrit en Côte d’Ivoire.',
      },
      {
        file: 'catalogue.js', goal: 'Le panier compte 1 produit de trop.',
        lines: [
          'function totalPanier(panier) {',
          '  let total = 0;',
          '  for (let i = 0; i <= panier.length; i++) {',
          '    total += panier[i]?.prix ?? 0;',
          '  }',
          '  return total;',
          '}',
          'const nb = panier.length + 1;',
        ],
        bug: 7, options: ['const nb = panier.length;', 'const nb = panier.length - 1;', 'const nb = total / panier.length;'], correct: 0,
        explain: 'La longueur du tableau est déjà le nombre d’articles.',
      },
    ],
  },
  {
    id: 'm3', title: 'Paiement mobile money', client: 'Alimentation Chez Moussa', pay: 32000, level: 2,
    brief: 'Moussa veut accepter les paiements mobile money pour les commandes en ligne. Les paiements échouent tous.',
    tasks: [
      {
        file: 'paiement.js', goal: "L'opérateur refuse le montant : « amount must be a number ».",
        lines: [
          'function creerPaiement(commande) {',
          '  return {',
          '    montant: commande.total.toString(),',
          '    devise: "XOF",',
          '    reference: commande.id,',
          '  };',
          '}',
        ],
        bug: 2, options: ['    montant: Number(commande.total),', '    montant: "" + commande.total,', '    montant: commande.total + "F",'], correct: 0,
        explain: 'L’API attend un nombre : on envoie Number(...) et pas une chaîne.',
      },
      {
        file: 'paiement.js', goal: 'Le numéro du client est rejeté par l’opérateur.',
        lines: [
          'function normaliserNumero(tel) {',
          '  const chiffres = tel.replace(/\\D/g, "");',
          '  if (chiffres.length !== 10) throw new Error("Numéro invalide");',
          '  return chiffres;',
          '}',
        ],
        bug: 3, options: ['  return "+33" + chiffres;', '  return "+225" + chiffres;', '  return chiffres.slice(2);'], correct: 1,
        explain: 'L’indicatif de la Côte d’Ivoire est +225.',
      },
      {
        file: 'paiement.js', goal: 'Le statut du paiement est toujours « undefined ».',
        lines: [
          'async function payer(commande, tel) {',
          '  const corps = creerPaiement(commande);',
          '  corps.client = normaliserNumero(tel);',
          '  const res = api.initierPaiement(corps);',
          '  return res.statut;',
          '}',
        ],
        bug: 3, options: ['  const res = await api.initierPaiement(corps);', '  const res = api.initierPaiement(await corps);', '  const res = new api.initierPaiement(corps);'], correct: 0,
        explain: 'L’appel est asynchrone : sans await, on lit le statut d’une promesse.',
      },
      {
        file: 'paiement.js', goal: 'Toutes les commandes sont marquées « payées », même les refusées.',
        lines: [
          'function traiterRetour(res, commande) {',
          '  if (res.statut = "SUCCES") {',
          '    commande.payee = true;',
          '  } else {',
          '    commande.payee = false;',
          '  }',
          '}',
        ],
        bug: 1, options: ['  if (res.statut == "SUCCES" || true) {', '  if (res.statut === "SUCCES") {', '  if (!res.statut) {'], correct: 1,
        explain: '« = » affecte au lieu de comparer : la condition est toujours vraie. On utilise ===.',
      },
    ],
  },
];

// Missions de maintenance répétables (une par jour), tirées dans une banque de tâches.
const MAINT_CLIENTS = ['Gbaka Express', 'Salon de coiffure Belle Ivoirienne', 'École primaire Les Palmiers', 'Garage Yao & Fils', 'Radio Lagune FM'];
const MAINT_TASKS = [
  {
    file: 'menu.js', goal: 'Le menu mobile ne s’ouvre jamais.',
    lines: ['const bouton = document.querySelector(".burger");', 'const menu = document.querySelector(".menu");', 'bouton.addEventListener("click", () => {', '  menu.classList.add("ouvert");', '  menu.classList.remove("ouvert");', '});'],
    bug: 4, options: ['  menu.style.display = "none";', '', '  menu.remove();'], correct: 1,
    explain: 'La ligne retirait aussitôt la classe ajoutée. On la supprime (ou on utilise toggle).',
  },
  {
    file: 'horaires.js', goal: 'Le site affiche « Fermé » à 9h alors que l’établissement ouvre à 8h.',
    lines: ['function estOuvert(date) {', '  const h = date.getHours();', '  return h > 8 && h < 18;', '}'],
    bug: 2, options: ['  return h >= 8 && h < 18;', '  return h > 8 || h < 18;', '  return h == 8;'], correct: 0,
    explain: 'À 8h pile, h vaut 8 : il faut >= 8.',
  },
  {
    file: 'style.css', goal: 'Le texte blanc est illisible sur le bandeau.',
    lines: ['.bandeau {', '  background: #ffffff;', '  color: #ffffff;', '  padding: 24px;', '}'],
    bug: 1, options: ['  background: #f08a24;', '  background: transparent;', '  background: #fefefe;'], correct: 0,
    explain: 'Il faut un fond contrasté sous un texte blanc.',
  },
  {
    file: 'galerie.js', goal: 'La dernière photo de la galerie n’apparaît jamais.',
    lines: ['for (let i = 0; i < photos.length - 1; i++) {', '  galerie.append(creerVignette(photos[i]));', '}'],
    bug: 0, options: ['for (let i = 1; i < photos.length; i++) {', 'for (let i = 0; i < photos.length; i++) {', 'for (let i = 0; i <= photos.length + 1; i++) {'], correct: 1,
    explain: 'La boucle s’arrêtait un élément trop tôt.',
  },
  {
    file: 'api.js', goal: 'Les données ne se chargent pas : « res.json is not a function ».',
    lines: ['async function charger() {', '  const res = await fetch("/api/articles");', '  const data = res.json;', '  afficher(data);', '}'],
    bug: 2, options: ['  const data = await res.json();', '  const data = JSON.parse(res);', '  const data = res.text;'], correct: 0,
    explain: 'json() est une méthode asynchrone : on l’appelle avec await.',
  },
  {
    file: 'formulaire.html', goal: 'Les lecteurs d’écran ne savent pas à quoi sert le champ.',
    lines: ['<label>E-mail</label>', '<input id="email" type="email">'],
    bug: 0, options: ['<label for="email">E-mail</label>', '<span>E-mail</span>', '<label id="email">E-mail</label>'], correct: 0,
    explain: 'L’attribut for relie le libellé au champ.',
  },
];

export function maintenanceMission(day) {
  const pick = [...MAINT_TASKS].sort(() => Math.random() - 0.5).slice(0, 3);
  const client = MAINT_CLIENTS[day % MAINT_CLIENTS.length];
  return { id: 'maint-' + day, title: 'Maintenance de site', client, pay: 15000 + (day % 3) * 2000, level: 0, maintenance: true,
    brief: `${client} signale plusieurs petits problèmes sur son site.`, tasks: pick };
}
export function missionById(id, day) {
  if (id.startsWith('maint-')) return null;
  return MISSIONS.find(m => m.id === id);
}
