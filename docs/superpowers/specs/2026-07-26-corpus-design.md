# Corpus — terminal d'analyse du corps

**Date** : 2026-07-26
**Statut** : spec de la v0.1, écrite avant implémentation
**Auteur** : session autonome (Zaki dormait)

## 1. L'idée en une phrase

Corpus applique la boîte à outils quantitative d'un terminal financier — z-scores,
régimes, corrélations décalées, études d'événement, moyennes mobiles exponentielles —
aux séries temporelles du corps : sommeil, variabilité cardiaque, fréquence au repos,
poids, charge d'entraînement, ressenti.

## 2. Pourquoi ça n'existe pas déjà

Les applications de santé grand public (Apple Santé, Whoop, Garmin, Oura) affichent des
séries et un « score » propriétaire opaque. Elles ne répondent jamais aux questions que
l'on se pose réellement :

- Est-ce que mon sommeil de mardi explique ma VFC de mercredi, ou l'inverse ?
- Combien de jours après une grosse séance ma VFC revient-elle à sa ligne de base ?
- Quel est l'effet moyen d'une soirée alcoolisée sur ma fréquence cardiaque de repos,
  mesuré sur mes trente soirées et pas sur une étude clinique ?
- Ma valeur d'aujourd'hui est-elle basse dans l'absolu, ou basse pour un lundi de janvier ?

Ce sont exactement des questions d'**étude d'événement**, de **corrélation décalée** et de
**percentile conditionnel**. La finance quantitative les traite depuis quarante ans. Corpus
transpose l'outillage.

### Positionnement dans l'atelier

- **ATHLOS** suit la performance et la morphologie. Vérifié dans le code : aucune trace de
  sommeil, de VFC, de fréquence cardiaque de repos ni de composition corporelle.
  Corpus occupe cet espace vide et pourra importer un profil ATHLOS.
- **AXIOM** fournit la mécanique de terminal : gestionnaire de fenêtres, kit de graphes
  canvas, thèmes. Corpus la porte plutôt que la réinvente.

## 3. Décisions d'architecture

### 3.1 Grain journalier

Une métrique est une suite de points `{ jour: 'YYYY-MM-DD', valeur: number }`, au plus un
point par jour. C'est la décision de modélisation structurante.

Justification : les objets d'intérêt de Corpus — VFC au réveil, durée de sommeil, poids du
matin, charge d'une séance, ressenti du soir — sont intrinsèquement journaliers. Descendre
à l'intra-journalier ferait exploser le volume (une fréquence cardiaque toutes les cinq
minutes sur cinq ans, c'est cinq cent mille points par métrique) sans servir une seule des
analyses prévues. Les imports agrègent au jour à l'entrée.

### 3.2 Tout local, aucun serveur

Ce sont des données de santé. Elles ne quittent pas la machine. Pas de compte, pas de
synchronisation, pas de télémétrie, pas d'appel réseau au démarrage.

Contrairement à AXIOM, **pas de démon** : AXIOM en a besoin pour contourner les quotas
d'API tierces et le CORS. Corpus ne consomme aucune API externe, la question ne se pose
pas. Persistance en IndexedDB derrière une interface `AdaptateurStockage` (le point de
substitution, comme le `StorageAdapter` d'ATHLOS).

### 3.3 Le générateur causal est un composant de premier plan

Corpus démarre sans données. Un générateur naïf produirait du bruit indépendant par
métrique — et alors la matrice de corrélation serait nulle, les études d'événement plates,
les régimes constants. L'application paraîtrait cassée alors que le code serait juste.

Le générateur simule donc un **modèle causal explicite** dans lequel sont injectés les
effets exacts que les fenêtres doivent retrouver.

La convention temporelle est posée d'abord, parce qu'elle détermine tous les décalages :
la ligne du jour J porte **la nuit qui s'achève le matin J** et **l'activité de la journée
J**. Sommeil et VFC sont donc mesurés le même matin et n'ont aucun décalage entre eux,
tandis qu'une séance faite l'après-midi ne peut se lire que sur la mesure du lendemain.

- charge du jour J → VFC déprimée le matin J+1 ;
- soirée alcoolisée le soir J → pic de fréquence au repos le matin J+1 ;
- courbatures maximales à J+1, résiduelles à J+2 ;
- dette de sommeil accumulée → VFC du même matin ;
- rythme hebdomadaire : grasse matinée le week-end ;
- tendance lente du poids sur trois phases, avec un bruit de rétention d'eau corrélé à la
  charge et à l'alcool ;
- épisodes de maladie : effondrement multi-jours de la VFC.

Ces effets injectés deviennent les assertions des tests : un test qui vérifie que le module
de corrélation retrouve le décalage de 1 jour est à la fois un vrai test unitaire et la
preuve que la fenêtre affichera quelque chose de vivant.

### 3.4 Descriptif, jamais prescriptif

Les lectures générées décrivent la donnée (« VFC à 1,2 σ sous ta médiane 30 jours ») et ne
recommandent jamais une conduite (« tu devrais te reposer »). Corpus n'est pas un
dispositif médical et le dit dans l'interface. Cette contrainte est facile à tenir
maintenant, pénible à rétrofiter dans un générateur de texte.

## 4. Modèle de données

```ts
type IdMetrique = string          // 'vfc', 'fc_repos', 'sommeil_duree', 'poids'…
type Jour = string                // 'YYYY-MM-DD'

interface Point { j: Jour; v: number }
type Serie = Point[]              // trié par jour croissant, un point par jour au plus

interface DefinitionMetrique {
  id: IdMetrique
  label: string                   // français
  unite: string
  famille: 'recuperation' | 'sommeil' | 'morphologie' | 'charge' | 'subjectif'
  sens: 'haut' | 'bas'            // 'haut' = une valeur élevée est favorable
  min: number; max: number        // bornes plausibles, utilisées à l'import
  decimales: number
}

interface Annotation {
  id: string
  j: Jour
  type: 'seance' | 'alcool' | 'voyage' | 'maladie' | 'stress' | 'blessure' | 'autre'
  intensite?: number              // 0..1
  note?: string
}

interface EtatCorpus {
  version: number
  series: Record<IdMetrique, Serie>
  annotations: Annotation[]
  profil: { taille?: number; sexe?: 'h' | 'f' | 'nsp'; naissance?: Jour }
  creeLe: Jour
}
```

Catalogue v0.1 — quinze métriques réparties en cinq familles : récupération (VFC,
fréquence au repos), sommeil (durée, sommeil profond, heure de coucher, réveils),
morphologie (poids, masse grasse, tour de taille), charge (charge de séance, pas),
subjectif (énergie, humeur, courbatures, stress).

## 5. Modules d'analyse

Fonctions pures, sans DOM, testées directement — la convention d'AXIOM.

| Module | Contenu |
|---|---|
| `stats.ts` | moyenne, écart-type, médiane, quantile, z-score, EMA, médiane glissante, rang percentile |
| `alignement.ts` | intersection de deux séries sur les jours communs, gestion des trous |
| `correlation.ts` | Pearson, Spearman, corrélation décalée sur une plage de décalages, matrice complète |
| `charge.ts` | charge aiguë et chronique (EMA 7 et 42 jours), ratio aigu/chronique, monotonie et contrainte de Foster |
| `evenement.ts` | réponse moyenne autour d'un événement, avec intervalle de confiance |
| `regime.ts` | état composite à partir de z-scores combinés |

## 6. Fenêtres

Le shell est celui d'AXIOM : registre statique de fenêtres, `IdFenetre` **dérivé** du
registre via `as const satisfies` (oublier une entrée dans la table des composants devient
une erreur de compilation), fenêtres flottantes déplaçables et redimensionnables, palette
de commandes, thèmes.

| Mnémonique | Fenêtre | Rôle |
|---|---|---|
| `BLAN` | Bilan | tuiles du jour : valeur, z-score 30 j, rang percentile, sparkline |
| `SERI` | Séries | graphe multi-séries, zoom et panoramique, normalisation, marqueurs d'annotations |
| `LOAD` | Charge | aiguë / chronique / forme, ratio aigu-chronique avec zone de risque, monotonie |
| `CORR` | Corrélations | matrice en carte de chaleur, sélecteur de décalage, meilleur décalage par paire |
| `EVTS` | Événements | réponse moyenne d'une métrique autour d'un type d'annotation |
| `SAIS` | Saisie | saisie manuelle rapide du jour |
| `ANNO` | Journal | liste et ajout d'annotations |
| `DONN` | Données | import CSV et profil ATHLOS, génération de démonstration, export JSON |

Écartées de la v0.1 pour tenir le périmètre : distribution et cyclicité (repliées en badge
de percentile dans Bilan et en bande hebdomadaire dans Séries), et le rapport textuel.

## 7. Import

- **CSV** — priorité 1, testable : une colonne date, N colonnes métriques, séparateur et
  format de date détectés.
- **Profil ATHLOS** — priorité 1 : le `Profile` JSON exporté par ATHLOS, dont les
  `Metric.history` se transposent directement en séries Corpus.
- **Apple Santé** — LIVRÉ après la v0.1. Lecture en flux de l'`export.zip` ou de
  l'`export.xml`, avec progression et annulation, et lecture ZIP par le catalogue central
  pour éviter de matérialiser le fichier. Validé contre un fixture, contre des archives
  ZIP construites à la main, contre un découpage à des frontières d'octets hostiles, et de
  bout en bout dans le navigateur sur un export synthétique de 120 jours. Reste non vérifié
  contre un export réel de plusieurs centaines de mégaoctets.

## 8. Critères de succès

1. `npm test` vert, avec les effets injectés par le générateur effectivement retrouvés par
   les modules d'analyse.
2. `npm run build` et `tsc -b` sans erreur.
3. **Porte finale visuelle** : l'application est lancée dans un navigateur, chaque fenêtre
   est ouverte et capturée. Un canvas qui peint un rectangle vide passe tous les tests
   unitaires du monde — la vérification finale est l'œil, pas le compteur de tests.
4. Au premier lancement, sans aucune donnée, l'application propose de générer un historique
   de démonstration et toutes les fenêtres sont alors peuplées et lisibles.

## 9. Ce que la v0.1 ne fait pas

Pas de synchronisation d'appareil, pas de compte, pas de prédiction ni de modèle
d'apprentissage, pas de recommandation, pas d'application mobile, pas de multi-utilisateur.
