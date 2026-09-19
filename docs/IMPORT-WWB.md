# Comparer la base matériel à celle de Wireless Workbench

Ce mode d'emploi sert à répondre à la question de fin de phase 1 : **nos 67
entrées disent-elles la vérité ?** Il se lance sur la machine où Wireless
Workbench est installé, et il ne modifie rien — ni le dépôt, ni WWB.

Compter vingt minutes la première fois, deux minutes les suivantes.

## Pourquoi sur ta machine, et pas sur la mienne

Wireless Workbench range toute sa base d'équipements dans un fichier SQLite
lisible, à l'intérieur de l'application. Ce fichier appartient à Shure et n'est
concédé qu'à qui a installé le logiciel. L'outil le lit donc **là où il est**,
chez toi, et rien de son contenu n'entre dans le dépôt (D-029).

## Prérequis

| Ce qu'il faut | Vérifier | Si ça manque |
|---|---|---|
| Wireless Workbench installé | l'application est dans `/Applications` | — |
| **Node 22.5 ou plus récent** | `node --version` | `brew install node` |
| pnpm 9 ou plus | `pnpm --version` | `npm install -g pnpm` |
| git | `git --version` | fourni avec les outils Xcode |

La version de Node est la seule contrainte inhabituelle : l'outil lit du SQLite
avec le module `node:sqlite`, arrivé dans Node 22.5. Sur une version plus
ancienne, il te le dira en clair plutôt que de planter.

## 1. Cloner le dépôt

```sh
mkdir -p ~/CODE && cd ~/CODE
git clone https://github.com/julienraulot-byte/EasyHF.git
cd EasyHF
```

La branche de travail est `claude/easyhf-build-launch-4wn98c`, et c'est aussi la
branche par défaut du dépôt : un clone simple tombe dessus. Pour en être sûr :

```sh
git branch --show-current     # doit afficher claude/easyhf-build-launch-4wn98c
```

## 2. Installer les dépendances

```sh
pnpm install
```

## 3. Vérifier que tout va bien avant de commencer

```sh
pnpm test
```

189 tests doivent passer. Si ce n'est pas le cas, envoie-moi la sortie et
arrête-toi là : inutile de comparer des données avec un moteur en panne.

## 4. Lancer la comparaison

```sh
pnpm --filter @easyhf/hardware-db import:wwb
```

Sans argument, l'outil cherche le fichier au chemin habituel sur macOS :

```
/Applications/Wireless Workbench.app/Contents/Resources/PrePackagedSeries2.3ds
```

Si WWB est installé ailleurs, donne le chemin :

```sh
pnpm --filter @easyhf/hardware-db import:wwb "/chemin/vers/PrePackagedSeries2.3ds"
```

Pour garder la sortie dans un fichier et me l'envoyer :

```sh
pnpm --filter @easyhf/hardware-db import:wwb > ~/Desktop/rapport-wwb.txt 2>&1
```

## 5. Lire le rapport

Il commence par deux nombres — combien de variantes de bande WWB contient, et
combien de nos entrées lui sont conformes — puis classe les écarts :

| Rubrique | Ce que ça veut dire |
|---|---|
| **Plages qui diffèrent** | notre plage d'accord n'est pas celle de WWB. À corriger, presque toujours de notre côté. |
| **Pas d'accord qui diffèrent** | un pas de 0 chez WWB signifie un appareil à canaux préréglés, que notre modèle ne sait pas décrire. |
| **Bandes à trous** | WWB connaît des sous-plages que notre entrée ne décrit pas, ou l'inverse. |
| **Bande absente de sa série** | WWB connaît la série mais pas ce code de bande. Notre code de bande est peut-être faux. |
| **Comparés à une autre série** | WWB ne connaît pas notre série ; la comparaison est indicative, pas une preuve. |
| **Ordres que le moteur ne modélise pas** | WWB garde les 7e et 9e ordres sur ce matériel. Dette assumée, rien à faire. |
| **Séries absentes de WWB** | à vérifier sur la documentation du constructeur, WWB ne peut pas aider. |

Au moment où j'écris, sur la base extraite : **41 entrées conformes, 29 points à
regarder**. Ta machine devrait donner la même chose, à la version de WWB près.

## 6. Me l'envoyer

Colle le rapport dans la conversation, ou envoie le fichier. Je m'occupe des
corrections, chacune sourcée, et aucune entrée ne passera en `verified` sans que
tu l'aies dit (D-024, D-034).

## En cas de problème

**`Impossible de lire la base WWB`** — le chemin est faux. Cherche le fichier :

```sh
find /Applications -name "PrePackagedSeries2*.3ds" 2>/dev/null
```

**`ne fournit pas « node:sqlite »`** — Node est trop ancien, il faut 22.5.

**`command not found: pnpm`** — `npm install -g pnpm`.

**Un test échoue à l'étape 3** — envoie-moi la sortie, ne continue pas.
