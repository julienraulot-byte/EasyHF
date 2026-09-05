# Journal des décisions techniques — EasyHF

Format ADR allégé : une décision par entrée, le contexte, ce qui a été tranché, et
pourquoi. Les entrées marquées **[À VALIDER JULIEN]** ont été tranchées
provisoirement pour ne pas bloquer le build ; elles attendent un arbitrage.

Convention du brief de build (§7) : toute ambiguïté fonctionnelle est tranchée
provisoirement et consignée ici, jamais décidée définitivement seule sur du
réglementaire.

---

## D-001 — Nom du produit et des paquets : `EasyHF`

*Phase 0.* Le brief produit parle de « FreqPlan FR ». Le nom retenu est
**EasyHF** ; les paquets sont publiés sous `@easyhf/*` et le dépôt est `EasyHF`.
La vérification INPI (classes 9 + 42) reste à faire avant toute communication
publique, comme prévu au §6 du brief de build.

## D-002 — Le moteur ne dépend de rien, et ne peut pas dériver

*Phase 0.* `@easyhf/engine` n'importe que ses propres modules : ni `@easyhf/shared`,
ni Node, ni DOM. Il doit tourner à l'identique dans un service worker, dans un
script Node et dans le runner de tests.

La règle est vérifiée par `packages/engine/test/architecture.test.ts`, qui refuse
tout import non relatif, toute référence à `document`/`window`/`process`, et
toute source de non-déterminisme (`Math.random`, `Date.now`, `new Date`,
`performance.now`). Le `tsconfig.json` du paquet fixe aussi `"types": []`, si
bien qu'un import Node ne compilerait même pas. Les tests, eux, ont leur propre
`tsconfig.test.json` avec les types Node.

## D-003 — Aucune graine aléatoire : il n'y a pas d'aléa

*Phase 0.* Le brief impose une graine explicite **si** l'algorithme explore au
hasard. L'assignation d'EasyHF est un glouton avec retour arrière borné, sans
tirage : à entrées égales, sortie identique octet pour octet. Ajouter un champ
`seed` inutilisé donnerait l'illusion d'un levier qui n'existe pas, donc il n'y
en a pas. `EngineConfig` n'en porte aucun.

Si une recherche locale (recuit, redémarrages) est ajoutée un jour — voir D-015 —
la graine devient obligatoire et l'entrée sera révisée.

## D-004 — Fréquences en kHz entiers, bornes d'intervalles en sixièmes de kHz

*Phase 0.* Les fréquences sont des entiers en kHz, jamais des flottants en MHz.

Les contraintes d'intermodulation, résolues pour la porteuse inconnue, font
apparaître des divisions par 2 (`2f − p`, `3p − 2f`) et par 3 (`3f − 2p`). Les
bornes sont donc portées en **unités de 1/6 kHz**, où elles restent des entiers
exacts. Aucun flottant ne décide jamais si un candidat est bloqué. C'est ce qui
rend un plan reproductible au kHz près, y compris sur une autre machine.

## D-005 — Un produit n'est jamais confronté à ses propres générateurs

*Phase 0.* Un produit `P = Σ cᵢ·fᵢ` (avec `Σ cᵢ = 1`) est comparé à une porteuse
victime `f_v`. Si la victime est elle-même un générateur, le résidu `P − f_v` a
des coefficients de somme nulle, et **chacun de ces cas est déjà vérifié
ailleurs, plus sévèrement** :

| Produit | Victime | Ce que la distance vaut réellement | Déjà couvert par |
|---|---|---|---|
| `2f1 − f2` | `f1` | `\|f1 − f2\|` | espacement co-canal |
| `2f1 − f2` | `f2` | `2·\|f1 − f2\|` | espacement co-canal |
| `3f1 − 2f2` | `f1` | `2·\|f1 − f2\|` | espacement co-canal |
| `3f1 − 2f2` | `f2` | `3·\|f1 − f2\|` | espacement co-canal |
| `f1 + f2 − f3` | `f1` ou `f2` | `\|f2 − f3\|` / `\|f1 − f3\|` | espacement co-canal |
| `f1 + f2 − f3` | `f3` | `\|f1 + f2 − 2f3\|` | le produit `2f3 − f1` mesuré contre `f2` |

La dernière ligne est la seule non évidente. C'est une vraie intermodulation,
mais c'est **exactement la forme à 2 émetteurs**, vérifiée avec une garde au
moins aussi large. La signaler aussi comme produit à 3 émetteurs ne détectait
rien de plus : elle remplissait les rapports de doublons — 12 des 100 violations
du cas `C06-peigne-8` étaient de cette nature.

Ce raisonnement n'est valable que si les gardes gardent leur ordre. Il n'est
donc pas supposé, il est **imposé** par `resolveConfig` :
`im3ThreeTx ≤ im3TwoTx ≤ espacement`, et `2 × espacement ≥ im5`. Sans cette
règle, un utilisateur abaissant l'espacement sous la garde IM3 perdrait
silencieusement des détections — c'est-à-dire exactement le défaut le plus grave
que ce moteur puisse avoir.

## D-006 — Garde IM3 séparée entre 2 et 3 émetteurs **[À VALIDER JULIEN]**

*Phase 0.* Le brief donne une garde IM3 unique (≥ 200 kHz). Appliquée telle
quelle aux produits à 3 émetteurs, elle rend les charges réelles inatteignables :
le moteur plafonne à 26 liaisons sur 224 MHz.

Les gardes sont donc séparées :

| Garde | Valeur par défaut | Origine |
|---|---|---|
| IM3 2 émetteurs (`2f1 − f2`) | 200 kHz | brief §4 |
| IM3 3 émetteurs (`f1 + f2 − f3`) | **100 kHz** | **décidé ici** |
| IM5 2 émetteurs (`3f1 − 2f2`) | 90 kHz | brief §4 |
| Espacement co-canal | 300 kHz | brief §4 |
| Garde vs exclusion | 250 kHz | brief §4 |

`resolveConfig` refuse toute configuration qui casserait l'ordre
`im3ThreeTx ≤ im3TwoTx ≤ espacement` — voir D-005.

Justification physique : un produit à 3 émetteurs demande la coïncidence de
trois porteuses dans la même non-linéarité et sort nettement plus bas qu'un
produit à 2 émetteurs. Les outils constructeurs règlent d'ailleurs ces deux
familles séparément.

Capacité mesurée (`pnpm --filter @easyhf/engine bench`), 470–694 MHz, pas
25 kHz, canal 200 kHz, 200 retours arrière :

| Garde IM3 3tx | placement compact | placement spread |
|---|---|---|
| 200 kHz | 26 | 23 |
| 150 kHz | 29 | 26 |
| **100 kHz** | **36** | 29 |
| 75 kHz | 36 | 32 |
| 50 kHz | 45 | 38 |
| 25 kHz | 54 | 47 |

**Ce qui est attendu de Julien :** la valeur de 100 kHz est un choix
d'ingénierie, pas une mesure. Elle doit être recalée sur les réglages par défaut
de Wireless Workbench et d'IAS lors de la campagne de validation (phase 0, §4.4).

## D-007 — Placement par défaut : compact **[À VALIDER JULIEN]**

*Phase 0.* Deux stratégies déterministes sont disponibles :

- `compact` — la fréquence libre la plus basse. Le plan tient dans le minimum de
  canaux TV : moins de spectre à garder propre, et de la place laissée aux
  autres prestataires du site.
- `spread` — le milieu du plus large intervalle libre. Plus de marge sur chaque
  porteuse, au prix de l'encombrement.

Sur 12 liaisons dans 534–598 MHz : `compact` occupe 15,7 MHz, `spread` 62,0 MHz.
`compact` place aussi 15 à 25 % de liaisons de plus (tableau D-006). Le défaut
est donc `compact`, `spread` reste offert.

**Ce qui est attendu de Julien :** confirmer que la pratique de terrain va bien
vers le plan le plus compact, et non vers l'étalement.

## D-008 — Budget de retour arrière : 200 pas

*Phase 0.* Le retour arrière chronologique rend très peu sur ce problème : la
liaison qui échoue est rarement celle qu'il faudrait déplacer. Mesuré sur
40 liaisons à gardes nominales, placement compact :

| Budget | Liaisons placées | Durée |
|---|---|---|
| 0 | 35 | 38 ms |
| **200** | **36** | 545 ms |
| 2 000 | 37 | 5,2 s |
| 20 000 | 37 | 51 s |

200 est le point où le coût cesse d'acheter des liaisons. Au-delà, on paie des
secondes pour rien. Le paramètre reste exposé (`maxBacktrackSteps`).

## D-009 — Échelle de robustesse, et sur quelles gardes le plan est jugé

*Phase 0.* Quand aucun plan complet n'existe aux gardes nominales, elles sont
dégradées par paliers : `[1, 0.8, 0.6, 0.45, 0.3]`. L'indice atteint est
`robustness.level` (0 = nominal), et il est rendu dans le résultat, donc
affichable et imprimable.

Le plan retourné est revérifié **avec les gardes réellement appliquées**, pas
avec les nominales : sinon `ok` serait faux pour un plan que le moteur assume.
C'est `robustness.level > 0` qui signale la dégradation, et l'interface devra le
montrer sans ambiguïté.

## D-010 — Deux zones en désaccord : la plus contraignante gagne

*Phase 0.* `interZonePolicy` est déclarée par zone, donc deux zones peuvent se
contredire (l'une `isolated`, l'autre `full-intermod`). EasyHF retient la plus
contraignante des deux. Un plan ne doit jamais être desserré parce qu'une seule
des deux zones était optimiste. Les zones sans politique déclarée valent
`full-intermod`.

## D-011 — Les largeurs de canal élargissent les gardes

*Phase 0.* Les gardes du brief sont des distances entre porteuses. Un canal large
demande davantage :

- espacement d'une paire = `max(garde, (largeur₁ + largeur₂) / 2)` ;
- garde vis-à-vis d'une exclusion = `max(garde, largeur / 2)` ;
- une porteuse doit tenir dans sa bande **demi-largeur comprise**.

## D-012 — Marges plafonnées à 4 fois la garde

*Phase 0.* Le résultat rapporte la plus petite marge observée par famille de
contrainte. La recherche s'arrête à 4 fois la garde : au-delà, la marge est
rendue à `null`, qui se lit « rien d'assez proche pour compter ». Chercher plus
loin coûterait cher pour une information sans usage.

## D-013 — `shared` dépend de `engine`, jamais l'inverse

*Phase 0.* Le brief fixe : `engine` ne dépend de rien ; `formats` et
`hardware-db` peuvent dépendre de `shared`. Il ne dit rien du sens
`shared → engine`, qui est ici autorisé et utilisé : `@easyhf/shared` traduit un
`Project` en entrée moteur (`toCoordinateInput`) et réécrit le plan dans le
projet (`applyPlan`). Le sens interdit reste `engine → shared`, et il l'est.

## D-014 — `data/bands/fr.json` est une donnée testée

*Phase 0.* Le fichier est trié par fréquence croissante, sans recouvrement, et
chaque bande `temporary` porte une note. Ces invariants sont vérifiés par
`packages/shared/test/band-plan.test.ts`, avec les quatre bandes PMSE françaises
et l'interdiction de la bande 700 MHz explicitement épinglées.

Rappel du brief §7 : aucune modification de `data/bands/*.json` sans citer une
source dans le commit.

## D-015 — Limite connue : le glouton plafonne, et on l'assume en v1

*Phase 0.* À gardes nominales, avec l'IM3 3 émetteurs active, le moteur place
environ 36 liaisons sur 224 MHz. Le comptage suggère que 40 n'est pas hors
d'atteinte — la contrainte dominante porte sur les sommes deux à deux, dont il y
en a 780 pour 40 porteuses, à répartir sur 448 MHz — mais **je n'ai pas construit
un tel ensemble**, et tant qu'il ne l'est pas, cette borne reste une intuition et
non un résultat. L'atteindre demanderait de toute façon une recherche locale
(recuit, redémarrages), donc de l'aléa, donc une graine, donc D-003 à réviser.

Au-delà de ce plafond, le moteur ne ment pas : il dégrade les gardes par paliers
et l'annonce (D-009). Une recherche locale n'est pas dans le périmètre v1 ; elle
sera proposée à Julien, pas implémentée d'office.

## D-016 — Le 5ᵉ ordre ne coûte jamais un palier de robustesse

*Phase 0, issue de la revue.* `checkPlan` classe l'IM5 en avertissement, mais
l'assignateur le traitait comme un blocage dur. Conséquence : plutôt que
d'accepter un avertissement, le moteur descendait d'un palier et **dégradait
l'espacement de 300 à 240 kHz et la garde IM3 de 200 à 160 kHz pour tout le
plan** — il affaiblissait des gardes critiques pour éviter un avertissement, et
celui-ci disparaissait du rapport. Le contraire exact de la franchise
revendiquée en D-009.

`buildMask` produit désormais deux masques. Le masque `hard` porte ce qui rend un
plan invalide ; `soft` y ajoute les produits du 5ᵉ ordre. La recherche essaie
d'abord les fréquences propres au sens de `soft`, puis se rabat sur celles qui ne
sont libres qu'au sens de `hard`. Un avertissement reste un avertissement, et
apparaît dans le rapport.

## D-017 — La plage et la grille d'accord font partie des règles

*Phase 0, issue de la revue.* `checkPlan` ignorait `tuningRangeKHz` et
`stepKHz` : un plan saisi à la main ou importé pouvait placer une liaison à une
fréquence que le récepteur ne peut tout simplement pas afficher, et être déclaré
valide. Nouvelle violation `out-of-tuning-range`, critique, couvrant le
hors-plage et le hors-grille. Elle vaut aussi pour les fréquences verrouillées.

## D-018 — Ordre des chaînes par unités de code, jamais `localeCompare`

*Phase 0, issue de la revue.* Six comparaisons d'identifiants utilisaient
`localeCompare`, dont une décidant l'ordre de traitement des liaisons. Or
`localeCompare` dépend de la locale de la machine : sous `tr_TR`, `i` et `I` ne
s'ordonnent pas comme sous `en_US`. Deux machines produisaient donc deux plans
différents pour les mêmes entrées — ce qui contredisait directement la promesse
« octet pour octet, y compris sur une autre machine ».

Tout passe par `compareIds` (`order.ts`), qui compare par unités de code. Le test
d'architecture interdit désormais `localeCompare` et `Intl.` au même titre que
`Math.random`.

## D-019 — Bande 863–865 MHz : question ouverte **[À VALIDER JULIEN]**

*Phase 0.* `data/bands/fr.json` ne contient pas la bande 863–865 MHz, utilisée
par des micros sans fil d'entrée de gamme au titre des dispositifs à faible
portée (recommandation ERC 70-03). Pour un outil qui se veut multi-marques,
c'est probablement une omission — mais je ne l'ajoute pas : le §7 du brief
interdit de trancher seul sur du réglementaire, et la règle « pas de
modification sans source » vaut aussi pour les ajouts.

**Ce qui est attendu de Julien :** confirmer le statut et la puissance admise en
France, et fournir la source à citer dans le commit.

## D-020 — Le modèle de visibilité est écrit, parce qu'il s'est déjà trompé

*Phase 0, issue de la revue.* Une revue adverse a trouvé un bug que la suite de
tests ne pouvait pas voir : en construisant le masque, l'assignateur ne retenait
comme générateurs que les porteuses **qu'il voyait lui-même**, alors que la règle
est que chaque générateur doit être visible **de la victime**. Avec trois zones
de politiques différentes — B en `full-intermod`, A et C non — un produit
`2f − p` pouvait retomber exactement sur une victime de B sans être bloqué. Le
moteur rendait alors un plan complet, palier 0, puis le déclarait `ok: false` par
sa propre re-vérification finale : il ne mentait pas, mais il ne savait pas non
plus produire un plan valide.

Deux choses en découlent, et les deux sont dans le dépôt :

1. Un tableau de visibilité en tête de `buildMask` : quel rôle joue la liaison
   placée, qui est la victime, et de qui les générateurs doivent être visibles.
   La règle était jusque-là diffuse entre quatre fichiers, ce qui est
   précisément comment elle s'est perdue.
2. `cross-validation.test.ts`, qui offre à la recherche **chaque fréquence
   possible**, une par une, et exige que son verdict coïncide avec celui du
   vérificateur — en une zone, en trois zones sous les 27 combinaisons de
   politiques, en grilles et largeurs mélangées, et sur des scènes tirées au
   sort. Réintroduire le bug fait échouer ce test en une seconde.

À retenir pour la suite : `assign.ts` et `check.ts` encodent les mêmes règles
deux fois, sous deux formes. Rien ne les force à rester d'accord, sauf ce test.
Toute règle ajoutée à l'un doit l'être à l'autre, et la comparaison exhaustive
est le seul moyen de le savoir.
