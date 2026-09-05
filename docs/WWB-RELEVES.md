# Relevés Wireless Workbench — mode opératoire

Ce document est le pas-à-pas de la porte de phase 0. Il complète
`VALIDATION.md`, qui dit *pourquoi* ; celui-ci dit *comment*, cas par cas, avec
les fréquences prêtes à saisir. Compter une heure et demie pour les dix cas.

Précaution sur les noms d'écrans : les libellés ci-dessous (« Frequency
Coordination », « Coordination Parameters », « 2T3O ») sont ceux de Wireless
Workbench 6. Ils peuvent bouger d'une version à l'autre ; ce qui compte est ce
que chaque étape cherche, pas le nom exact du bouton. Noter la version utilisée.

## 0. Préparation, une seule fois

1. **Créer un show vierge** nommé `EasyHF-validation`. Ne pas réutiliser un show
   de production : les paramètres de coordination y sont déjà modifiés.
2. **Neutraliser la TV.** Dans les paramètres de coordination, vider la liste des
   canaux TV à exclure (ou choisir une région sans TV). Les cas C01 à C06 sont
   autour de 500 MHz, en plein canal TNT français : WWB y ajouterait des conflits
   « TV » qui ne concernent pas la comparaison. Seul C07 remet des canaux TV.
3. **Régler les distances d'intermodulation sur celles d'EasyHF.** Dans
   « Coordination Parameters » (ou le profil de coordination du show) :

   | Paramètre WWB | Valeur |
   |---|---|
   | Channel-to-channel (espacement entre porteuses) | 300 kHz |
   | 2T3O — 3ᵉ ordre, 2 émetteurs | 200 kHz |
   | 3T3O — 3ᵉ ordre, 3 émetteurs | 100 kHz |
   | 2T5O — 5ᵉ ordre, 2 émetteurs | 90 kHz |
   | Ordres supérieurs (2T7O, 2T9O, 3T5O, 3T7O) | désactivés |

   Vérifier que 3T3O et 2T5O sont bien **activés** : sur certains profils ils
   sont à zéro ou décochés par défaut, et C04, C05, C06 seraient alors vides.
4. **Avant de les modifier, relever les valeurs par défaut** de WWB pour chacun
   de ses profils (« More Frequencies », « Standard », « More Robust », ou
   équivalents). Ce relevé sert D-006 (garde 3 émetteurs), indépendamment de la
   comparaison. Le noter dans un coin :

   ```
   WWB <version> — profil <nom> : ch-to-ch ___ / 2T3O ___ / 3T3O ___ / 2T5O ___
   ```
5. **Choisir comment saisir des fréquences nues.** Deux voies, selon la version :
   une liste d'inclusions (« Inclusions » / « Frequency List » de la
   coordination), ou des appareils hors ligne d'un modèle large bande dont la
   plage couvre 470–700 MHz. Peu importe laquelle : il faut que WWB **analyse la
   compatibilité** de ces fréquences entre elles et affiche les conflits par
   fréquence, avec les fréquences qui les produisent.

## 1. Ordre des cas

Commencer par ceux qui calibrent, finir par ceux qui coûtent de la saisie.

| Ordre | Cas | Ce qu'il apprend |
|---|---|---|
| 1 | C02 | WWB voit-il le 2T3O le plus évident ? Contrôle que la saisie marche. |
| 2 | C03 | **Calibration** : à exactement 200 kHz du produit, WWB signale-t-il ? EasyHF non (inégalité stricte). Si WWB oui, sa règle est `≤`, et il faudra l'écrire. |
| 3 | C05 | 2T5O activé et compté à part ? |
| 4 | C04 | 3T3O activé ? Combien de victimes sur le quadruplet (EasyHF : quatre) ? |
| 5 | C06 | Le peigne. Long à relever, mais c'est le cas qui départage vraiment deux moteurs. |
| 6 | C01 | Témoin négatif : rien attendu. |
| 7 | C08 | 700 MHz. WWB peut refuser la saisie : noter « non testable », ce n'est pas une règle d'intermodulation. |
| 8 | C07 | Plan **produit par EasyHF** autour de six canaux TV : WWB ne doit rien trouver. |
| 9 | C10 | Plan produit par EasyHF, 24 fréquences : WWB ne doit rien trouver. |
| 10 | C09 | Seulement si la version de WWB gère des zones ; sinon sauter et le noter. |

## 2. Pour chaque cas

1. Saisir les fréquences du cas (tableaux en §4). Vérifier deux fois : une
   erreur de saisie de 25 kHz invalide le relevé.
2. Lancer l'analyse de compatibilité.
3. Pour **chaque conflit** affiché, noter : la fréquence victime, le type
   (2T3O, 3T3O, 2T5O, espacement), et les fréquences génératrices telles que
   WWB les nomme.
4. Faire une capture d'écran de la liste des conflits. Elle tranchera les doutes
   de transcription.
5. Écrire le relevé dans le format ci-dessous, une ligne par conflit :

   ```
   C02  WWB 6.15.2
   2T3O  506.000  <=  500.000 + 494.000
   2T3O  494.000  <=  500.000 + 506.000
   ```

   Un cas sans conflit se note `C01  aucun conflit`.

Ne pas chercher à interpréter : relever ce que WWB affiche, y compris ce qui
paraît redondant ou étrange. C'est la comparaison qui interprète.

## 3. Ce qui se passe ensuite

Le relevé (texte + captures) est transcrit dans le champ `wwbReference` de
chaque cas, dans `packages/engine/test/fixtures/validation-cases.ts`, sous la
forme :

```ts
wwbReference: {
  im3: [
    { victimLinkId: 'HF02', sourceLinkIds: ['HF01', 'HF03'] },
    { victimLinkId: 'HF03', sourceLinkIds: ['HF01', 'HF02'] },
  ],
  wwbVersion: 'Wireless Workbench 6.15.2',
  capturedAt: '2026-09-12',
  capturedBy: 'Julien',
},
```

Puis `pnpm test`. Le test « detects every IM3 violation Wireless Workbench
reports » cesse d'être ignoré et échoue en nommant toute violation que WWB voit
et qu'EasyHF manque.

**Critère de la porte** : sur les dix cas, EasyHF signale au moins tous les
conflits 2T3O et 3T3O que WWB signale. Le sur-signalement d'EasyHF est accepté.
Les 2T5O sont comparés à titre informatif. Et sur C07 et C10, **WWB ne doit
trouver aucun conflit** — s'il en trouve un, c'est le point à traiter en premier,
avant tout le reste.

## 4. Les fréquences à saisir

Toutes en MHz, canal 200 kHz sauf mention. Ce qu'EasyHF signale est donné pour
comparaison immédiate ; les listes complètes sont dans `packages/engine/test/golden/`.

### C01 — paire propre

| Liaison | MHz |
|---|---|
| HF01 | 500.000 |
| HF02 | 510.000 |

EasyHF : rien.

### C02 — porteuse sur 2·f1 − f2

| Liaison | MHz |
|---|---|
| HF01 | 500.000 |
| HF02 | 506.000 |
| HF03 | 494.000 |

EasyHF : 2T3O sur HF02 (2×HF01 − HF03) et sur HF03 (2×HF01 − HF02), à 0 kHz.

### C03 — porteuse à exactement 200 kHz du produit

| Liaison | MHz |
|---|---|
| HF01 | 500.000 |
| HF02 | 506.000 |
| HF03 | 494.200 |

EasyHF : rien (le produit 494.000 est à 200 kHz, garde 200, inégalité stricte).
**Noter précisément** si WWB signale ou non.

### C04 — quadruplet f1 + f4 = f2 + f3

| Liaison | MHz |
|---|---|
| HF01 | 500.000 |
| HF02 | 505.300 |
| HF03 | 508.400 |
| HF04 | 513.700 |

EasyHF : quatre 3T3O, une par porteuse, à 0 kHz. Aucun 2T3O.

### C05 — porteuse sur 3·f1 − 2·f2

| Liaison | MHz |
|---|---|
| HF01 | 500.000 |
| HF02 | 500.300 |
| HF03 | 499.400 |

EasyHF : un seul 2T5O sur HF03 (3×HF01 − 2×HF02), aucun 3ᵉ ordre.

### C06 — peigne à 400 kHz

| Liaison | MHz |
|---|---|
| PEIGNE1 | 500.000 |
| PEIGNE2 | 500.400 |
| PEIGNE3 | 500.800 |
| PEIGNE4 | 501.200 |
| PEIGNE5 | 501.600 |
| PEIGNE6 | 502.000 |
| PEIGNE7 | 502.400 |
| PEIGNE8 | 502.800 |

EasyHF : 24 × 2T3O, 88 × 3T3O, 14 × 2T5O, tous à 0 kHz. Relever au minimum
**la liste des victimes par type** et, pour 2T3O, les paires génératrices. Pour
3T3O, une capture suffit si WWB en affiche des dizaines.

### C07 — plan produit par EasyHF autour de six canaux TV

**Remettre** dans WWB les canaux TV 28 à 33 en exclusion (526–574 MHz) avant
l'analyse.

| Liaison | MHz |
|---|---|
| HF01 | 510.000 |
| HF02 | 510.300 |
| HF03 | 510.800 |
| HF04 | 511.900 |
| HF05 | 512.300 |
| HF06 | 513.200 |

EasyHF : rien. **WWB ne doit rien trouver non plus.**

### C08 — bande 700 MHz

| Liaison | MHz |
|---|---|
| HF01 | 700.000 |

EasyHF : hors bande (règle réglementaire, pas d'intermodulation). Si WWB refuse
la saisie, noter « non testable ».

### C09 — deux zones en spacing-only

Uniquement si WWB gère des zones. Scène 1 : A1, A2. Scène 2 : B1. Entre les
deux scènes, seul l'espacement compte, pas l'intermodulation.

| Liaison | Zone | MHz |
|---|---|---|
| A1 | scène 1 | 500.000 |
| A2 | scène 1 | 506.000 |
| B1 | scène 2 | 494.000 |

EasyHF : rien (B1 est sur 2×A1 − A2, mais dans une autre zone).

### C10 — plan produit par EasyHF, 24 liaisons

Tout saisir **dans une seule zone** : les deux scènes du cas sont en
`full-intermod`, ce que WWB fait par défaut. IEM en canal 300 kHz.

| Liaison | MHz | | Liaison | MHz |
|---|---|---|---|---|
| SC1-01 | 534.000 | | IEM-01 | 606.000 |
| SC1-02 | 534.475 | | IEM-02 | 606.375 |
| SC1-03 | 535.200 | | IEM-03 | 607.000 |
| SC1-04 | 536.750 | | IEM-04 | 608.375 |
| SC1-05 | 538.500 | | SC2-01 | 616.100 |
| SC1-06 | 540.600 | | SC2-02 | 621.700 |
| SC1-07 | 541.425 | | SC2-03 | 625.400 |
| SC1-08 | 544.000 | | SC2-04 | 630.700 |
| SC1-09 | 545.650 | | SC2-05 | 633.850 |
| SC1-10 | 548.125 | | SC2-06 | 646.200 |
| SC1-11 | 551.625 | | SC2-07 | 648.075 |
| SC1-12 | 556.475 | | SC2-08 | 656.025 |

EasyHF : rien, au palier 0. **WWB ne doit rien trouver non plus.**

## 5. Ce que la comparaison ne dira pas

- Elle ne valide pas les **valeurs** des gardes, seulement la détection à gardes
  égales. Les valeurs par défaut de WWB relevées en §0.4 sont l'entrée de D-006.
- Elle ne dit rien du multi-zones, hormis C09 si WWB le permet. Les cas
  inter-zones sont couverts par les tests de détection de D-021 et par la
  question D-022, qui reste à trancher.
- Elle ne remplace pas un scan sur site.
