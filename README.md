# EasyHF

Coordination de fréquences HF/PMSE multi-marques, pensée pour le marché
français : intermodulation fiable, exclusions TNT géolocalisées, exports vers
les logiciels constructeurs — hors ligne, à un prix d'indépendant.

Ce dépôt suit une méthode **phase-gate** : chaque phase se termine sur une
question binaire, et la suivante ne démarre pas sans validation explicite. Voir
`docs/VALIDATION.md` pour la porte en cours et `docs/DECISIONS.md` pour le
journal des décisions.

## Feuille de route

| Phase | Contenu | État |
|---|---|---|
| 0 | Moteur d'intermodulation `@easyhf/engine` | **validée et marquée** — 10 / 10 cas concordants avec Wireless Workbench 7.8, quatre audits adverses ; tag `phase-0-done` sur le commit `d895a03` |
| 1 | Base matériel `@easyhf/hardware-db` | **en cours** — voir ci-dessous |
| 2 | ETL ANFR + service TNT | non démarrée — émetteurs TNT géolocalisés, exclusions par lieu |
| 3 | Formats d'échange `@easyhf/formats` | non démarrée — import et export WWB, WSM, CSV, PDF |
| 4 | Application native, série Invecter | non démarrée — iOS et Android, hors ligne, achat unique (D-030), design au skill Impeccable |
| 5 | Durcissement + beta | non démarrée — performance, accessibilité, première mise en main |

### Phase 1 — ce qui est fait

- **67 entrées** sur 22 séries et 7 constructeurs, chacune avec sa source.
- **Gardes par modèle** dans le moteur (D-023), comparées exhaustivement sur
  des jeux de gardes mélangés. Les premières gardes venues d'un texte
  constructeur sont celles de Sound Devices Astral (D-028).
- **Blocs WMAS** (D-026) : Spectera entre comme une porteuse large, victime sur
  toute sa largeur, générateur sur demande. Vérifié candidat par candidat,
  bloc verrouillé, bloc libre et blocs générateurs.
- **Base légale du WMAS en France** vérifiée avant de coder (D-027) : licite
  aujourd'hui, 50 mW p.a.r., sans limite de largeur ni redevance.
- **`import:wwb`** (D-029) : la base d'équipements de Wireless Workbench est un
  fichier SQLite lisible ; l'outil la lit sur la machine de l'utilisateur et
  sort les écarts avec nos entrées. 23 plages fausses ont déjà été corrigées.

### Phase 1 — ce qui reste

1. **Lancer `import:wwb` là où Wireless Workbench est installé** et valider
   entrée par entrée. C'est la question de fin de phase. La commande vit dans
   le dépôt : il faut donc un clone sur cette machine, ce qui n'est pas encore
   le cas.
2. **Deux chiffres Spectera** que Sennheiser ne publie pas : le pas de
   placement du centre du bloc, et si LinkDesk attend le centre ou le bord bas.
   Une capture d'écran tranche les deux.
3. **Deux relevés WWB** qui trancheraient la doctrine D-005 sur les produits
   qui touchent leur propre générateur. Sans eux, la règle actuelle tient.
4. **Décision sur trois manques du modèle de données** (D-029) : appareils à
   canaux préréglés, bandes à trous, gardes aux 7e et 9e ordres.

### Ce qui a bougé

Le WMAS était un non-objectif v1, renvoyé en v3 par le brief. Julien l'a
ramené en phase 1 le 11/09/2026 : c'est aujourd'hui la technologie des deux
références du retour d'oreille. D-025 puis D-026 en gardent la trace.

Trois autres non-objectifs v1 du brief sont tombés depuis, chacun sur décision
explicite : le **paiement** (D-030, achat unique à 35), l'**application native**
(D-030, série Invecter en Kotlin Multiplatform) et le **multi-pays** (D-031).

Restent hors périmètre v1 : la supervision temps réel, qui est le terrain des
constructeurs et demande leurs protocoles, et les fonctions d'IA.

### Pas encore tranché

Le modèle est arrêté : application native de la série Invecter, iOS et Android,
hors ligne, en achat unique à 35 (D-030), moteur porté en Kotlin Multiplatform
avec les fichiers témoins comme suite de conformité (D-032). Restent ouverts,
à valider par Julien avant la phase 4 :

- **quel pays après la France.** Le multi-pays est acté (D-031) et le code s'y
  prête déjà ; reste à choisir l'ordre, et à rouvrir les deux décisions que ça
  invalide, la bande 863–865 MHz et la restriction du QLX-D S50 ;
- **l'ordre des phases**, la recommandation étant de mettre une tranche
  verticale mince entre les mains de vrais coordinateurs avant de construire
  les phases 2 et 3.

## Structure

```
packages/engine/       Moteur intermod et assignation. TypeScript pur, zéro dépendance.
packages/shared/       Modèle de domaine (projets, zones, liaisons) et pont vers le moteur.
packages/hardware-db/  Base matériel : JSON versionnés, schéma, validateur.
data/bands/        Bandes réglementaires, en JSON éditable.
docs/              Journal des décisions et protocole de validation.
```

Règle de dépendance : `engine` ne dépend de rien. `shared` dépend de `engine`.
`hardware-db` dépend des deux. Jamais l'inverse — c'est vérifié par un test dans chaque paquet,
pas par la discipline.

## Développer

```sh
pnpm install
pnpm test                              # toute la suite, sauf le budget de performance
pnpm test:perf                         # 40 liaisons < 3 s, seul, sur machine calme
pnpm coverage                          # couverture (seuil engine : 90 %)
pnpm validate:hardware                 # schéma et cohérence de la base matériel
pnpm --filter @easyhf/hardware-db import:wwb   # écarts avec la base de Wireless Workbench (Node 22.5+)
pnpm typecheck                         # sources et tests
pnpm --filter @easyhf/engine bench     # mesures de capacité (quelques minutes)
UPDATE_GOLDEN=1 pnpm test              # régénère les fichiers témoins de validation
```

## Ce que le moteur garantit

- **Déterminisme.** Mêmes entrées, même plan, octet pour octet — quel que soit
  l'ordre dans lequel les liaisons, les exclusions ou les bandes sont fournies,
  et quelle que soit la machine. Aucun aléa, aucune horloge, aucun tri dépendant
  de la locale.
- **Arithmétique exacte.** Fréquences en kHz entiers, bornes d'intervalles en
  sixièmes de kHz. Aucun flottant ne décide si une fréquence est utilisable.
- **Franchise.** Quand aucun plan complet n'existe aux gardes nominales, le
  moteur dégrade par paliers documentés et rend l'indice atteint, les gardes
  réellement appliquées et les marges obtenues. Un avertissement de 5ᵉ ordre ne
  coûte jamais un palier.
- **Accord entre l'assignateur et le vérificateur.** Les deux encodent les mêmes
  règles sous deux formes ; un test les compare fréquence par fréquence, sur les
  27 combinaisons de politiques de zones.

## Données

Les bandes réglementaires proviennent des décisions ARCEP 2015-0830 et
2016-0272 ; elles sont éditables dans `data/bands/fr.json` et validées par des
tests. Les émetteurs TNT viendront de l'open data ANFR (Licence Ouverte /
Etalab 2.0) en phase 2 — la mention de la source sera obligatoire dans l'app et
dans les PDF.
