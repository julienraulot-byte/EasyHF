# Validation du moteur — phase 0

Ce document est le support de la **kill question de la phase 0** :

> Sur les 10 cas de référence, le moteur détecte-t-il 100 % des violations IM3
> relevées par Wireless Workbench, avec un plan auto-assigné valide et
> reproductible ?

La réponse ne peut pas venir du code seul : elle demande d'exécuter les mêmes
cas dans Wireless Workbench et de comparer. Tant que ces exécutions n'ont pas eu
lieu, **la phase 0 n'est pas franchie**, quel que soit l'état des tests.

## Ce qui est déjà acquis

| Élément | État |
|---|---|
| Génération IM3 2tx, IM3 3tx, IM5 2tx | fait, testée |
| Vérification d'un plan, violations et marges | fait, testée |
| Assignation automatique déterministe | fait, testée |
| 10 cas de référence figés en fichiers témoins | fait |
| Accord exhaustif entre l'assignateur et le vérificateur | testé candidat par candidat, 27 combinaisons de politiques de zones |
| Reproductibilité octet pour octet | testée par propriétés ; vraie par construction entre machines (D-018) |
| Budget de performance (40 liaisons < 3 s) | tenu, ~1,6 s |
| Couverture `engine` | 99,9 % lignes, 99,1 % branches (seuil : 90 %) |
| **Comparaison avec Wireless Workbench** | **à faire — voir plus bas** |

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

À exécuter par Julien, une fois par cas.

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

Tant qu'aucun cas ne porte de `wwbReference`, la suite affiche le test
« en attente des relevés Wireless Workbench — la phase 0 reste ouverte ».

## Le test qui compte le plus, et pourquoi

`packages/engine/test/cross-validation.test.ts` n'est pas un test de plus : c'est
celui qui tient l'ensemble. `assign.ts` et `check.ts` encodent les mêmes règles
deux fois — l'un résout chaque produit pour la porteuse inconnue et bloque des
intervalles, l'autre énumère les produits et mesure des distances. Rien
n'oblige les deux à rester d'accord.

Le test offre donc à la recherche **chaque fréquence que la liaison pourrait
prendre**, une par une, et exige que son verdict coïncide exactement avec celui
du vérificateur. C'est ainsi qu'a été rattrapé le bug de visibilité inter-zones
décrit en D-020, qu'aucun test unitaire ne voyait. Toute règle ajoutée à l'un des
deux fichiers doit l'être à l'autre : ce test est le seul moyen de le savoir.

## Ce que cette validation ne couvre pas

- **Les valeurs de gardes** ne sont pas validées par la comparaison : elle valide
  la *détection*. Le recalage des seuils est l'objet de D-006.
- **La qualité du plan auto-assigné** n'est pas comparée à WWB, seulement sa
  validité et sa reproductibilité. Le plafond du glouton est documenté en D-015.
- **Aucune mesure RF réelle** n'intervient ici. Un plan validé sur table reste à
  confronter au terrain, et un scan sur site reste recommandé en toutes
  circonstances.
