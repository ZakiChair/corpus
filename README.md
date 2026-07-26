# CORPUS

Terminal d'analyse des séries du corps. Applique la boîte à outils quantitative d'un
terminal financier — z-scores, régimes, corrélations décalées, études d'événement,
lissages exponentiels — au sommeil, à la variabilité cardiaque, au poids, à la charge
d'entraînement et au ressenti.

Tout est local. Aucun compte, aucune synchronisation, aucun appel réseau.

```bash
npm install
npm run dev        # http://localhost:5230
npm test           # tests unitaires (Vitest)
npm run test:e2e   # parcours navigateur (Playwright)
npm run build
```

Au premier lancement, la fenêtre **DONN** s'ouvre : le bouton « Générer 18 mois » remplit
l'application d'un historique de démonstration.

## Ce que ça répond

Les applications de santé grand public affichent des courbes et un score propriétaire.
Elles ne répondent pas aux questions qu'on se pose réellement :

- Mon sommeil de mardi explique-t-il ma variabilité cardiaque de mercredi, ou l'inverse ?
- Combien de jours après une grosse séance ma VFC revient-elle à sa ligne de base ?
- Quel est l'effet moyen d'une soirée arrosée sur ma fréquence au repos — mesuré sur mes
  trente soirées à moi, pas sur une étude clinique ?
- Ma valeur d'aujourd'hui est-elle basse dans l'absolu, ou basse pour un lundi de janvier ?

Ce sont des questions d'étude d'événement, de corrélation décalée et de percentile
conditionnel. La finance quantitative les traite depuis quarante ans.

## Fenêtres

Chaque fenêtre a un mnémonique de quatre lettres, comme sur un terminal. `⌘K` ouvre la
palette, le menu **Fenêtres** les liste toutes. Glisser une fenêtre contre un bord
l'ancre — moitié d'écran sur les bords gauche et droit, quart à leurs extrémités,
plein écran en haut — et la ré-attraper lui rend sa taille d'avant. Double-clic sur
la barre de titre : agrandir.

| | | |
|---|---|---|
| `BLAN` | Bilan | État composite du jour, une tuile par métrique : valeur, z-score (brut ET conditionné au jour de semaine), rang percentile |
| `SIGN` | Signaux | Ce qui est inhabituel en ce moment : écarts à 2 σ, records, changements de palier, charge hors habitude |
| `SERI` | Séries | Graphe multi-métriques, zoom et panoramique, repères d'événements |
| `LOAD` | Charge | Charge aiguë et chronique, forme, ratio aigu/chronique, monotonie |
| `COMP` | Comparaison | Ce bloc vs le précédent : écart des médianes de toutes les métriques, avec intervalle |
| `CORR` | Corrélations | Matrice décalée : qui précède quoi, et de combien de jours |
| `EVTS` | Événements | Réponse moyenne d'une métrique autour d'un type d'événement |
| `HYPO` | Hypothèses | « Les jours où X est dans son quart bas, que vaut Y le lendemain ? » |
| `SAIS` | Saisie | Saisie manuelle du jour, bornée par le catalogue |
| `ANNO` | Journal | Événements datés : séances, sorties, voyages, maladies |
| `DONN` | Données | Import, synchronisation, sauvegarde, démonstration, effacement |

Les fenêtres se répondent : une tuile de BLAN, une relation de CORR, une ligne de SIGN ou
de COMP, un événement d'ANNO ouvrent SERI déjà réglée sur la chose cliquée ; le jour
survolé dans SERI se trace dans LOAD, et inversement. `⌥←` / `⌥→` / `⌥↑` ancrent la
fenêtre au premier plan, `⌥↓` la restaure ; le menu Fenêtres enregistre des dispositions
nommées, rappelables à la palette. L'application s'installe en PWA et s'ouvre hors ligne.

## Décisions qui structurent tout le reste

**Grain journalier.** Une métrique est une suite de `{ jour, valeur }`, au plus un point
par jour. Les objets d'intérêt — VFC au réveil, poids du matin, durée de sommeil, charge
d'une séance — sont intrinsèquement journaliers. Descendre à l'intra-journalier
multiplierait le volume par trois cents sans servir une seule des analyses.

**Convention temporelle.** La ligne du jour J porte la nuit qui s'achève le matin J et
l'activité de la journée J. Sommeil et VFC sont donc contemporains ; une séance de
l'après-midi ne se lit que sur la mesure du lendemain. Tous les décalages en découlent.

**Le générateur de démonstration simule un modèle causal, pas du bruit.** Un générateur
naïf produirait des métriques indépendantes — matrice de corrélation nulle, études
d'événement plates, régimes constants : l'application paraîtrait cassée alors que le code
serait juste. Les effets injectés sont déclarés dans `EFFETS` (`src/donnees/generateur.ts`)
et **retrouvés par les tests des modules d'analyse**, ce qui fait de ce fichier à la fois
une source de données et le banc d'essai de la couche analytique.

**Descriptif, jamais prescriptif.** Tout le texte généré passe par `src/analyse/lecture.ts`,
et la règle y tient en une ligne : on décrit la donnée (« VFC à 1,2 σ sous ta normale
30 j »), on ne recommande jamais de conduite. Corpus n'est pas un dispositif médical.

## Pièges rencontrés, et pourquoi ils comptent

Ces cinq points ont chacun coûté un correctif ; ils sont documentés en commentaire à
l'endroit concerné.

**Deux conventions différentes portent le nom « EMA ».** `2/(n+1)` est celle des moyennes
mobiles financières ; la physiologie de l'entraînement (Banister, TrainingPeaks) utilise
`1/tau`. Pour tau = 7 : 0,25 contre 0,143. Transposer un outil d'un domaine à l'autre
demande de vérifier les constantes, pas seulement les noms.

**Les décalages fantômes.** Deux séries à forte tendance corrèlent à ~0,95 à *tous* les
décalages ; prendre l'argmax d'un profil plat revient à tirer au sort puis à présenter le
tirage comme une découverte causale (« le poids précède la masse grasse de 4 jours »).
`meilleurDecalage` n'annonce un décalage que si son pic dépasse nettement la valeur
contemporaine.

**L'utilité n'est pas monotone.** Dormir deux heures de plus que d'habitude n'est pas un
signe de forme, c'est souvent le contraire. Sans plafond sur la contribution favorable du
sommeil, le régime composite restait tiède pendant les états qu'il devait signaler.

**Les fenêtres glissantes sont calendaires, pas indicielles.** Sur une série trouée, une
fenêtre de 30 *points* peut couvrir trois mois.

**Le z-score du jour exclut le jour lui-même.** L'inclure dans sa propre référence amortit
mécaniquement l'anomalie qu'on cherche à détecter.

## Import

| Format | État |
|---|---|
| **Apple Santé** | L'`export.zip` tel que l'app le produit (Profil → Exporter toutes les données), ou l'`export.xml` qu'il contient. Lecture en flux avec progression et annulation. |
| **Health Auto Export** | Le JSON de l'app iOS du même nom — c'est le format de la synchronisation continue ci-dessous, accepté aussi en dépôt manuel. |
| CSV | Séparateur, format de date et virgule décimale détectés. Conventions suisses comprises (`26.07.2026`, `74,7`, `12'480`). |
| Profil ATHLOS | Le JSON exporté par ATHLOS. Poids et tour de taille rejoignent le catalogue, les métriques de performance sont conservées telles quelles, les séances deviennent des annotations. |
| Sauvegarde CORPUS | Le JSON exporté depuis `DONN`. Si des données existent déjà, la restauration se confirme — remplacer ou fusionner. |

### Synchronisation continue (Apple Watch « en direct »)

Une app web locale ne peut pas parler à HealthKit ; le chemin vivant passe par un
dossier. Sur l'iPhone, **Health Auto Export** (ou un raccourci planifié) dépose un
export JSON/CSV dans iCloud Drive à intervalle régulier ; le dossier arrive sur le
Mac ; CORPUS le surveille (`DONN` → Synchronisation continue) et importe les
nouveaux fichiers chaque minute. File System Access API — navigateurs Chromium
uniquement. Dans le Finder, garder le dossier en « Toujours conserver sur ce Mac »,
sinon iCloud garde les fichiers dans le nuage et la lecture échoue. Une sauvegarde
CORPUS déposée dans ce dossier n'est jamais appliquée automatiquement.

### Sauvegarde automatique

Depuis `DONN` → Sauvegarder, « Copier chaque jour vers un dossier » écrit une copie JSON
quotidienne (un fichier par jour, rotation sur deux semaines) dans un dossier choisi —
un dossier iCloud Drive donne une sauvegarde hors machine sans aucun serveur. Le fichier
du jour est réécrit toutes les heures.

Les dates ambiguës sont lues **jour avant mois** (convention européenne) : `03/12/2026`
est le 3 décembre.

### Apple Santé — ce qui est vérifié, et ce qui ne l'est pas

Le parseur est testé contre un fixture écrit à la main, contre la lecture d'une archive ZIP
(stockée et deflate), contre un découpage du fichier à des frontières d'octets hostiles —
au milieu d'un attribut, d'un nom de balise, entre le `/` et le `>` — et de bout en bout
dans le navigateur sur un export synthétique de 120 jours et 5 107 enregistrements, livré
en `.zip`.

**Aucun export réel n'a encore été passé dans ce code.** Un vrai `export.xml` pèse plusieurs
centaines de mégaoctets ; la lecture est écrite en flux pour cette raison, mais le premier
import réel reste à faire.

Ce que l'import récupère : VFC, fréquence au repos, FC nocturne (le minimum entre minuit
et 8 h, résumé de la fréquence cardiaque instantanée), température du poignet, fréquence
respiratoire, VO₂max estimé, poids, masse grasse, tour de taille, pas, les quatre
métriques de sommeil, les séances, et le profil (naissance, sexe, taille). Les types non
pris en charge sont comptés puis ignorés, et la fenêtre le signale.

Quatre conventions à connaître :

- **Agrégation par métrique.** Les pas sont **sommés** sur la journée, tout le reste est
  **médiané**. Une médiane sur les pas donnerait un chiffre plausible et faux.
- **Les pas se dédoublonnent par source.** iPhone et Apple Watch comptent chacun les
  mêmes pas ; additionner les appareils doublerait la journée. La source la plus fournie
  du jour est retenue — elle peut légèrement sous-estimer, jamais doubler.
- **Une nuit appartient au jour du réveil.** Les segments sont regroupés en sessions (moins
  d'une heure d'écart), la durée est l'**union** des intervalles — sinon une montre et une
  application tierce couvrant la même nuit la compteraient deux fois. Les micro-éveils de
  moins de deux minutes ne comptent pas comme réveils.
- **La masse grasse est ambiguë** : Apple écrit `unit="%"` avec tantôt `15.2`, tantôt
  `0.152`. La décision se prend sur **tout le fichier** — si son maximum est ≤ 1, il est en
  fractions — et jamais enregistrement par enregistrement.

## Structure

```
src/
  core/        temps, métriques, types, séries, stockage, store
  analyse/     stats, alignement, corrélation, charge, événement, régime,
               saisonnalité, ruptures, comparaison, lecture
  donnees/     générateur causal, imports (Apple Santé, Health Auto Export, CSV,
               ATHLOS), lecture ZIP, synchronisation, sauvegarde automatique
  shell/       registre, gestionnaire de fenêtres, intentions, palette, thème
  ui/          domaine d'axe, zoom, jetons canvas, composants partagés
  fenetres/    une par mnémonique
e2e/           parcours Playwright dans le vrai navigateur
```

`IdFenetre` et `IdMetrique` sont **dérivés** de leurs registres via `as const satisfies` :
ajouter une fenêtre sans câbler son composant est une erreur de compilation, pas un écran
blanc découvert à l'exécution.

## Pile

Vite 8, React 19, TypeScript 6, Tailwind 4, Zustand 5, Zod 4, Vitest 4. Les graphes sont
en canvas 2D écrit à la main — aucune bibliothèque de charting.

---

CORPUS décrit tes données. Il ne pose aucun diagnostic et ne remplace aucun avis médical.
