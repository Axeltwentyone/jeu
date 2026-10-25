# Babi — Vis ta vie à Abidjan (MVP)

Simulation de vie en 3D réaliste dans une rue de Marcory, au bord de la lagune Ébrié. Tu incarnes un·e jeune développeur·se web : tu as un studio modeste, 12 000 FCFA et un entretien d'embauche.

## Lancer le jeu

```bash
cd ~/Desktop/jeu && python3 devserver.py 5173
```

Puis ouvrir http://localhost:5173.

`devserver.py` est un serveur statique qui désactive le cache du navigateur, pour que les fichiers modifiés soient bien rechargés. `python3 -m http.server` marche aussi pour simplement jouer.

Le premier chargement télécharge environ 100 Mo de ressources libres de droits (Poly Haven, jsDelivr). Ensuite, le service worker les met en cache et le jeu démarre en quelques secondes.

## La boucle de jeu

Explorer → trouver un travail → accomplir une mission → recevoir un salaire → payer ses dépenses → améliorer sa vie.

1. **Réveil dans ton studio.** Le téléphone vibre : Babi Digital veut te rencontrer, et ton propriétaire te rappelle le loyer.
2. **Trouver l'entreprise.** Un repère à l'écran et la carte du téléphone te guident jusqu'à l'immeuble vitré « Babi Digital ».
3. **L'entretien.** Mme Kouamé (RH, à l'accueil) te pose deux questions, puis tu es embauché·e.
4. **La mission.** Yannick, le responsable technique, te propose des missions réelles (formulaire de contact d'un maquis, catalogue d'une pharmacie, paiement mobile money…).
5. **Au travail.** À ton poste, un éditeur de code s'ouvre. Pour chaque ticket :
   - trouve la ligne fautive ;
   - choisis le bon correctif ;
   - lance les tests, puis envoie le code (`git push`).

   Les erreurs coûtent du temps de jeu, la fatigue t'empêche de te concentrer, et un indice coûte 20 minutes.
6. **Le salaire.** Yannick valide la mission. Le paiement est unique, versé une seule fois, et inscrit dans l'historique.
7. **Les dépenses.**
   - Nourriture : maquis, boutique, étal, café du bureau.
   - Vêtements : atelier Élégance.
   - Équipement du studio : ventilateur, matelas.
   - Transport : woro-woro à 300 FCFA, taxi à 1 000 FCFA.
   - Loyer : 30 000 FCFA par semaine, avec 5 000 FCFA de pénalité en cas de retard.

   Aucun paiement n'est possible si le solde est insuffisant.
8. **Dormir** dans ton lit fait avancer le temps et recharge l'énergie. Si l'énergie ou la faim tombe à zéro, tu fais un malaise.
9. **Objectif long terme.** Réunir 150 000 FCFA (avec 3 missions validées) pour louer un local et ouvrir ton maquis.

## Contrôles

| Action | Clavier / souris | Tactile |
|---|---|---|
| Marcher | ZQSD, WASD ou flèches | joystick |
| Courir | Maj | bouton « Courir » |
| Caméra | glisser la souris, molette pour zoomer | glisser |
| Interagir (une seule action pertinente est proposée) | E | bouton E |
| Téléphone | T | bouton « Tél. » |
| Fermer un menu / pause | Échap | — |

Le téléphone contient : Messages, Missions, Emploi, Argent (solde, historique, loyer), Carte (GPS et taxi) et Personnage.

## Architecture (`src/`)

| Fichier | Rôle |
|---|---|
| `main.js` | démarrage, entrées, caméra 3e personne avec collisions, interactions (distance, orientation, visibilité), HUD, repère d'objectif, boucle |
| `game.js` | règles : argent et historique, loyer, emploi, missions, objectifs, transport, zones, routines des PNJ |
| `missions.js` | contenu des missions (vrais extraits de code avec bugs) |
| `editor.js` | poste de travail (mini-jeu de débogage) |
| `phone.js` | téléphone |
| `world.js` | quartier, collisions, regroupement des décors statiques par cellules |
| `interiors.js` | studio et bureaux. On y entre par une porte avec un fondu ; ce sont des espaces séparés du quartier, rendus seuls |
| `vehicles.js` | berline modélisée et circulation (les voitures s'arrêtent devant les piétons) |
| `characters.js` | chargement des personnages, retargeting des animations, cadence calée sur la vitesse réelle (pas de glissement des pieds) |
| `appearance.js` | apparence : garde-robe (maillages du modèle), peau masquée sous les vêtements, teint, cheveux, curseurs (morph targets), accessoires |
| `creator.js` | éditeur de personnage (aperçu 3D, repos / marche / course) |
| `env.js` | ciel, soleil et lune, post-traitement, niveaux de qualité |
| `save.js` | sauvegarde locale derrière une interface `load/save/clear`, remplaçable par une sauvegarde serveur |
| `audio.js` | ambiance et sons d'interaction synthétisés |

## Ce qui reste à fournir pour aller plus loin

- **Véhicules.** Je n'ai trouvé aucun modèle de voiture réaliste en licence libre et téléchargeable sans compte. La berline est donc modélisée par code. Un pack glTF sous licence (Corolla, gbaka, woro-woro) se brancherait directement dans `vehicles.js`.
- **Vêtements africains.** La garde-robe vient du pack CC0 de MakeHuman (t-shirts, chemises, costume, jeans, baskets…). Boubou, pagne wax, maillot : à coudre dans Marvelous Designer sur `tools/marvelous/avatar_m.obj` / `avatar_f.obj` (corps nu exporté par le script, en mètres), puis à ajouter au script (voir ci-dessous).
- **Coiffures afro.** Une seule coiffure afro dans le pack MakeHuman ; tresses africaines, locks, twists sont à modéliser.
- **Animation assise.** La position assise est une pose procédurale : la bibliothèque libre utilisée ne fournit pas d'animation assise.

## Personnages : pipeline Blender

Les personnages sont générés hors du jeu, dans Blender 5.4, avec l'extension MPFB (MakeHuman pour Blender) et le pack d'assets CC0 de MakeHuman :

```
python3 tools/blender/make_prints.py                 # imprimés des t-shirts
Blender -b --python tools/blender/build_characters.py -- all
```

Le script produit `assets/characters/babi_m.glb` et `babi_f.glb` (+ `.json`) : corps, yeux, toute la garde-robe et les coiffures sur un squelette Mixamo (animations du jeu). Pour chaque curseur (visage, corpulence), la forme est appliquée au corps et les vêtements sont réajustés par MPFB : les morph targets des vêtements suivent ceux du corps. Le logo MakeHuman des t-shirts est remplacé par nos imprimés. `tools/viewer.html` affiche le résultat sans lancer le jeu. Pour ajouter un vêtement : le mettre dans les données MPFB (format .mhclo) et l'inscrire dans `SETS` du script, puis dans `CLOTHES` de `appearance.js`.

## Crédits

- **Modèles et textures** : [Poly Haven](https://polyhaven.com), licence CC0.
- **Personnages, vêtements, coiffures** : [MakeHuman](http://www.makehumancommunity.org) (assets système, licence CC0), générés avec [MPFB](https://extensions.blender.org/add-ons/mpfb/).
- **Animations** : exemples officiels de [three.js](https://github.com/mrdoob/three.js) (X Bot et Michelle, issus de Mixamo).
