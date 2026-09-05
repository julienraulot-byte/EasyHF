# EasyHF

Coordination de fréquences HF/PMSE multi-marques, pensée pour le marché
français : intermodulation fiable, exclusions TNT géolocalisées, exports vers
les logiciels constructeurs — hors ligne, à un prix d'indépendant.

Ce dépôt suit une méthode **phase-gate** : chaque phase se termine sur une
question binaire, et la suivante ne démarre pas sans validation explicite. Voir
`docs/VALIDATION.md` pour la porte en cours et `docs/DECISIONS.md` pour le
journal des décisions.

## État

| Phase | Contenu | État |
|---|---|---|
| 0 | Moteur d'intermodulation `@easyhf/engine` | **construit — en attente des relevés Wireless Workbench** |
| 1 | Base matériel `@easyhf/hardware-db` | non démarrée |
| 2 | ETL ANFR + service TNT | non démarrée |
| 3 | Formats d'échange `@easyhf/formats` | non démarrée |
| 4 | PWA `apps/web` | non démarrée |
| 5 | Durcissement + beta | non démarrée |

## Structure

```
packages/engine/   Moteur intermod et assignation. TypeScript pur, zéro dépendance.
packages/shared/   Modèle de domaine (projets, zones, liaisons) et pont vers le moteur.
data/bands/        Bandes réglementaires, en JSON éditable.
docs/              Journal des décisions et protocole de validation.
```

Règle de dépendance : `engine` ne dépend de rien. `shared` dépend de `engine`.
Jamais l'inverse — c'est vérifié par un test, pas par la discipline.

## Développer

```sh
pnpm install
pnpm test                              # toute la suite
pnpm coverage                          # couverture (seuil engine : 90 %)
pnpm typecheck                         # sources et tests
pnpm --filter @easyhf/engine bench     # mesures de capacité (quelques minutes)
UPDATE_GOLDEN=1 pnpm test              # régénère les fichiers témoins de validation
```

## Ce que le moteur garantit

- **Déterminisme.** Mêmes entrées, même plan, octet pour octet — quel que soit
  l'ordre dans lequel les liaisons, les exclusions ou les bandes sont fournies.
  Aucun aléa, aucune horloge.
- **Arithmétique exacte.** Fréquences en kHz entiers, bornes d'intervalles en
  sixièmes de kHz. Aucun flottant ne décide si une fréquence est utilisable.
- **Franchise.** Quand aucun plan complet n'existe aux gardes nominales, le
  moteur dégrade par paliers documentés et rend l'indice atteint, les gardes
  réellement appliquées et les marges obtenues.

## Données

Les bandes réglementaires proviennent des décisions ARCEP 2015-0830 et
2016-0272 ; elles sont éditables dans `data/bands/fr.json` et validées par des
tests. Les émetteurs TNT viendront de l'open data ANFR (Licence Ouverte /
Etalab 2.0) en phase 2 — la mention de la source sera obligatoire dans l'app et
dans les PDF.
