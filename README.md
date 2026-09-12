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
| 0 | Moteur d'intermodulation `@easyhf/engine` | **validée** — 10 / 10 cas concordants avec Wireless Workbench 7.8 (`phase-0-done`) |
| 1 | Base matériel `@easyhf/hardware-db` | **en cours** — 67 entrées sourcées sur 22 séries, gardes par modèle et blocs WMAS (Spectera) dans le moteur (D-026) ; `import:wwb` compare la base à celle de Wireless Workbench (D-029), validation finale par Julien |
| 2 | ETL ANFR + service TNT | non démarrée |
| 3 | Formats d'échange `@easyhf/formats` | non démarrée |
| 4 | PWA `apps/web` | non démarrée |
| 5 | Durcissement + beta | non démarrée |

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
