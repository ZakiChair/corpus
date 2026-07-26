# Corpus — intégrité de la persistance

**Date** : 2026-07-26  
**Statut** : design approuvé, en attente du plan d’implémentation

## 1. Objectif

Empêcher qu’une erreur IndexedDB, une version de données incompatible ou deux
onglets actifs puissent provoquer une perte silencieuse. Toute situation dans
laquelle Corpus ne peut plus garantir une sauvegarde fidèle doit devenir un
état explicite et bloquant.

## 2. Périmètre

Ce lot couvre uniquement :

- la distinction entre stockage absent, lisible, corrompu et incompatible ;
- la validation stricte de la version du modèle `EtatCorpus` ;
- la compatibilité avec les états v1 déjà enregistrés ;
- la sérialisation des sauvegardes différées ;
- la détection des écritures concurrentes entre onglets ;
- le blocage des mutations avant hydratation et après une erreur de persistance ;
- une interface de récupération offrant nouvelle tentative, export de l’état
  en mémoire et rechargement ;
- les tests unitaires et d’intégration de ces comportements.

Les corrections statistiques, PWA, canvas, import et accessibilité restent hors
de ce lot.

## 3. Approche retenue

### 3.1 Révision optimiste

La valeur IndexedDB sous la clé `courant` devient une enveloppe :

```ts
interface DocumentStocke {
  format: 1
  revision: number
  etat: EtatCorpus
}
```

L’adaptateur charge l’enveloppe et retourne sa révision. Lors d’une sauvegarde,
il ouvre une transaction en lecture-écriture, relit la révision courante et ne
remplace le document que si elle correspond à la révision attendue. Une écriture
réussie incrémente la révision et la retourne au store.

Cette comparaison et l’écriture ont lieu dans la même transaction IndexedDB.
Deux onglets ayant chargé la révision 4 ne peuvent donc pas tous deux remplacer
le document : le premier écrit la révision 5, le second reçoit un conflit.

### 3.2 Compatibilité v1

Les installations existantes contiennent directement un `EtatCorpus`, sans
enveloppe. Un état v1 valide est chargé comme révision 0. Sa première sauvegarde
l’enveloppe sans modifier les données métier.

`schemaEtatCorpus` exige exactement `VERSION_ETAT`. Une version supérieure n’est
jamais analysée avec le schéma courant, afin d’éviter que Zod retire des champs
inconnus avant une réécriture. Aucune migration métier n’est nécessaire tant que
la seule version connue est la v1.

### 3.3 Résultat de chargement

Le contrat de lecture distingue quatre résultats :

```ts
type ResultatChargement =
  | { statut: 'absent'; revision: 0 }
  | { statut: 'charge'; etat: EtatCorpus; revision: number }
  | { statut: 'corrompu'; brut: unknown }
  | { statut: 'incompatible'; brut: unknown; version: number }
```

Une panne opérationnelle d’IndexedDB rejette la promesse. Elle ne devient jamais
`absent`. Un document corrompu ou incompatible est copié sous la clé `secours`
en meilleur effort, sans écraser un secours déjà présent.

## 4. Store et file d’écriture

Le store expose un état de persistance explicite :

```ts
type EtatPersistance =
  | { statut: 'chargement' }
  | { statut: 'pret'; sauvegarde: 'a-jour' | 'en-attente' }
  | { statut: 'erreur-lecture'; message: string }
  | { statut: 'document-corrompu' }
  | { statut: 'version-incompatible'; version: number }
  | { statut: 'erreur-ecriture'; message: string }
  | { statut: 'conflit' }
```

Toutes les actions mutantes vérifient que le statut est `pret`. Avant
l’hydratation, après une erreur d’écriture ou après un conflit, elles ne
modifient ni l’état en mémoire ni IndexedDB.

Une seule écriture peut être active. Si une mutation survient pendant cette
écriture, le store conserve uniquement le dernier état demandé et l’écrit après
le succès de la première avec la nouvelle révision. Cette coalescence conserve
le comportement différé actuel sans créer de conflit avec le même onglet.

Un rejet ou un conflit arrête la file et conserve l’état courant en mémoire pour
permettre son export. Aucune nouvelle écriture automatique ne part avant une
action explicite de récupération.

## 5. Interface de récupération

Tant que le chargement n’est pas terminé, les fenêtres et leurs commandes
mutantes ne sont pas rendues.

Une erreur de lecture, un document corrompu ou une version incompatible affiche
un écran bloquant qui explique qu’aucune donnée n’a été effacée. Il offre :

- **Réessayer** : relancer une lecture IndexedDB ;
- **Recharger l’application** : repartir d’un nouveau contexte navigateur.

Une erreur d’écriture ou un conflit affiche un écran bloquant au-dessus de
l’état encore visible. Il offre :

- **Télécharger l’état en mémoire** : exporter le JSON actuellement affiché ;
- **Recharger l’application** : abandonner l’instantané mémoire et relire la
  dernière version persistée.

Corpus ne fusionne jamais automatiquement deux instantanés concurrents.

## 6. Gestion des erreurs

- Les messages utilisateurs restent en français et n’exposent pas les détails
  techniques du navigateur.
- Le détail de l’erreur reste disponible dans le store pour le diagnostic.
- L’effacement volontaire annule la file d’écriture avant de supprimer l’état.
- Une suppression qui échoue devient une erreur d’écriture bloquante ; Corpus
  ne confirme pas que les données ont été effacées.
- Les écouteurs `pagehide` et `visibilitychange` déclenchent la vidange de la
  file, sans masquer un rejet éventuel pendant que la page reste active.

## 7. Tests

Les tests sont écrits avant chaque comportement de production et doivent
observer leur échec initial.

Couverture minimale :

1. un état v1 historique est chargé à la révision 0 ;
2. une version future est refusée sans suppression de champs ;
3. un document corrompu n’est pas assimilé à une base absente ;
4. une panne de lecture place le store en erreur et bloque une mutation ;
5. une mutation appelée avant hydratation est ignorée ;
6. plusieurs mutations rapides sont coalescées et enregistrées dans l’ordre ;
7. un échec d’écriture arrête les sauvegardes suivantes ;
8. deux stores partageant le même adaptateur provoquent un conflit de révision,
   sans écrasement du premier état ;
9. une réinitialisation n’annonce son succès qu’après suppression effective ;
10. l’écran de récupération expose les actions correspondant au type d’erreur.

La validation finale exécute les tests ciblés, la totalité de Vitest limitée à
`src`, le typecheck, le build et les E2E existants.

## 8. Critères de succès

- Une panne IndexedDB ne peut jamais ouvrir Corpus sur un état éditable vide.
- Une version future ne peut jamais être normalisée puis réécrite par la v1.
- Deux onglets ne peuvent jamais écraser silencieusement leurs modifications.
- Une erreur d’écriture est visible et l’état mémoire reste exportable.
- Les données v1 existantes restent lisibles sans action utilisateur.
- Aucun comportement d’analyse, d’import ou de présentation hors écran de
  récupération n’est modifié.
