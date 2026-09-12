# Validation du moteur — phase 0

Ce document est le support de la **kill question de la phase 0** :

> Sur les 10 cas de référence, le moteur détecte-t-il 100 % des violations IM3
> relevées par Wireless Workbench, avec un plan auto-assigné valide et
> reproductible ?

**Réponse, le 11 septembre 2026 : oui.** Dix cas exécutés dans Wireless
Workbench 7.8.3.18 par Julien, dix concordants. Sur les trois cas
d'intermodulation du 3ᵉ ordre (C02, C04, C06), EasyHF signale exactement les
victimes que WWB déclare incompatibles ; sur le cas limite (C03), les deux
outils sont stricts à la garde exacte ; sur le 5ᵉ ordre (C05), concordant ; et
les deux plans produits par EasyHF (C07, C10) passent WWB sans conflit. Le seul
écart est C08, où EasyHF rejette 700 MHz que WWB accepte — WWB ne connaît pas
la réglementation française, c'est du sur-signalement assumé.

Le détail des relevés, le mode opératoire réel et les pièges rencontrés sont
dans `WWB-RELEVES.md`. Les relevés eux-mêmes sont dans le code, champ
`wwbReference` de chaque cas, et `validation.test.ts` les rejoue à chaque
exécution de la suite.

## Ce qui est acquis

| Élément | État |
|---|---|
| Génération IM3 2tx, IM3 3tx, IM5 2tx | fait, testée |
| Vérification d'un plan, violations et marges | fait, testée |
| Assignation automatique déterministe | fait, testée |
| 10 cas de référence figés en fichiers témoins | fait |
| Accord exhaustif entre l'assignateur et le vérificateur | testé candidat par candidat : 27 combinaisons de politiques × 3 zones de départ, exclusions et bandes, grilles mélangées, scènes aléatoires |
| Détection inter-zones sur le vérificateur seul | deux cas construits à la main (D-021) |
| Reproductibilité octet pour octet | testée par propriétés ; vraie par construction entre machines (D-018) |
| Budget de performance (40 liaisons < 3 s) | tenu, 1,7 s sur la machine de build, mesuré seul (`pnpm test:perf`) |
| Couverture `engine` | 99,9 % lignes, 99,2 % branches (seuil : 90 %) |
| **Comparaison avec Wireless Workbench** | **10 / 10 concordants** |

## Les dix cas

Ils sont définis en un seul endroit,
`packages/engine/test/fixtures/validation-cases.ts`, et exécutés par
`packages/engine/test/validation.test.ts`. Chaque cas est comparé à un fichier
témoin dans `packages/engine/test/golden/`, si bien que toute évolution du
moteur apparaît comme une différence relisible plutôt que comme une surprise.

| Id | Ce que le cas verrouille |
|---|---|
| `C01-paire-propre` | Témoin négatif : une paire propre ne déclenche rien. |
| `C02-im3-2tx-direct` | Porteuse exactement sur `2·f1 − f2`. |
| `C03-im3-2tx-limite` | La garde est une inégalité stricte : 200 kHz passe. |
| `C04-im3-3tx` | Quadruplet `f1 + f4 = f2 + f3` : les quatre porteuses sont victimes. |
| `C05-im5-2tx` | 5ᵉ ordre isolé, signalé en avertissement et non en critique. |
| `C06-peigne-8` | Peigne régulier à 400 kHz : le pire cas classique. |
| `C07-exclusions-tnt` | Coordination contournant six canaux TNT. |
| `C08-bande-interdite` | Bande 700 MHz, interdite aux PMSE depuis le 01/07/2019. |
| `C09-deux-zones-spacing-only` | En `spacing-only`, l'intermodulation inter-zones est ignorée, pas l'espacement. |
| `C10-festival-24` | Charge réaliste : 24 liaisons, 2 scènes, 3 familles de matériel. |

Régénérer les témoins après un changement volontaire :

```sh
UPDATE_GOLDEN=1 pnpm test
```

La différence obtenue est à relire ligne à ligne : c'est le seul garde-fou
contre une régression silencieuse du plan produit.

## Protocole de comparaison avec Wireless Workbench

Le mode opératoire détaillé, avec les fréquences prêtes à saisir pour chaque
cas, est dans `docs/WWB-RELEVES.md`. Résumé :

1. Dans WWB, créer une **inclusion group** avec autant d'émetteurs que le cas en
   compte, en saisissant les fréquences exactes listées dans le fichier témoin
   correspondant (`packages/engine/test/golden/<id>.json`, champ `assignments`
   ou le plan d'entrée du cas).
2. Régler les distances de compatibilité de WWB sur celles d'EasyHF, ou noter
   les valeurs réellement utilisées par WWB — c'est aussi ce qui permettra de
   trancher **D-006** (garde IM3 à 3 émetteurs).
3. Lancer l'analyse de compatibilité et relever **chaque violation de 3ᵉ ordre** :
   la liaison victime, et les liaisons qui produisent le produit.
4. Reporter le relevé dans le cas correspondant, champ `wwbReference` :

```ts
wwbReference: {
  im3: [
    { victimLinkId: 'HF02', sourceLinkIds: ['HF01', 'HF03'] },
    { victimLinkId: 'HF03', sourceLinkIds: ['HF01', 'HF02'] },
  ],
  wwbVersion: 'Wireless Workbench 7.x.y',
  capturedAt: '2026-09-__',
  capturedBy: 'Julien',
},
```

5. Relancer `pnpm test`. Le test « détecte chaque violation IM3 signalée par
   Wireless Workbench » échoue en nommant toute violation vue par WWB et manquée
   par EasyHF.

**Critère de réussite** : EasyHF signale au moins toutes les violations IM3 que
WWB signale. Le sur-signalement est accepté — EasyHF applique aussi ses propres
règles d'espacement et de bande — le sous-signalement ne l'est pas.


## Deux familles de tests, qui ne se remplacent pas

`assign.ts` et `check.ts` encodent les mêmes règles deux fois — l'un résout
chaque produit pour la porteuse inconnue et bloque des intervalles, l'autre
énumère les produits et mesure des distances.

**Cohérence.** `cross-validation.test.ts` offre à la recherche chaque fréquence
que la liaison pourrait prendre, une par une, et exige que son verdict coïncide
avec celui du vérificateur. C'est ainsi qu'a été rattrapé le bug de visibilité
de D-020. Mais il est aveugle à une erreur que les deux côtés partagent — et
c'est ce qui est arrivé en D-021.

**Détection.** Les cas de `check.test.ts` intitulés « a product hitting its own
generator across zones » pinnent ce que le vérificateur doit trouver **seul**,
sans référence à la recherche. C'est là que doit aller tout nouveau cas de
sous-détection découvert, avant même sa correction.

## Ce que cette validation ne couvre pas

- **Les valeurs de gardes** ne sont pas validées par la comparaison : elle valide
  la *détection*. Le recalage des seuils est l'objet de D-006.
- **La qualité du plan auto-assigné** n'est pas comparée à WWB, seulement sa
  validité et sa reproductibilité. Le plafond du glouton est documenté en D-015.
- **Aucune mesure RF réelle** n'intervient ici. Un plan validé sur table reste à
  confronter au terrain, et un scan sur site reste recommandé en toutes
  circonstances.

---

# Validation de la base matériel — phase 1

Kill question de la phase 1 :

> Les 20 modèles sont-ils sourcés, validés par Julien, et le moteur produit-il
> des plans corrects en respectant plages et pas réels ?

État au 11 septembre 2026 :

| Élément | État |
|---|---|
| Schéma JSON et validateur en CI | fait |
| Entrées sourcées | 67 entrées, 22 séries, toutes `verified: false` |
| Gardes par modèle dans le moteur (D-023) | fait, comparaison exhaustive à gardes mélangées |
| Blocs WMAS dans le moteur (D-026) | fait, comparaison exhaustive bloc verrouillé / bloc libre / blocs générateurs |
| Chiffres Spectera | plages ZONE 01 et règle de garde sourcées chez Sennheiser (D-026) ; pas de placement du centre non publié |
| Base légale du WMAS en France | vérifiée : ARCEP 2015-0830, 50 mW p.a.r., aucune limite de largeur (D-027) |
| Le moteur respecte plages et pas réels | testé sur un parc mixte Shure / Sennheiser |
| **Validation des chiffres par Julien** | **à faire** — une commande : `pnpm --filter @easyhf/hardware-db import:wwb` compare les 67 entrées à la base d'équipements de WWB (D-029) |
| Plages corrigées sur la base WWB | 23 entrées, arrondies au MHz au lieu de la vraie borne accordable |

Mode opératoire de validation, depuis le 12/09/2026 : lancer
`pnpm --filter @easyhf/hardware-db import:wwb` sur la machine où WWB est
installé (D-029). L'outil lit la base d'équipements de WWB et sort les écarts,
entrée par entrée. À défaut, la méthode manuelle reste valable : dans WWB,
*Tools → Equipment profiles…*, pour chaque série de la base, lire le cadre
*Tuning* (From / To / Step Size) de chaque bande et le comparer à l'entrée. Toute correction est envoyée telle
quelle ; l'entrée passe alors à `verified: true` avec `verifiedAt`. Les gardes
par modèle sont lues dans les profils *Standard* / *Robust* de la même fenêtre.
