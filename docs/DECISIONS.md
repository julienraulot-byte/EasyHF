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

**Révision du 11/09/2026, phase 1.** Ce raisonnement supposait
`im3ThreeTx ≤ im3TwoTx ≤ espacement`, imposé par `resolveConfig`. Le fuzz à
gardes mélangées l'a fait tomber sur un profil réel : **HD Robust de Shure
espace les porteuses à 125 kHz et garde les produits à 2 émetteurs à 200**. Un
matériel du commerce contredisait l'invariant, donc l'invariant était faux.

La règle devient :

- les formes à **2 émetteurs** ne sont jamais confrontées à leurs propres
  générateurs, **quelle que soit la valeur de l'espacement**. Le produit est à
  la distance d'une porteuse voisine que l'espacement autorise ou interdit
  déjà, et il est plus faible qu'elle : l'espacement décide. C'est la seule
  lecture sous laquelle les profils HD de Shure sont cohérents ;
- les formes à **3 émetteurs** sont écartées seulement si la règle qui
  mesure leur résidu tourne effectivement (l'espacement de la paire, sauté
  entre zones `isolated` ; les formes à 2 émetteurs, qui exigent que les deux
  autres générateurs se voient) — et alors **elle décide avec sa propre garde,
  quelle qu'en soit la valeur**, exactement comme pour les formes à
  2 émetteurs.

`resolveConfig` n'exige plus que des entiers positifs.

**Troisième révision, 11/09/2026, quatrième audit.** La première version de
la règle ci-dessus écartait les formes à 3 émetteurs seulement si la règle
couvrante tournait *avec une garde au moins aussi large que celle de la
victime*. L'audit a montré que cette condition contredisait la lecture faite
des profils HD de Shure trois lignes plus haut : sur le même profil HD Robust
(espacement 125, 3T3O 150), deux porteuses à 125 kHz rendaient toute
troisième liaison implaçable au palier nominal, parce que `C + A − B` tombe à
125 kHz de `C`, et le moteur dégradait tout le plan pour la poser. Le profil
n'a de sens que si un produit n'est jamais confronté à son propre générateur ;
la comparaison de gardes est retirée. Physiquement, le signal utile est de
loin le plus faible des signaux présents au récepteur ; un produit qui l'a
pour générateur est d'autant plus faible.

Ce que l'audit n'a pas pu trancher, et que seul WWB peut : **deux ULXD4 HD
Robust à 150 kHz** sont-ils « 2T3O incompatible » ? **Trois HD Robust, deux à
125 kHz et la troisième loin** : la troisième est-elle « 3T3O incompatible » ?
`[À VALIDER JULIEN]` — si WWB signale l'un ou l'autre, la règle revient sous
une forme conditionnelle (écartée seulement si `espacement ≥ garde`) dans les
deux familles à la fois.

## D-006 — Garde IM3 séparée entre 2 et 3 émetteurs **[VALIDÉ 11/09/2026]**

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

Aucun ordre n'est imposé entre ces gardes : des profils du commerce le
contredisent (voir la révision de D-005). `resolveConfig` n'exige que des
entiers positifs ou nuls.

Justification physique : un produit à 3 émetteurs demande la coïncidence de
trois porteuses dans la même non-linéarité et sort nettement plus bas qu'un
produit à 2 émetteurs. Les outils constructeurs règlent d'ailleurs ces deux
familles séparément.

Capacité mesurée (`pnpm --filter @easyhf/engine bench`), 470–694 MHz, pas
25 kHz, canal 200 kHz, 50 retours arrière par passe :

| Garde IM3 3tx | placement compact | placement spread |
|---|---|---|
| 200 kHz | 27 | 24 |
| 150 kHz | 29 | 26 |
| **100 kHz** | **37** | 29 |
| 75 kHz | 37 | 32 |
| 50 kHz | 46 | 39 |
| 25 kHz | 57 | 51 |

**Relevé Wireless Workbench 7.8.3.18 (11/09/2026, Julien).** Profils de
compatibilité livrés par Shure pour un récepteur ULXD4 bande G50, en kHz :

| Mode | Profil | Espacement | 2T3O | 2T5O | 3T3O |
|---|---|---|---|---|---|
| Standard | More Frequencies | 350 | 0 | 0 | 0 |
| Standard | **Standard** (défaut) | 350 | **75** | 0 | **0** |
| Standard | Robust | 350 | 150 | 0 | 0 |
| HD | Standard | 125 | 150 | 0 | 0 |
| HD | Robust | 125 | 200 | 0 | 150 |

Trois enseignements :

1. **Shure ne vérifie ni le 3ᵉ ordre à 3 émetteurs ni le 5ᵉ ordre par défaut.**
   3T3O n'est activé qu'en HD Robust ; 2T5O est à 0 dans tous les profils. Nos
   défauts (200 / 100 / 90) sont plus conservateurs que le profil Robust de
   Shure (150 / 0 / 0).
2. **Ces valeurs sont propres à chaque série de matériel** — l'espacement lui-même
   (350 kHz pour l'ULX-D en mode Standard, 125 en HD) est une propriété du
   profil matériel, pas un réglage de coordination. Les gardes devraient donc
   être portées par la base matériel (phase 1), avec un jeu global en repli. Le
   brief le prévoyait (« spacing rules par modèle », §4 Phase 0) ; c'est
   maintenant étayé.
3. **Filtre d'entrée ±100 MHz, fixe.** WWB ne compte un produit que si ses
   générateurs sont à moins de 100 MHz de la victime. EasyHF compte tout. Sur
   des plans étalés sur plus de 100 MHz (C10 : 534 à 656 MHz), WWB signalera
   moins qu'EasyHF, par choix de modèle et non par erreur. À décider en phase 1
   si le filtre d'entrée entre dans la base matériel.

Au passage, les préférences de coordination de WWB exposent « Number of
passes : 10 000 » et « Maximum fruitless experiments : 5 000 » : son
auto-coordination est une recherche aléatoire bornée. Cela éclaire D-015 — le
palier atteint par un glouton n'est pas celui d'un outil qui tire au sort.

**Décision de Julien (11/09/2026) :** le jeu global reste **200 / 100 / 90**,
plus conservateur que le profil Robust de Shure. En phase 1, chaque modèle de
la base matériel peut déclarer ses propres gardes ; le jeu global ne
s'applique qu'aux modèles qui n'en déclarent pas. Le relevé Axient Digital et
une série Sennheiser restent à faire pour alimenter ces valeurs par modèle.

## D-007 — Placement par défaut : compact **[VALIDÉ 11/09/2026]**

*Phase 0.* Deux stratégies déterministes sont disponibles :

- `compact` — la fréquence libre la plus basse. Le plan tient dans le minimum de
  canaux TV : moins de spectre à garder propre, et de la place laissée aux
  autres prestataires du site.
- `spread` — le milieu du plus large intervalle libre. Plus de marge sur chaque
  porteuse, au prix de l'encombrement.

Sur 12 liaisons dans 534–598 MHz : `compact` occupe 15,7 MHz, `spread` 62,0 MHz.
`compact` place aussi 10 à 23 % de liaisons de plus (tableau D-006). Le défaut
est donc `compact`, `spread` reste offert.

**Décision de Julien (11/09/2026) :** compact par défaut, confirmé.

## D-008 — Budget de retour arrière : 50 pas par passe

*Phase 0, révisé.* Le retour arrière chronologique rend très peu sur ce
problème : la liaison qui échoue est rarement celle qu'il faudrait déplacer.
Mesuré sur 40 liaisons à gardes nominales, placement compact :

| Budget | Liaisons placées | Durée |
|---|---|---|
| 0 | 36 | 0,1 s |
| **50** | **37** | 0,5 s |
| 100 | 37 | 0,9 s |
| 200 | 37 | 1,1 s |
| 2 000 | 37 | 9,7 s |

Au-delà de 50, on paie des secondes pour rien — et on les paie surtout sur les
**paliers qui échouent** : chaque pas reconstruit un masque en O(m³), deux
passes par palier (D-016), trois paliers ratés avant le bon sur une charge de
40 liaisons. À 100 pas, ce cas coûtait 2,7 s sur la machine de build ; à 50,
1,7 s, pour la même capacité (au plus une liaison d'écart sur tout le tableau
de D-006). Le paramètre reste exposé (`maxBacktrackSteps`).

## D-009 — Échelle de robustesse, et sur quelles gardes le plan est jugé

*Phase 0.* Quand aucun plan complet n'existe aux gardes nominales, elles sont
dégradées par paliers : `[1, 0.8, 0.6, 0.45, 0.3]`. L'indice atteint est
`robustness.level` (0 = nominal), et il est rendu dans le résultat, donc
affichable et imprimable.

Le plan retourné est revérifié **avec les gardes réellement appliquées**, pas
avec les nominales : sinon `ok` serait faux pour un plan que le moteur assume.
C'est `robustness.level > 0` qui signale la dégradation, et l'interface devra le
montrer sans ambiguïté.

## D-010 — Deux zones en désaccord : la plus contraignante gagne ; sans politique, espacement seul

*Phase 0, révisé le 11/09/2026.* `interZonePolicy` est déclarée par zone, donc
deux zones peuvent se contredire (l'une `isolated`, l'autre `full-intermod`).
EasyHF retient la plus contraignante des deux. Un plan ne doit jamais être
desserré parce qu'une seule des deux zones était optimiste.

**Les zones sans politique déclarée valent `spacing-only`** — décision de
Julien après le relevé Wireless Workbench (D-022) : entre RF zones, WWB
conserve l'espacement et ne calcule aucune intermodulation. Jusqu'au 11/09 le
défaut était `full-intermod`, plus strict que la référence du métier, et il
sur-contraignait un festival à deux scènes éloignées. Une zone peut toujours
être déclarée `full-intermod` (co-localisée) ou `isolated` (site séparé)
explicitement, et le modèle de domaine (`Zone.interZonePolicy`) l'exige.

Le cas de référence C10 déclare ses deux scènes `full-intermod` : c'est ainsi
que WWB l'a analysé, en une seule RF zone, et son plan témoin doit rester
celui que WWB a validé.

## D-011 — Les largeurs de canal élargissent les gardes

*Phase 0.* Les gardes du brief sont des distances entre porteuses. Un canal large
demande davantage :

- espacement d'une paire = `max(garde, (largeur₁ + largeur₂) / 2)` ;
- garde vis-à-vis d'une exclusion = `max(garde, largeur / 2)` ;
- une porteuse doit tenir dans le spectre autorisé **demi-largeur comprise**
  (deux bandes autorisées contiguës comptent pour une).

Les gardes d'intermodulation, elles, **ne sont pas élargies** : ce sont des
distances porteuse → produit, fixes, comme dans les outils du métier. Un produit
à 150 kHz d'une porteuse dont le canal fait 800 kHz passe avec la garde 3
émetteurs à 100 kHz. C'est voulu, et c'est le même choix des deux côtés du
moteur.

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
Activer IM5 peut ajouter des avertissements ; **à liaisons placées égales**, il
ne coûte plus un palier. La réserve compte : quand la première passe place
*plus* de liaisons à un palier plus bas, le moteur garde ce plan-là — « plus de
liaisons d'abord » — et le palier final peut être plus élevé qu'IM5 désactivé
(6 scènes sur 300 dans le fuzz de la troisième revue). Un test l'affirme sur une
charge assez serrée pour atteindre l'échelle, à placements égaux.

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

## D-019 — Bande 863–865 MHz : pas en v1 **[VALIDÉ 11/09/2026]**

*Phase 0.* `data/bands/fr.json` ne contient pas la bande 863–865 MHz, utilisée
par des micros sans fil d'entrée de gamme au titre des dispositifs à faible
portée (recommandation ERC 70-03). Pour un outil qui se veut multi-marques,
c'est probablement une omission — mais je ne l'ajoute pas : le §7 du brief
interdit de trancher seul sur du réglementaire, et la règle « pas de
modification sans source » vaut aussi pour les ajouts.

**Décision de Julien (11/09/2026) :** pas en v1. La cible est le matériel
professionnel en UHF ; la bande sera revue en v1.5 avec sa source.

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

## D-022 — Le modèle de visibilité est « côté récepteur » **[VALIDÉ 11/09/2026]**

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

**Ce que fait Wireless Workbench (relevé du 11/09/2026).** Deux sondes en
RF zones distinctes : `500.000` et `494.000 = 2×500.000 − 506.000` en zones
séparées → compatibles ; `500.000` et `500.100` en zones séparées →
incompatibles, « channel spacing ». **WWB conserve l'espacement entre zones et
ne calcule aucune intermodulation entre elles : c'est exactement notre
`spacing-only`.** Il n'offre ni `full-intermod` ni `isolated` entre zones.

Conséquence pour D-010 : notre défaut `full-intermod` pour une zone sans
politique est plus conservateur que la pratique de Shure. Le garder rend le
moteur plus strict que la référence ; passer à `spacing-only` l'aligne dessus.
Les deux se défendent, et ce n'est pas à moi de trancher.

**Décision de Julien (11/09/2026) :** défaut inter-zones `spacing-only`,
comme WWB (voir D-010). Le modèle côté récepteur est conservé. Le diagnostic
par liaison non placée reste un livrable de la phase 4.

**Le cas concret à trancher, trouvé par la troisième revue.** Deux zones
`isolated` (deux salles qui réutilisent le spectre — c'est leur raison d'être)
et une zone `full-intermod` entre elles. Par D-010, la zone du milieu voit les
deux autres. Alors `A + B − C` retombe sur B à `|A − C|` **quelle que soit B** :
si A et C sont à 50 kHz l'une de l'autre, aucune liaison de la zone du milieu
n'est plaçable, et si A = C, elles restent non assignées à tous les paliers
avec `violations: []`. Le moteur est cohérent avec son modèle — les deux
porteuses arrivent bien dans les récepteurs du milieu — mais l'opérateur reçoit
trois liaisons non placées sans une ligne d'explication.

Deux questions en une : (1) `isolated` doit-il vraiment être annulé par un
voisin `full-intermod` (D-010), et (2) quoi qu'il en soit, le résultat doit
dire **pourquoi** une liaison n'est pas placée. Le second point est un
livrable de la phase 4 (écran « Coordonner »), et demandera au moteur un
diagnostic par liaison non assignée — à concevoir après la réponse au premier.

## D-023 — Gardes par modèle, lues côté récepteur

*Phase 1, 11/09/2026.* Chaque `EngineLink` peut porter ses propres gardes,
champ par champ au-dessus du jeu global (D-006) ; la base matériel les fournit
via `HardwareProfile.guards`. Sémantique, alignée sur Wireless Workbench où le
profil de compatibilité appartient à l'appareil :

| Contrainte | Garde appliquée |
|---|---|
| Produit d'intermodulation | celle de la **porteuse touchée** (la victime) |
| Espacement d'une paire | la **plus grande** des deux, élargie par les largeurs de canal |
| Exclusion | celle de la porteuse elle-même |

L'échelle de robustesse (D-009) multiplie les gardes de chaque liaison par le
même facteur que le jeu global, et la re-vérification finale du plan reçoit les
gardes exactes de chaque liaison au palier retenu.

Conséquence sur D-005 : une règle « couvrante » peut désormais tourner avec une
garde plus petite que celle de la victime ; elle décide quand même (troisième
révision de D-005). Deux tests de détection le verrouillent sur le vérificateur
seul (`check.test.ts`, « per-model guards »), et la comparaison exhaustive
parcourt cinq jeux de gardes mélangés — du profil Standard de Shure (75 / 0 / 0)
au nôtre — sur trois zones.

Le résultat de `coordinate` expose `robustness.linkGuards`, les gardes exactes
auxquelles chaque liaison a été tenue au palier retenu : `robustness.guards`
seul ne suffit plus à rejouer la vérification quand des liaisons portent des
gardes propres, et un consommateur qui l'aurait fait aurait obtenu un `ok`
contraire à celui du moteur.

Les valeurs par modèle elles-mêmes restent à saisir : la base livre les plages
et les pas, les gardes viendront des relevés WWB (Axient Digital, Sennheiser)
demandés à Julien.

## D-024 — La base matériel est validée contre Wireless Workbench, pas contre les PDF

*Phase 1, 11/09/2026.* Les sites constructeurs ne se laissent pas lire depuis
l'environnement de build (applications JavaScript, 403). Or **WWB embarque la
base d'équipements de Shure** — plages, pas, filtre d'entrée, profils de
compatibilité — pour ses séries et pour des marques tierces, et elle est sur
l'écran de Julien. C'est une source constructeur, plus fiable qu'une fiche
commerciale.

Les 55 entrées initiales (19 séries ; System 10 d'Audio-Technica, en 2,4 GHz,
est différé faute de bande dans `fr.json`) sont toutes `verified: false`, avec
leur source officielle et, quand un chiffre n'est pas sûr, une note qui le dit.
Le validateur (`pnpm validate:hardware`, en CI) impose le schéma, l'unicité
des identifiants, des plages plausibles, et `verifiedAt` dès que `verified`
passe à vrai. Rien ne passe à `verified: true` sans un relevé de Julien.

## D-025 — Spectera (WMAS) entre dans la base en v1, modélisé comme une porteuse large

*Phase 1, 11/09/2026, à la demande de Julien.* Les deux références du retour
d'oreille aujourd'hui sont Sennheiser Spectera et Shure Axient Digital PSM ;
Dushow France vient d'investir dans Sound Devices Astral. Les trois entrent
dans la base (Spectera 6 et 8 MHz, ADPSM G56 et K54, A20-Nexus / A20-Mini /
A20-TX / A20-RX), toutes `verified: false` avec source officielle.

ADPSM et Astral sont des liaisons à bande étroite classiques : rien à changer
dans le moteur. Spectera est un système **WMAS** (bloc multicanal de 6 ou
8 MHz, bidirectionnel), que le brief place en non-objectif v1 et en feuille de
route v3. En v1, une entrée Spectera est modélisée comme **une seule porteuse
de 6 000 ou 8 000 kHz de large** : le vérificateur élargit l'espacement par la
largeur de canal (D-023), donc aucune liaison étroite ne peut être posée dans
le bloc, ce qui est le comportement attendu. Ce que ce modèle **ne fait pas** :
les produits d'intermodulation d'un bloc large ne sont pas calculés (la
porteuse centrale sert de générateur, ce qui est faux pour un bloc OFDM), et
la répartition interne des canaux du bloc n'est pas gérée. Le type `wmas` est
ajouté au schéma pour que la v3 sache quelles entrées reprendre ; le validateur
tolère les largeurs jusqu'à 10 MHz pour ce seul type.

~~`[À VALIDER JULIEN]` : rester sur ce modèle en v1 (recommandé, conforme au
brief) ou avancer la modélisation par bloc à la phase 1.~~ **Tranché le
11/09/2026 par Julien : « le WMAS est l'avenir, c'est à implémenter now ».**
Le modèle par bloc est en phase 1 — voir D-026. Le non-objectif WMAS du brief
est levé.

## D-026 — Un système WMAS est un bloc : victime sur toute sa largeur, générateur sur demande

*Phase 1, 11/09/2026, sur décision de Julien.* Un WMAS (Spectera : 6 ou
8 MHz, OFDM/TDMA bidirectionnel, jusqu'à plusieurs dizaines de liaisons audio
gérées par la station de base) entre dans le moteur comme une liaison de type
`wmas` (`EngineLink.kind`). Sa `channelWidthKHz` est la largeur du bloc, sa
plage d'accord celle du **centre** du bloc — la base matériel la dérive de la
plage RF de l'entrée en la rentrant d'une demi-largeur, sur la grille.

| Règle | Liaison étroite (inchangé) | Bloc WMAS |
|---|---|---|
| Espacement avec une autre porteuse | centre à centre, `max(garde, largeurs)` — comme WWB | **au-delà du bord** : `largeurs + garde` ; la garde d'espacement de l'entrée est donc sa garde de bord |
| Exclusion (TNT, scan) | `max(garde, demi-largeur)` | `demi-largeur + garde` |
| Bande autorisée | canal entier dans la bande | bloc entier dans la bande |
| Victime d'un produit d'intermodulation | distance centre à produit | distance **au bord du bloc** : un produit qui tombe dedans est à 0 |
| Générateur de produits | toujours | **non par défaut** ; `config.wmasAsImGenerator` l'active, le produit est alors l'intervalle qu'il peut occuper (`Σ|cᵢ|·hᵢ`) et la distance se mesure entre intervalles |

Pourquoi le bloc ne génère pas par défaut : le produit d'un bloc OFDM de
6 MHz avec une porteuse étroite s'étale sur 6 à 12 MHz ; sa densité dans un
récepteur étroit est 15 à 18 dB sous celle d'un produit étroit de même
puissance totale. Ce n'est pas nul, et l'option existe pour qui veut
sur-signaler ; mais l'activer par défaut interdirait des dizaines de MHz
autour de chaque bloc sans mesure derrière. `[À VALIDER JULIEN]` sur la
documentation Sennheiser (recherche en cours) : garde de bord recommandée,
immunité du bloc aux produits étroits qui y tombent (aujourd'hui comptés avec
les gardes IM de l'entrée, lecture prudente), pas de placement du centre.

Ce que le modèle ne fait toujours pas : la répartition interne des liaisons
audio dans le bloc (c'est le travail de la station de base) et la capacité
par bloc — donnée de la base matériel, à afficher en phase 4, pas une
contrainte du moteur.

Vérification : les deux moitiés du moteur sont comparées candidat par
candidat avec un bloc verrouillé, avec le bloc comme liaison libre, avec deux
blocs générateurs, et sur des scènes aléatoires où une porteuse sur six est un
bloc et la liaison libre l'est une fois sur deux — générateur activé ou non.
Les 137 tests à bande étroite sont inchangés, fichiers témoins compris : la
généralisation est une extension stricte (toutes les demi-largeurs à 0
redonnent l'arithmétique d'origine).

**Sources retrouvées le 12/09/2026**, qui confirment les trois choix de
modélisation :

- *Garde de bord.* Livre blanc Sennheiser sur la coordination de fréquences :
  « While it is recommended that the same minimum guard distance as with
  narrowband systems is kept, the WMAS system proved to be extraordinarily
  robust […] ». C'est exactement la règle codée : au bord du bloc, la garde
  d'espacement pleine, comme entre deux porteuses étroites.
  https://www.sennheiser.com/globalassets/digizuite/44596-en-technical_paper_on_frequency_coordination-1.pdf
- *Pas d'intermodulation interne.* Même document : « None of the devices speak
  at the same time, so each device enjoys the full RF channel bandwidth on its
  own » (OFDM / TDD / TDMA, une seule porteuse RF). Le bloc n'a donc pas de
  produits internes à calculer.
- *Le bloc génère peu vers l'extérieur.* Le système entier rayonne la
  puissance d'un seul émetteur étroit (typiquement 50 mW p.a.r.) étalée sur 6
  ou 8 MHz : « A 200 kHz narrowband receiver will receive only a small fraction
  (1/30 or 1/40) », soit moins de 1,25 mW dans sa bande. Le masque WMAS de
  l'ETSI EN 300 422-1 V2.2.1 (figure 3) descend à −40 dB au bord du bloc et
  −60 dB à ±B. D'où `wmasAsImGenerator` à faux par défaut.

Ce qui reste ouvert, faute de publication : **le pas de placement du centre du
bloc** (absent des fiches produit, du manuel WebUI et de la documentation
LinkDesk — 25 kHz retenu comme hypothèse), et **si la valeur saisie dans
LinkDesk est le centre ou le bord bas** du bloc (le livre blanc dit « a 6 MHz
or 8 MHz block with a centre frequency », un article d'aide dit « start
frequency »). `[À VALIDER JULIEN]` : une capture de LinkDesk ou de la WebUI
Spectera tranche les deux d'un coup.

## D-027 — Le WMAS est légal en France aujourd'hui, sans limite de largeur

*Phase 1, 12/09/2026.* Vérifié avant d'ouvrir le moteur aux blocs, parce qu'un
outil de coordination française ne doit pas proposer un plan illégal.

| Texte | Ce qu'il dit |
|---|---|
| **ARCEP, décision n° 2015-0830** du 2 juillet 2015, art. 2 | La bande 470–694 MHz « n'est pas soumise à autorisation individuelle » ; les conditions techniques « consistent en une limitation à 50 mW (17 dBm) de la puissance apparente rayonnée », sauf retours son et liaisons d'ordre (1 W). **Aucune condition de canalisation, de largeur de bande ni de modulation.** Pas de redevance. |
| **CEPT ERC/REC 70-03, annexe 10** | Colonne « modulation / largeur de bande occupée maximale » : *Not specified* pour toutes les sous-bandes micros. Les limites de largeur ont été retirées en 2018. |
| **ETSI EN 300 422-1 V2.2.1** (2021-11) | Norme harmonisée couvrant le WMAS ; largeur de canal déclarée « up to 20 MHz (for WMAS) », masque d'émission dédié (figure 3). |
| **Décision (UE) 2025/105** du 22 janvier 2025 | Remplace 2014/641/UE pour le PMSE audio ; ne fixe aucun paramètre de largeur. |

Conclusion : **un bloc Spectera de 8 MHz à 50 mW p.a.r. est licite en France
dans 470–694 MHz, sans autorisation individuelle ni redevance.** C'est cohérent
avec le déploiement documenté des Francofolies de La Rochelle 2025 (2 stations
de base, 4 blocs de 8 MHz, 42 émetteurs).

Deux réserves, sans effet sur le moteur v1 : la hausse à 100 mW approuvée en
CEPT (juin 2024) n'est pas transposée en France, donc EasyHF s'en tient à
50 mW ; et la page de synthèse de l'ANFR affiche des chiffres incohérents avec
la décision ARCEP — c'est la décision ARCEP qui fait foi.

Le moteur ne modélise pas les puissances en v1 ; cette décision documente
pourquoi le WMAS y a sa place, et fournit les références à citer si un
utilisateur conteste un plan.

## D-028 — Quatre entrées corrigées sur documentation constructeur

*Phase 1, 12/09/2026.* Les fiches et guides PDF des constructeurs ont pu être
lus cette fois (les pages HTML restent inaccessibles). Corrections, toutes
tracées dans les notes des entrées :

| Entrée | Avant | Après | Source |
|---|---|---|---|
| Sennheiser EW 100 G4 GB | 606–678 MHz | **606–648 MHz** | fiche de fréquences Sennheiser bande GB ; 606–678 est la GBw des 300/500 G4 |
| Shure QLX-D L51 | 632–696 MHz | **L52, 632–694 MHz** | section « Frequencies for European Countries » du guide QLX-D ; L51 632–696 est la bande ULX-D |
| Shure SLX-D H55 | 514–558 MHz | **H56, 518–562 MHz** | fiche technique SLX-D ; H55 est la variante nord-américaine |
| Shure ADPSM K54 | 606–663 MHz | **K55, 606–694 MHz** | guide ADPSM v2.2 ; K54 est la variante nord-américaine, avec des trous de bande |

Les trois premières étaient les doutes relevés par le quatrième audit : les
trois étaient fondés. Ajouts de la même passe :

- **Noms d'appareils ADPSM** : ADTQ / ADTD (émetteurs), ADXR (récepteur
  ceinture). Pas d'accord 25 kHz confirmé. Le guide ne publie pas de largeur de
  canal en kHz, seulement une efficacité spectrale par mode (FM 9, bande
  étroite 17, Multi-Channel Wideband 28 canaux par 6 MHz) ; les 200 kHz de
  l'entrée valent pour le mode bande étroite. Le mode WMAS d'ADPSM aura son
  entrée quand sa largeur sera sourcée.
- **Sound Devices Astral** : plage 169–1525 MHz (A20-Nexus, A20-TX, A20-RX ;
  l'A20-Mini reste 470–1525), et surtout des **gardes par modèle sourcées** —
  le guide dit « the A20 digital RF transmission is inherently immune to
  intermodulation […] Systems can be used together when separated by at least
  400 kHz ». D'où gardes d'intermodulation à 0 et espacement à 400 kHz (D-023).
  C'est la première entrée de la base dont les gardes viennent d'un texte
  constructeur plutôt que du jeu global.
- **Spectera** : les deux entrées « 470–694 » sont remplacées par six, une par
  segment réellement accordable de la licence **ZONE 01** (UE + AELE,
  Royaume-Uni, Turquie) et par largeur : UHF 470–608, UHF 630–698 et
  1350–1400 MHz, en 6 et en 8 MHz. Le segment 608–630 MHz n'existe pas chez
  Spectera, et la borne haute française (694 MHz) est appliquée par le plan de
  bandes, pas par l'entrée.

Toutes restent `verified: false` : ces chiffres viennent de la documentation
constructeur, pas d'un relevé de Julien dans WWB (D-024).

## D-029 — La base d'équipements de Wireless Workbench est lisible, et EasyHF la lit chez l'utilisateur

*Phase 1, 12/09/2026.* **Wireless Workbench 7 embarque toute sa base
d'équipements dans un fichier SQLite non chiffré, à l'intérieur de
l'application :**

```
/Applications/Wireless Workbench.app/Contents/Resources/PrePackagedSeries2.3ds
```

Elle contient 1 130 variantes de bande sur 101 séries et 15 constructeurs
(Shure, Sennheiser, AKG, Audio-Technica, Lectrosonics, Sony, Sound Devices,
Wisycom, Electro-Voice, Telex…), avec pour chacune la **plage réellement
accordable**, le **pas d'accord**, les **sous-plages** quand la bande a des
trous, et les **profils de compatibilité** : espacement porteuse à porteuse et
gardes d'intermodulation aux 3e, 5e, 7e et 9e ordres, pour les trois niveaux du
curseur de WWB. Les noms internes se lisent `median` = *Standard*,
`robust` = *Robust*, `quantity` = *More Frequencies*.

**Contrôle décisif.** Les valeurs de la base pour l'ULXD4 G50 sont exactement
celles que Julien avait relevées à l'écran en phase 0 : Standard 350 / 75 / 0 /
0, Robust 350 / 150, HD Standard 125 / 150, HD Robust 125 / 200 / 0 / 150,
filtre d'entrée ±100 MHz. Les relevés manuels étaient donc justes, et notre
lecture du schéma aussi — chacun valide l'autre.

**Ce que EasyHF en fait, et ne fait pas.** Ce fichier appartient à Shure et
n'est concédé qu'à qui a installé WWB. **Rien de son contenu n'est versionné
ici.** À la place, le paquet livre un outil qui le lit là où il se trouve, sur
la machine de l'utilisateur :

```
pnpm --filter @easyhf/hardware-db import:wwb [chemin du .3ds]
```

Il sort un rapport — pas un correctif automatique : plages qui diffèrent, pas
d'accord qui diffèrent, bandes à trous, ordres que le moteur ne modélise pas,
entrées absentes de WWB. Une entrée ne passe à `verified: true` que sur
décision humaine (D-024), mais la question de fin de phase 1 se règle
désormais par une commande au lieu de 67 relevés à l'écran. L'outil demande
Node 22.5 ou plus (module `node:sqlite`) ; la bibliothèque, elle, reste sur
Node 20.

**Ce que le rapport a trouvé sur nos 67 entrées.** 23 plages étaient fausses,
d'une façon systématique : nous arrondissions au MHz (470,000) là où le
matériel commence 125 kHz plus haut (470,125). C'est exactement le défaut que
D-017 veut interdire — le moteur pouvait proposer une fréquence que l'appareil
ne peut pas afficher. Toutes corrigées, toujours `verified: false`.

Restent trois familles, que le modèle de données ne sait pas décrire :

| Constat | Entrées | Ce qui manque |
|---|---|---|
| Pas d'accord 0 dans WWB : l'appareil n'a que des canaux préréglés | les 3 BLX | une liste de fréquences par entrée |
| Bande à trous | AD K54 (3 sous-plages), QLX-D S50 (2) | plusieurs plages par entrée |
| Gardes aux 7e et 9e ordres | les 3 BLX, 100 à 175 kHz | ces ordres dans le moteur |

Les trois ne touchent que du matériel analogique ou nord-américain, et les
deux premières sont le même manque : une entrée incapable de dire ce que la
machine accorde vraiment. `[À VALIDER JULIEN]` — les traiter en phase 1, ou
les laisser en dette avec la note qui les signale. Recommandation : les
sous-plages en phase 1 (c'est une correction, le moteur propose aujourd'hui des
fréquences inaccordables), les 7e et 9e ordres jamais (aucun matériel numérique
ne les utilise).

**Effet de bord intéressant.** WWB porte une colonne `is_imd_source` par série
et par profil : certains appareils ne comptent pas comme source
d'intermodulation. C'est exactement l'axe que le moteur vient d'acquérir pour
les blocs WMAS (D-026). Le jour où les gardes par modèle seront importées, la
colonne se branchera dessus sans rien changer.

## D-030 — EasyHF est une application native de la série Invecter, en achat unique **[VALIDÉ 13/09/2026]**

*Phase 1, décidé par Julien.* La phase 4 du brief prévoyait une PWA autonome
et le brief produit renvoyait le paiement hors de la v1. Les deux changent.

**La décision.** EasyHF sort comme **cinquième application native de la série
Invecter** (iOS et Android, hors ligne), vendue en **achat unique, sans
abonnement**, comme les quatre autres.

**Pourquoi le natif dans Invecter plutôt qu'une application web.** Ce n'est pas
que le mobile permettrait de facturer — une application web se vend très bien,
SoundBase et IntermodExplorer le font. C'est que **la distribution et le
paiement sont déjà résolus** : le store encaisse, référence, et quatre
applications existantes peuvent renvoyer vers la cinquième. Sur le web il
faudrait construire comptes, facturation et acquisition, soit des mois de
travail qui ne sont pas le produit. Pour un développeur seul, c'est décisif.

S'y ajoutent deux raisons de fond :

- **L'acheteur est rigoureusement le même.** Invecter s'adresse aux
  professionnels de l'événementiel — son, lumière, vidéo, réseau, régie,
  broadcast. C'est exactement l'utilisateur d'EasyHF, pas un public voisin.
- **Gear est un fossé, pas une synergie vague.** Gear tient déjà un inventaire
  hors ligne avec étiquettes QR, kits et préparation de mission. Une
  coordination est un inventaire de liaisons rattachées à des références
  matériel. Scanner l'étiquette d'un émetteur pour construire le plan est un
  geste qu'aucun constructeur ne peut offrir, puisqu'aucun ne connaît le parc
  des autres.

**Pourquoi l'achat unique et pas un abonnement.** Toute la série est en achat
unique ; casser ce choix pour la cinquième application contredirait la
promesse faite aux clients. Et ces clients travaillent par projet : un
abonnement mensuel se résilie entre deux tournées. L'entretien des données —
base matériel, réglementation, exclusions télé — sera financé par des
**versions majeures payantes**, annoncées comme telles dès le départ. Si le
service d'exclusions télé devient un jour un vrai service en ligne, par lieu et
par date, c'est ce morceau-là qui pourra s'abonner, pas l'application.

**Positionnement, face au concurrent réel.** Shure a sorti en juillet 2025
*Wireless Workbench Mobile* (ex-ShurePlus Channels), gratuit, qui coordonne des
fréquences sur iOS. EasyHF n'est donc **pas** la première application HF sur
téléphone. Ses quatre limites définissent notre place :

| Wireless Workbench Mobile | EasyHF |
|---|---|
| matériel Shure uniquement | toutes marques |
| exige d'être connecté aux récepteurs en Wi-Fi ou Ethernet | prépare le plan avant d'arriver, hors ligne |
| ne supporte pas l'Axient Digital PSM | WMAS modélisé (D-026) |
| aucune donnée ni réglementation françaises | plan de bandes et exclusions par pays |

**Ce que ça change dans le code : rien pour l'instant.** Le moteur n'a aucune
dépendance, ni DOM, ni horloge, ni aléa — il tourne dans une coquille native
comme dans un service worker. `shared` et `hardware-db` sont également neutres.
La décision ne porte que sur l'enveloppe de la phase 4 : coquille native à deux
plateformes et présence sur les stores, au lieu d'une PWA.

**Restent à trancher**, et volontairement laissés ouverts ici :

- `[À VALIDER JULIEN]` **le prix**, que je ne connais pas faute de connaître la
  grille Invecter. Recommandation : le haut de la grille, cette application
  évitant qu'un plateau tombe en panne.
- `[À VALIDER JULIEN]` **le multi-pays.** La série Invecter est mondiale, EasyHF
  est construite pour la France. Le code est déjà neutre — le moteur ne connaît
  pas la France, le plan de bandes est un fichier de données portant un champ
  `country`, et aucune bibliothèque ne le lit. Ajouter l'Allemagne ou le
  Royaume-Uni est un fichier JSON de plus. Le vrai coût par pays est
  l'automatisation des exclusions télé. Le multi-pays est un non-objectif v1 du
  brief : en faire une prémisse v1 demande le même amendement conscient que
  celui fait pour le WMAS. Deux décisions seraient alors à rouvrir, D-019 (la
  bande 863-865 MHz, écartée en France mais utilisée en Allemagne) et la
  restriction du QLX-D S50 à sa sous-plage française.
- `[À VALIDER JULIEN]` **l'ordre des phases.** Recommandation : après la phase 1,
  une tranche verticale mince — coordination, exclusions saisies à la main,
  export PDF — dans la coquille Invecter, mise entre les mains de trois
  coordinateurs réels, *avant* l'automatisation ANFR et les formats d'échange.
  Le risque le plus lourd du produit n'est pas technique : c'est de savoir si un
  plan de 24 liaisons est utilisable sur un téléphone. C'est un écart assumé
  avec la méthode phase-gate.

## D-031 — EasyHF est multi-pays **[VALIDÉ 13/09/2026]**

*Phase 1, décidé par Julien.* Le multi-pays était un non-objectif v1 du brief.
La série Invecter étant mondiale (D-030), il devient une prémisse. Même
amendement conscient que pour le WMAS.

**Le code est déjà prêt, c'était mesuré avant de décider :** le moteur ne
contient aucune connaissance de la France — seules traces, une valeur
d'énumération `tnt-anfr` servant d'étiquette et un commentaire signalant que
les messages sont en français. Le plan de bandes est un fichier de données
portant déjà un champ `country`, et aucune bibliothèque ne le lit : le moteur
reçoit les bandes en paramètre. `hardware-db` est neutre. Un pays de plus est
donc un fichier JSON, pas un changement d'architecture.

**Ce qui coûte réellement par pays, c'est l'exclusion des émetteurs de
télévision.** Chaque pays a sa source : ANFR en France, Ofcom au Royaume-Uni,
BNetzA en Allemagne, FCC aux États-Unis. Quatre chaînes de traitement
différentes. D'où la règle : **la saisie manuelle des exclusions et l'import de
scans marchent partout dès le premier jour**, et l'automatisation par pays suit
la demande réelle des utilisateurs Invecter.

L'Europe est presque gratuite : la recommandation CEPT 70-03 couvre tout le
continent et la norme ETSI EN 300 422 est harmonisée. L'Allemagne autorise
470–608 et 614–698 MHz à 50 mW, le Royaume-Uni 470–606 et 614–703. Les bornes
diffèrent, la structure est identique. Les entrées Spectera encodent déjà la
licence ZONE 01, qui couvre l'Union, l'AELE, le Royaume-Uni et la Turquie. Les
États-Unis sont un vrai chantier séparé : bandes FCC différentes, WMAS plafonné
à 6 MHz, régimes licencié et non licencié.

**Deux décisions à rouvrir, conséquence directe :**

- **D-019** écartait la bande 863–865 MHz de la v1 parce qu'elle n'est pas
  ouverte au PMSE audio en France. Elle l'est ailleurs, notamment en Allemagne.
  La décision reste juste pour `fr.json` et fausse pour les autres plans.
- **Le QLX-D S50** a été restreint à sa sous-plage française 823,125–831,875 MHz
  alors que le matériel accorde aussi 863,125–864,875. C'était confondre deux
  rôles : **une entrée matériel décrit le matériel, c'est le plan de bandes qui
  filtre.** La correction demande les sous-plages (une des trois questions
  ouvertes de D-029), puisqu'une seule plage ne sait pas décrire ce trou.

`[À VALIDER JULIEN]` : quel pays après la France. Recommandation, par coût
croissant et par proximité avec les utilisateurs Invecter — Belgique, Suisse et
Allemagne, puis Royaume-Uni.
