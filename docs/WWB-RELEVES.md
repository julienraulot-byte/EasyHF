# Relevés Wireless Workbench 7 — mode opératoire

Pas-à-pas de la porte de phase 0, tel qu'il a été **réellement exécuté** le
11 septembre 2026 sur Wireless Workbench **7.8.3.18** (macOS). La première
version de ce document décrivait WWB 6 ; rien n'y correspondait à l'écran.
Celle-ci ne décrit que ce qui a été vu.

`VALIDATION.md` dit *pourquoi* ; ce document dit *comment*. Les relevés
eux-mêmes sont dans `packages/engine/test/fixtures/validation-cases.ts`,
champ `wwbReference`, et le test `validation.test.ts` les compare.

## 1. Ce que WWB 7 sait faire, et ne sait pas faire

- **Un verdict par fréquence**, *Compatible* / *Incompatible*, dans la colonne
  « Analysis results » de la liste de coordination. Le **texte au survol** de
  la ligne nomme la cause : « Channel to channel spacing violation », « Channel
  to 2T3O intermod spacing violation », « Channel to 2T5O … », « Overlapped by
  TV channel ». WWB **ne nomme pas les générateurs** du produit. La
  comparaison se fait donc sur les victimes.
- **Les distances appartiennent à un profil de compatibilité**, lui-même
  attaché à un couple modèle + bande (*Equipment profiles*). Le panneau
  « Compatibility » de la coordination les *affiche* ; il ne les édite pas.
  L'espacement entre porteuses (*Channel spacing*) est une propriété du
  matériel, non modifiable : **350 kHz** pour un ULX-D en mode Standard.
- **Filtre d'entrée ±100 MHz, fixe** : WWB ignore les produits dont les
  générateurs sont à plus de 100 MHz de la victime.
- **RF zones** (Tools → Manage RF zones…) : entre zones, WWB conserve
  l'espacement et ne calcule aucune intermodulation — notre `spacing-only`.
- **Aucune règle réglementaire française** : 700 MHz est « compatible ».
- L'auto-coordination (*Calculate*) est une recherche aléatoire (« Number of
  passes 10 000, Maximum fruitless experiments 5 000 »). **On ne l'utilise
  jamais** : elle remplacerait les fréquences que l'on veut vérifier.

## 2. Préparation, une seule fois

1. Show vierge, sauvegardé `EasyHF-validation`.
2. Onglet **Frequency coordination** → panneau de droite **Spectrum** : vérifier
   « No TV channels to avoid », « No frequencies to avoid ». Sinon, roue
   crantée *TV channels* → tout décocher → Save. (Seul C07 remet des canaux.)
3. **Tools → Equipment profiles…** → Manufacturer *Shure*, Model *ULXD4*,
   Band *G50* (470,125–534,000 MHz, pas 25 kHz), Transmission mode
   *Standard*. Section *Compatibility (3)* : **relever** les trois profils
   livrés (More Frequencies / Standard / Robust) — c'est la donnée de D-006 —
   puis **dupliquer Robust** (icône deux carrés) et régler le double :
   2T3O **200**, 2T5O **90**, 3T3O **100**, 2T7O et 2T9O 0. Le nommer.
   Répéter pour **chaque bande** qui servira (H50 pour C10, et une bande
   Axient Digital pour 606–657 MHz).

## 3. Saisir un cas

1. Panneau **Add frequencies** → Manufacturer Shure → Model ULXD4 → Band G50
   → Quantity = nombre de porteuses → *Primary* → **Add**. Les lignes
   apparaissent dans la liste, fréquence vide.
2. **Double-cliquer la cellule « Frequency (MHz) »** de chaque ligne et taper
   la valeur (`494.000`). WWB accepte la saisie telle quelle.
3. Sélectionner les lignes → **cadenas fermé** de la barre d'outils : les
   fréquences deviennent imposées.
4. Sur la ligne d'en-tête du groupe (`ULXD - G50 - Standard … Standard 3/3`),
   cliquer le nom du profil et choisir le profil EasyHF. Le panneau
   *Compatibility* doit afficher 200 / 90 / 100.
5. **Analyze** (jamais *Calculate*). Lire la colonne « Analysis results » et,
   pour chaque ligne incompatible, **le texte au survol**.
6. Relever : `cas — fréquence : verdict — cause au survol`.

Pour passer au cas suivant, éditer les cellules en place ; ajouter ou supprimer
des lignes au besoin.

## 4. Les cas, tels que relevés

Profil ULXD4 G50 « EasyHF2 » : espacement 350, 2T3O 200, 2T5O 90, 3T3O 100.

| Cas | Fréquences (MHz) | WWB | EasyHF | Verdict |
|---|---|---|---|---|
| C01 | 500.000 · 510.000 | tout compatible | rien | concordant |
| C02 | 500.000 · 506.000 · 494.000 | 506 et 494 incompatibles | HF02, HF03 (2T3O) | concordant |
| C03 | 500.000 · 506.000 · 494.200 | tout compatible | rien | concordant — **la règle de WWB est stricte** à la garde exacte, comme la nôtre |
| C04 | 500.000 · 505.300 · 508.400 · 513.700 | les quatre incompatibles | les quatre (3T3O) | concordant — aucun 2T3O n'approche, c'est le 3 émetteurs |
| C05 | 500.000 · 500.800 · 498.400 | 498.400 « 2T5O intermod » | HF03 (IM5) | concordant |
| C06 | peigne 500.000 → 505.600, pas 800 | les huit incompatibles | les huit | concordant |
| C07 | plan EasyHF, TNT 28–33 cochés | tout compatible | rien | concordant — le plan passe |
| C08 | 700.000 (ULXD4 M19) | compatible | hors bande | sur-signalement EasyHF assumé |
| C09 | 500.000 · 506.000 en scene1, 494.000 en scene2 | tout compatible | rien (`spacing-only`) | concordant |
| C10 | plan EasyHF 24 liaisons, 3 bandes | *en cours* | rien | — |

Sondes hors cas :

| Sonde | Résultat | Ce qu'elle établit |
|---|---|---|
| 500.000 · 500.300 | incompatibles, « channel spacing » | l'espacement ULX-D est 350 kHz |
| 500.000 · 500.600 et 500.000 · 500.700 | compatibles | … et pas 700 : « ±350 » se lit 350 entre porteuses |
| 500.000 en scene1, 500.100 en scene2 | incompatibles, « channel spacing » | entre RF zones, WWB garde l'espacement… |
| 494.000 en scene2 face à 500.000 · 506.000 en scene1 | compatible | … et ne calcule pas l'intermodulation : `spacing-only` |

Les cas C05 et C06 ont été redessinés pendant la campagne pour que leurs
écarts dépassent les 350 kHz d'espacement de WWB ; sans cela, un verdict
« spacing » masquait le produit que le cas devait isoler. Les relations
d'intermodulation sont inchangées (C06 garde ses 24 / 88 / 14 violations
chez EasyHF). C07 et C10 sont produits par EasyHF avec un espacement de
350 kHz pour la même raison.

## 5. Pièges rencontrés

- Le premier C05 (500.000 · 500.300 · 499.400) rendait trois lignes
  incompatibles. Deux l'étaient par espacement (300 < 350), la troisième par
  5ᵉ ordre — un seul texte au survol lu, et une conclusion fausse (« WWB exige
  700 kHz ») écrite puis réfutée par les sondes. **Lire le survol de chaque
  ligne incompatible**, pas d'une seule.
- Les canaux TV cochés pour C07 restent cochés pour les cas suivants : le
  534.000 de C10 est ressorti « Overlapped by TV channel ». **Décocher après
  C07.**
- Un profil de compatibilité n'existe que pour sa bande. Un plan sur trois
  bandes demande trois profils.
- Aucune bande ULX-D ne couvre 606–657 MHz d'un seul tenant : C10 utilise
  Axient Digital K54 et K55.

## 6. Ce que cette comparaison a établi, et ce qu'elle laisse ouvert

Établi : sur les familles modélisées (2T3O, 3T3O, 2T5O, espacement), EasyHF
signale tout ce que WWB signale, et rien de ce que WWB juge compatible, à la
garde exacte près, où les deux sont stricts. Un plan produit par EasyHF passe
WWB.

Ouvert, et consigné dans `DECISIONS.md` : la valeur des gardes par série
(D-006), le filtre d'entrée ±100 MHz que WWB applique et pas EasyHF (D-006),
le défaut inter-zones — strict ou comme WWB (D-022).
