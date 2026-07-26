# CORPUS

Terminal d'analyse des séries du corps. Applique la boîte à outils quantitative d'un
terminal financier — z-scores, régimes, corrélations décalées, études d'événement,
lissages exponentiels — au sommeil, à la variabilité cardiaque, au poids, à la charge
d'entraînement et au ressenti.

Tout est local. Aucun compte, aucune synchronisation, aucun appel réseau.

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # 157 tests
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
palette, le menu **Fenêtres** les liste toutes.

| | | |
|---|---|---|
| `BLAN` | Bilan | État composite du jour, une tuile par métrique : valeur, z-score, rang percentile, courbe miniature |
| `SERI` | Séries | Graphe multi-métriques, zoom et panoramique, repères d'événements |
| `LOAD` | Charge | Charge aiguë et chronique, forme, ratio aigu/chronique, monotonie |
| `CORR` | Corrélations | Matrice décalée : qui précède quoi, et de combien de jours |
| `EVTS` | Événements | Réponse moyenne d'une métrique autour d'un type d'événement |
| `SAIS` | Saisie | Saisie manuelle du jour |
| `ANNO` | Journal | Événements datés : séances, sorties, voyages, maladies |
| `DONN` | Données | Import, génération de démonstration, export, effacement |

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
| CSV | Séparateur, format de date et virgule décimale détectés. Conventions suisses comprises (`26.07.2026`, `74,7`, `12'480`). 25 tests. |
| Profil ATHLOS | Le JSON exporté par ATHLOS. Poids et tour de taille rejoignent le catalogue, les métriques de performance sont conservées telles quelles, les séances deviennent des annotations. |
| Sauvegarde CORPUS | Le JSON exporté depuis `DONN`. |

Les dates ambiguës sont lues **jour avant mois** (convention européenne) : `03/12/2026`
est le 3 décembre. Apple Santé n'est pas encore pris en charge — un `export.xml` réel pèse
plusieurs centaines de mégaoctets et demande un parseur en flux.

## Structure

```
src/
  core/        temps, métriques, types, séries, stockage, store
  analyse/     stats, alignement, corrélation, charge, événement, régime, lecture
  donnees/     générateur causal, import CSV, import ATHLOS
  shell/       registre, gestionnaire de fenêtres, fenêtre flottante, palette, thème
  ui/          domaine d'axe, zoom, jetons canvas, composants partagés
  fenetres/    une par mnémonique
```

`IdFenetre` et `IdMetrique` sont **dérivés** de leurs registres via `as const satisfies` :
ajouter une fenêtre sans câbler son composant est une erreur de compilation, pas un écran
blanc découvert à l'exécution.

## Pile

Vite 8, React 19, TypeScript 6, Tailwind 4, Zustand 5, Zod 4, Vitest 4. Les graphes sont
en canvas 2D écrit à la main — aucune bibliothèque de charting.

---

CORPUS décrit tes données. Il ne pose aucun diagnostic et ne remplace aucun avis médical.
