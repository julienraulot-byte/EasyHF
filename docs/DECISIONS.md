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

## D-005 — Un produit n'est confronté à son propre générateur que si rien d'autre ne le couvre

*Phase 0, révisé deux fois.* Un produit `P = Σ cᵢ·fᵢ` (avec `Σ cᵢ = 1`) est comparé
à une porteuse victime `f_v`. Si la victime est elle-même un générateur, le
résidu `P − f_v` est une quantité qu'une autre règle mesure déjà, en général
plus sévèrement :

| Produit | Victime | Le résidu vaut | Règle qui le couvre | … à condition que |
|---|---|---|---|---|
| `2f1 − f2` | `f1` | `\|f1 − f2\|` | espacement (f1, f2) | toujours¹ |
| `2f1 − f2` | `f2` | `2·\|f1 − f2\|` | espacement (f1, f2) | toujours¹ |
| `3f1 − 2f2` | `f1` | `2·\|f1 − f2\|` | espacement (f1, f2) | toujours¹ |
| `3f1 − 2f2` | `f2` | `3·\|f1 − f2\|` | espacement (f1, f2) | toujours¹ |
| `f1 + f2 − f3` | `f1` | `\|f2 − f3\|` | espacement (f2, f3) | f2 et f3 ne soient pas `isolated` l'une de l'autre |
| `f1 + f2 − f3` | `f3` | `\|f1 + f2 − 2f3\|` | la forme 2 émetteurs `2f3 − f1` contre `f2` | f2 voie f1 (`full`) |

¹ Un produit à 2 émetteurs ne compte que si ses deux générateurs sont `full`
avec la victime, qui est ici l'un d'eux : l'espacement entre eux s'applique
donc toujours.

**Ces cas sont écartés du comptage d'intermodulation uniquement quand la règle
qui les couvre s'applique effectivement.** En une seule zone, c'est toujours le
cas, et les écarter évite de nommer deux fois la même anomalie (le cas
`C06-peigne-8` en produisait 12 sur 100). Entre zones, ce n'est pas garanti :
l'espacement est sauté entre zones `isolated`, et la forme 2 émetteurs exige de
`f2` qu'elle voie `f1`, ce que la forme 3 émetteurs n'a jamais demandé. Dans ces
cas, rien d'autre ne signalerait le produit, et il est signalé ici, sous son nom.

**Historique, parce qu'il compte.** La première version de cette règle gardait
le dernier cas comme « vraie intermodulation ». La première revue a montré qu'il
faisait doublon en une zone, et je l'ai supprimé purement et simplement. La
seconde revue a montré que cette suppression était une **régression** : le
triplet équidistant A, B, C à 400 kHz — le cas d'IM3 le plus classique du métier
— passait sans violation dès que B seule voyait A et C. L'algèbre était juste,
la visibilité non. Voir D-021.

Le raisonnement suppose enfin que les gardes gardent leur ordre. Ce n'est pas
supposé, c'est **imposé** par `resolveConfig` :
`im3ThreeTx ≤ im3TwoTx ≤ espacement`, et `2 × espacement ≥ im5`. Sans quoi un
utilisateur abaissant l'espacement sous la garde IM3 perdrait silencieusement
des détections.

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
25 kHz, canal 200 kHz, 100 retours arrière par passe :

| Garde IM3 3tx | placement compact | placement spread |
|---|---|---|
| 200 kHz | 27 | 24 |
| 150 kHz | 29 | 26 |
| **100 kHz** | **37** | 30 |
| 75 kHz | 38 | 33 |
| 50 kHz | 46 | 39 |
| 25 kHz | 57 | 52 |

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

## D-008 — Budget de retour arrière : 100 pas par passe

*Phase 0.* Le retour arrière chronologique rend très peu sur ce problème : la
liaison qui échoue est rarement celle qu'il faudrait déplacer. Mesuré sur
40 liaisons à gardes nominales, placement compact :

| Budget | Liaisons placées | Durée |
|---|---|---|
| 0 | 36 | 58 ms |
| 50 | 37 | 0,3 s |
| **100** | **37** | 0,55 s |
| 200 | 37 | 1,1 s |
| 2 000 | 37 | 9,7 s |

Au-delà de 50, on paie des secondes pour rien. Le défaut est 100 **par passe** :
depuis D-016, chaque palier de l'échelle fait deux passes (avec, puis sans la
préférence pour les fréquences propres au 5ᵉ ordre), de sorte qu'un palier coûte
au plus 200 pas — ce que coûtait un palier avant — sans rien perdre en
liaisons placées. Le paramètre reste exposé (`maxBacktrackSteps`).

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
environ 37 liaisons sur 224 MHz. Le comptage suggère que 40 n'est pas hors
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

**Cela ne suffisait pas.** La seconde revue a montré que la préférence modifie la
trajectoire du glouton, et qu'avec un budget de retour arrière borné une autre
trajectoire peut échouer là où la trajectoire simple réussit : sur une scène de
7 liaisons, IM5 activé donnait le palier 1, IM5 désactivé le palier 0. Chaque
palier fait donc deux passes : avec la préférence, puis — seulement si la
première échoue — sans elle. La seconde passe est, par construction, exactement
la recherche que l'on obtient IM5 désactivé : mêmes masques, même ordre.
Activer IM5 peut ajouter des avertissements ; il ne peut plus coûter un palier.
Un test l'affirme sur une charge assez serrée pour atteindre l'échelle.

## D-017 — La plage et la grille d'accord font partie des règles

*Phase 0, issue de la revue.* `checkPlan` ignorait `tuningRangeKHz` et
`stepKHz` : un plan saisi à la main ou importé pouvait placer une liaison à une
fréquence que le récepteur ne peut tout simplement pas afficher, et être déclaré
valide. Nouvelle violation `out-of-tuning-range`, critique, couvrant le
hors-plage et le hors-grille. Elle vaut aussi pour les fréquences verrouillées.

## D-018 — Ordre des chaînes par unités de code, jamais `localeCompare`

*Phase 0, issue de la revue.* Huit comparaisons d'identifiants utilisaient
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
   politiques et depuis chaque zone, avec exclusions et bandes, en grilles et
   largeurs mélangées, et sur des scènes tirées au sort. Réintroduire le bug
   fait échouer ce test en une seconde.

`assign.ts` et `check.ts` encodent les mêmes règles deux fois, sous deux formes.
Ce test garantit qu'ils restent **d'accord**. Il ne garantit pas qu'ils aient
**raison** : une erreur de modèle partagée par les deux passe au travers — c'est
exactement ce qui est arrivé ensuite (D-021). La détection, elle, se teste sur
`checkPlan` seul, par des cas construits à la main.

## D-021 — Une correction qui était une régression, et ce qu'elle a appris

*Phase 0, issue de la seconde revue.* En réponse à la première revue, j'avais
retiré le cas « victime = générateur soustractif » de l'IM3 à 3 émetteurs, au
motif qu'il est algébriquement la forme à 2 émetteurs. C'est vrai. Mais les deux
formes n'exigent pas la **même visibilité** : la forme 3 émetteurs demande que
la victime voie les deux autres, la forme 2 émetteurs demande en plus que ces
deux-là se voient entre elles. Dès qu'une zone `full-intermod` est entourée de
zones qui ne le sont pas entre elles, la forme 2 émetteurs se tait, et plus rien
ne vérifiait le triplet.

Cas de reproduction : A = 500,000, B = 500,400, C = 500,800 MHz, B seule en
`full-intermod`. `A + C − B` retombe sur B à 0 kHz. Avant la correction :
signalé. Après : `ok: true`, plan livré au palier 0. Et le test de comparaison
exhaustive ne voyait rien, puisque l'assignateur partageait l'exclusion.

La même revue a trouvé le cas jumeau, préexistant : `f1 + f2 − f3` contre `f1`
se réduit à `\|f2 − f3\|`, « couvert par l'espacement » — sauf entre zones
`isolated`, où l'espacement ne s'applique pas. Deux porteuses à 50 kHz l'une de
l'autre dans deux zones isolées, toutes deux visibles d'une troisième :
`A + B − C` à 50 kHz de A, aucune violation.

La règle est désormais celle de D-005 : le cas dégénéré n'est écarté que si la
règle qui le couvre s'applique effectivement. `assign.ts` la reflète cas par
cas (commentés en face de chaque intervalle), la comparaison exhaustive confirme
l'accord, et deux **tests de détection** sur `checkPlan` seul — le triplet
équidistant en zones mixtes, le battement de deux porteuses isolées —
verrouillent ce que la cohérence ne pouvait pas voir.

Ce que ça change dans la façon de travailler : une simplification du moteur
n'est pas une simplification tant que ses **conditions de visibilité** n'ont pas
été écrites à côté de son algèbre. Et un test de cohérence ne remplace jamais un
test de détection.

## D-022 — Le modèle de visibilité est « côté récepteur » **[À VALIDER JULIEN]**

*Phase 0.* Tout le moteur repose sur une seule règle : un produit compte contre
une victime quand **chacun de ses générateurs est visible de la victime**. C'est
un modèle côté récepteur — le produit se forme dans le front-end de la victime,
à partir de ce qui lui parvient.

Il exclut par construction un autre chemin physique : un produit formé côté
émission (dans l'étage de sortie ou l'antenne partagée d'une zone) puis rayonné
vers une victime qui, elle, ne voit pas tous les générateurs. Exemple : `2f_B −
f_A` formé dans la zone B et reçu dans la zone C, alors que C ne voit pas A.

Ce n'est pas un bug, c'est un choix de modèle, et c'est celui des outils du
métier à ma connaissance. Mais il mérite d'être vu par quelqu'un qui coordonne
réellement, parce qu'il détermine ce que `spacing-only` et `isolated`
signifient sur le terrain.

**Ce qui est attendu de Julien :** confirmer que « visible de la victime » est
la bonne sémantique pour les politiques inter-zones, ou décrire le cas de
terrain qui la met en défaut.
