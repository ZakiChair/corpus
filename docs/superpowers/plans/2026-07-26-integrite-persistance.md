# Corpus Persistence Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre toute erreur de lecture, d’écriture, de version ou de concurrence IndexedDB explicite et non destructive.

**Architecture:** La valeur `courant` devient une enveloppe versionnée contenant une révision optimiste et l’état métier. Un store injectable sérialise les sauvegardes, bloque les mutations hors état sûr et expose un automate de persistance à React. Une couche d’interface unique bloque l’application et propose les actions de récupération lorsqu’une garantie de sauvegarde est perdue.

**Tech Stack:** TypeScript 6 strict, Zustand vanilla, Zod 4, IndexedDB, React 19, Vitest 4, Playwright.

## Global Constraints

- Conserver la lecture des états `EtatCorpus` v1 déjà stockés sans enveloppe.
- Ne jamais convertir une panne IndexedDB en stockage absent.
- Ne jamais réécrire un document futur, corrompu ou concurrent.
- Ne pas ajouter de dépendance de production ou de test.
- Écrire les messages et les tests en français, conformément au dépôt.
- Ne modifier aucun calcul statistique, importeur, canvas ou comportement PWA dans ce lot.
- Pour chaque comportement : écrire le test, observer l’échec attendu, puis seulement modifier le code de production.

---

### Task 1: Validation stricte de la version métier

**Files:**
- Create: `src/core/types.test.ts`
- Modify: `src/core/types.ts:74`

**Interfaces:**
- Consumes: `VERSION_ETAT`, `etatVide`, `analyserEtat`.
- Produces: `schemaEtatCorpus` qui accepte uniquement `version: VERSION_ETAT`.

- [ ] **Step 1: Write the failing version tests**

```ts
import { describe, expect, it } from 'vitest'
import { analyserEtat, etatVide, VERSION_ETAT } from './types'
import type { Jour } from './temps'

const JOUR = '2026-07-26' as Jour

describe('version de l’état Corpus', () => {
  it('relit la version courante', () => {
    expect(analyserEtat(etatVide(JOUR))).not.toBeNull()
  })

  it('refuse une version future sans la normaliser', () => {
    const futur = {
      ...etatVide(JOUR),
      version: VERSION_ETAT + 1,
      champFutur: { aConserver: true },
    }
    expect(analyserEtat(futur)).toBeNull()
    expect(futur.champFutur).toEqual({ aConserver: true })
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run src/core/types.test.ts`
Expected: the future-version test fails because `analyserEtat` currently accepts every integer version.

- [ ] **Step 3: Require the current version in the schema**

Replace the version field with:

```ts
export const schemaEtatCorpus = z.object({
  version: z.literal(VERSION_ETAT),
  series: z.record(z.string(), schemaSerie),
  annotations: z.array(schemaAnnotation),
  profil: schemaProfil,
  creeLe: schemaJour,
})
```

- [ ] **Step 4: Run the test and verify GREEN**

Run: `npx vitest run src/core/types.test.ts`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/core/types.ts src/core/types.test.ts
git commit -m "fix: refuser les versions futures de l'état"
```

---

### Task 2: Enveloppe de stockage et révision optimiste

**Files:**
- Create: `src/core/stockage.test.ts`
- Modify: `src/core/stockage.ts:14-149`

**Interfaces:**
- Consumes: `analyserEtat`, `EtatCorpus`, `VERSION_ETAT`.
- Produces:
  - `ResultatChargement` ;
  - `ConflitStockage` ;
  - `decoderValeurStockee(brut: unknown): ResultatChargement` ;
  - `AdaptateurStockage.charger(): Promise<ResultatChargement>` ;
  - `AdaptateurStockage.enregistrer(etat, revisionAttendue): Promise<number>` ;
  - `AdaptateurStockage.effacer(revisionAttendue): Promise<number>`.

- [ ] **Step 1: Write failing decoder and conflict tests**

```ts
import { describe, expect, it } from 'vitest'
import {
  ConflitStockage,
  StockageMemoire,
  decoderValeurStockee,
} from './stockage'
import { etatVide, VERSION_ETAT } from './types'
import type { Jour } from './temps'

const JOUR = '2026-07-26' as Jour

describe('document stocké', () => {
  it('considère un état v1 historique comme la révision zéro', () => {
    expect(decoderValeurStockee(etatVide(JOUR))).toMatchObject({
      statut: 'charge',
      revision: 0,
    })
  })

  it('préserve une version future dans le résultat incompatible', () => {
    const brut = { ...etatVide(JOUR), version: VERSION_ETAT + 1, champFutur: 'intact' }
    expect(decoderValeurStockee(brut)).toEqual({
      statut: 'incompatible',
      version: VERSION_ETAT + 1,
      brut,
    })
  })

  it('distingue un document corrompu d’une base absente', () => {
    expect(decoderValeurStockee({ version: VERSION_ETAT })).toMatchObject({ statut: 'corrompu' })
    expect(decoderValeurStockee(undefined)).toEqual({ statut: 'absent', revision: 0 })
  })

  it('refuse une écriture fondée sur une révision périmée', async () => {
    const stockage = new StockageMemoire()
    expect(await stockage.enregistrer(etatVide(JOUR), 0)).toBe(1)
    await expect(stockage.enregistrer(etatVide(JOUR), 0)).rejects.toBeInstanceOf(
      ConflitStockage,
    )
    expect((await stockage.charger()).statut).toBe('charge')
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run src/core/stockage.test.ts`
Expected: compilation/test failure because the new storage contract does not exist.

- [ ] **Step 3: Add the exact document contract and pure decoder**

Add these public types and decoder near the top of `stockage.ts`:

```ts
export interface DocumentStocke {
  format: 1
  revision: number
  etat: EtatCorpus
}

export type ResultatChargement =
  | { statut: 'absent'; revision: 0 }
  | { statut: 'charge'; etat: EtatCorpus; revision: number }
  | { statut: 'corrompu'; brut: unknown }
  | { statut: 'incompatible'; brut: unknown; version: number }

export class ConflitStockage extends Error {
  constructor() {
    super('La révision stockée a changé.')
    this.name = 'ConflitStockage'
  }
}

function versionDeclaree(brut: unknown): number | undefined {
  if (typeof brut !== 'object' || brut === null) return undefined
  const candidat = 'etat' in brut ? brut.etat : brut
  if (typeof candidat !== 'object' || candidat === null || !('version' in candidat)) return undefined
  return typeof candidat.version === 'number' && Number.isInteger(candidat.version)
    ? candidat.version
    : undefined
}
```

`decoderValeurStockee` must apply this order exactly:

1. `undefined` → `{ statut: 'absent', revision: 0 }`;
2. envelope `{ format: 1, revision >= 0, etat courant valide }` → `charge`;
3. legacy current `EtatCorpus` → `charge` revision 0;
4. declared version different from `VERSION_ETAT` → `incompatible` with the untouched `brut`;
5. everything else → `corrompu` with the untouched `brut`.

- [ ] **Step 4: Make memory storage obey optimistic revisions**

Implement `StockageMemoire` around one `unknown` value. `enregistrer` and `effacer` call the decoder, accept only `absent` or `charge`, compare `revisionAttendue`, and throw `ConflitStockage` before changing the value when revisions differ. A successful save writes `{ format: 1, revision: revisionAttendue + 1, etat }`; a successful deletion clears the value and returns 0.

- [ ] **Step 5: Make IndexedDB compare-and-write atomic**

Replace `StockageIndexedDB.enregistrer` with one `readwrite` transaction on `etat`:

```ts
async enregistrer(etat: EtatCorpus, revisionAttendue: number): Promise<number> {
  const revisionSuivante = revisionAttendue + 1
  await modifierEtatAtomiquement((magasin, terminer, echouer) => {
    const lecture = magasin.get(CLE)
    lecture.onerror = () => echouer(lecture.error)
    lecture.onsuccess = () => {
      const courant = decoderValeurStockee(lecture.result)
      if (
        (courant.statut !== 'absent' && courant.statut !== 'charge') ||
        courant.revision !== revisionAttendue
      ) {
        echouer(new ConflitStockage())
        return
      }
      magasin.put({ format: 1, revision: revisionSuivante, etat } satisfies DocumentStocke, CLE)
      terminer(revisionSuivante)
    }
  })
  return revisionSuivante
}
```

`modifierEtatAtomiquement` must keep the read and write in the same transaction, resolve only on `tx.oncomplete`, abort and reject on the first supplied error, and close the database in every terminal path. Implement `effacer` with the same comparison followed by `magasin.delete(CLE)` and return 0.

`charger` must call `decoderValeurStockee` and must not catch an operational IndexedDB rejection. For `corrompu` and `incompatible`, preserve `brut` under `secours` in best effort without replacing an existing secours.

- [ ] **Step 6: Run storage and existing sync tests**

Run: `npx vitest run src/core/stockage.test.ts src/donnees/syncSante.test.ts`
Expected: all tests pass; the generic `lireCle/ecrireCle/supprimerCle` API used by sync remains unchanged.

- [ ] **Step 7: Commit**

```bash
git add src/core/stockage.ts src/core/stockage.test.ts
git commit -m "feat: versionner les écritures IndexedDB"
```

---

### Task 3: Automate d’hydratation et blocage des mutations

**Files:**
- Create: `src/core/donneesStore.test.ts`
- Modify: `src/core/donneesStore.ts:1-198`

**Interfaces:**
- Consumes: the new `AdaptateurStockage` and `ResultatChargement`.
- Produces:
  - exported `EtatPersistance` and `EtatStore` types ;
  - `creerStoreDonnees(adaptateur, options?)` ;
  - `EtatStore.persistance` ;
  - idempotent `hydrater()` ;
  - `purgerEcritureEnAttente(): Promise<void>` as a store action.

- [ ] **Step 1: Write failing hydration tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { creerStoreDonnees } from './donneesStore'
import type { AdaptateurStockage } from './stockage'

function adaptateurEnErreur(): AdaptateurStockage {
  return {
    charger: vi.fn().mockRejectedValue(new Error('indisponible')),
    enregistrer: vi.fn(),
    effacer: vi.fn(),
  }
}

describe('hydratation du store', () => {
  it('bloque une mutation avant la fin du chargement', () => {
    const stockage = adaptateurEnErreur()
    const store = creerStoreDonnees(stockage)
    const avant = store.getState().etat
    store.getState().genererDemonstration(30)
    expect(store.getState().etat).toBe(avant)
    expect(stockage.enregistrer).not.toHaveBeenCalled()
  })

  it('ne transforme pas une panne de lecture en état vide éditable', async () => {
    const store = creerStoreDonnees(adaptateurEnErreur())
    await store.getState().hydrater()
    expect(store.getState().persistance).toMatchObject({ statut: 'erreur-lecture' })
    expect(store.getState().hydrate).toBe(false)
  })

  it('partage une seule lecture entre deux hydratations simultanées', async () => {
    const charger = vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 })
    const stockage: AdaptateurStockage = {
      charger,
      enregistrer: vi.fn(),
      effacer: vi.fn(),
    }
    const store = creerStoreDonnees(stockage)
    await Promise.all([store.getState().hydrater(), store.getState().hydrater()])
    expect(charger).toHaveBeenCalledTimes(1)
    expect(store.getState().persistance).toEqual({ statut: 'pret', sauvegarde: 'a-jour' })
  })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run src/core/donneesStore.test.ts`
Expected: failure because `creerStoreDonnees` and `persistance` do not exist, and pre-hydration mutation currently changes the store.

- [ ] **Step 3: Introduce the persistence state machine**

Add the exact public union from the design:

```ts
export type EtatPersistance =
  | { statut: 'chargement' }
  | { statut: 'pret'; sauvegarde: 'a-jour' | 'en-attente' }
  | { statut: 'erreur-lecture'; message: string }
  | { statut: 'document-corrompu' }
  | { statut: 'version-incompatible'; version: number }
  | { statut: 'erreur-ecriture'; message: string }
  | { statut: 'conflit' }
```

Move timer, queued state, current revision, active write and active hydration into the closure of `creerStoreDonnees`. Keep `storeDonnees` as `creerStoreDonnees(stockage)` so all existing imports remain valid.

Map load results exactly:

- `absent` → fresh `etatVide`, revision 0, `pret/a-jour`;
- `charge` → loaded state and revision, `pret/a-jour`;
- `corrompu` → `document-corrompu`, no replacement of the in-memory state;
- `incompatible` → `version-incompatible`, no replacement;
- rejected promise → `erreur-lecture`, `hydrate: false`.

Cache the hydration promise until it settles so React StrictMode cannot issue two reads.

- [ ] **Step 4: Guard every mutating action**

At the entry of `muter`, `remplacer`, `genererDemonstration` and `reinitialiser`, require `persistance.statut === 'pret'`. An ignored action must preserve object identity and schedule no write. Keep the existing public action names so Saisie, Journal, imports and sync do not need changes.

- [ ] **Step 5: Run the store tests and verify GREEN**

Run: `npx vitest run src/core/donneesStore.test.ts`
Expected: all hydration and mutation-gating tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/core/donneesStore.ts src/core/donneesStore.test.ts
git commit -m "feat: bloquer les mutations hors stockage sûr"
```

---

### Task 4: File d’écriture, conflit et effacement fiable

**Files:**
- Modify: `src/core/donneesStore.test.ts`
- Modify: `src/core/donneesStore.ts`
- Modify: `src/fenetres/Donnees.tsx:334`

**Interfaces:**
- Consumes: `ConflitStockage`, revision returned by the adapter.
- Produces: serialized/coalesced writes and `reinitialiser(): Promise<boolean>`.

- [ ] **Step 1: Write failing queue and conflict tests**

Append tests which use `vi.useFakeTimers()` and `StockageMemoire`:

```ts
it('coalesce les mutations et conserve le dernier état', async () => {
  vi.useFakeTimers()
  const stockage = new StockageMemoire()
  const enregistrer = vi.spyOn(stockage, 'enregistrer')
  const store = creerStoreDonnees(stockage, { delaiEcritureMs: 20 })
  await store.getState().hydrater()
  store.getState().poserMesure('energie', JOUR, 5)
  store.getState().poserMesure('energie', JOUR, 7)
  await vi.advanceTimersByTimeAsync(20)
  await store.getState().purgerEcritureEnAttente()
  expect(enregistrer).toHaveBeenCalledTimes(1)
  expect((await stockage.charger())).toMatchObject({
    statut: 'charge',
    etat: { series: { energie: [{ j: JOUR, v: 7 }] } },
  })
  vi.useRealTimers()
})

it('signale le conflit de deux stores sans écraser le premier', async () => {
  const stockage = new StockageMemoire()
  const premier = creerStoreDonnees(stockage, { delaiEcritureMs: 0 })
  const second = creerStoreDonnees(stockage, { delaiEcritureMs: 0 })
  await Promise.all([premier.getState().hydrater(), second.getState().hydrater()])
  premier.getState().poserMesure('energie', JOUR, 5)
  await premier.getState().purgerEcritureEnAttente()
  second.getState().poserMesure('energie', JOUR, 9)
  await second.getState().purgerEcritureEnAttente()
  expect(second.getState().persistance).toEqual({ statut: 'conflit' })
  const resultat = await stockage.charger()
  expect(resultat.statut === 'charge' && resultat.etat.series.energie?.[0]?.v).toBe(5)
})
```

Append these two failure cases as well:

```ts
it('arrête la file après un échec d’écriture', async () => {
  const enregistrer = vi.fn().mockRejectedValue(new Error('quota'))
  const stockage: AdaptateurStockage = {
    charger: vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 }),
    enregistrer,
    effacer: vi.fn().mockResolvedValue(0),
  }
  const store = creerStoreDonnees(stockage, { delaiEcritureMs: 0 })
  await store.getState().hydrater()
  store.getState().poserMesure('energie', JOUR, 5)
  await store.getState().purgerEcritureEnAttente()
  const apresErreur = store.getState().etat
  expect(store.getState().persistance).toMatchObject({ statut: 'erreur-ecriture' })
  store.getState().poserMesure('energie', JOUR, 9)
  expect(store.getState().etat).toBe(apresErreur)
  expect(enregistrer).toHaveBeenCalledTimes(1)
})

it('ne confirme pas un effacement qui a échoué', async () => {
  const stockage: AdaptateurStockage = {
    charger: vi.fn().mockResolvedValue({ statut: 'absent', revision: 0 }),
    enregistrer: vi.fn().mockResolvedValue(1),
    effacer: vi.fn().mockRejectedValue(new Error('refus')),
  }
  const store = creerStoreDonnees(stockage)
  await store.getState().hydrater()
  const avant = store.getState().etat
  expect(await store.getState().reinitialiser()).toBe(false)
  expect(store.getState().etat).toBe(avant)
  expect(store.getState().persistance).toMatchObject({ statut: 'erreur-ecriture' })
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx vitest run src/core/donneesStore.test.ts`
Expected: queue/conflict/reset tests fail because writes are fire-and-forget and deletion reports no result.

- [ ] **Step 3: Implement one serialized write loop**

`planifierEnregistrement` stores only the latest state and marks `pret/en-attente`. `viderFile` must:

1. return the current active promise when a write is already running;
2. consume the latest queued state;
3. call `adaptateur.enregistrer(etat, revision)`;
4. replace `revision` with the returned value;
5. loop if a newer state arrived during the await;
6. set `pret/a-jour` when the queue is empty;
7. map `ConflitStockage` to `conflit` and every other rejection to `erreur-ecriture`;
8. discard the queued write after an error while retaining `get().etat` for export.

The action `purgerEcritureEnAttente` clears the debounce timer and awaits this loop. Global `pagehide` and `visibilitychange` listeners call the action on `storeDonnees`.

- [ ] **Step 4: Make deletion await the storage result**

Change the action signature to:

```ts
reinitialiser: () => Promise<boolean>
```

It must block new mutations, cancel a queued state, await any already-active save, call `adaptateur.effacer(revision)`, and only then replace the in-memory state with `etatVide`. On rejection, retain the previous state and enter `conflit` or `erreur-ecriture`.

Update the confirmation handler in `Donnees.tsx` to await the boolean and display « Toutes les données ont été effacées. » only when it is true.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `npx vitest run src/core/donneesStore.test.ts src/core/stockage.test.ts && npm run typecheck`
Expected: all focused tests pass and TypeScript reports no error.

- [ ] **Step 6: Commit**

```bash
git add src/core/donneesStore.ts src/core/donneesStore.test.ts src/fenetres/Donnees.tsx
git commit -m "fix: sérialiser les sauvegardes et détecter les conflits"
```

---

### Task 5: Écran de récupération et parcours navigateur

**Files:**
- Create: `src/shell/EcranPersistance.tsx`
- Modify: `src/core/hooks.ts:18`
- Modify: `src/App.tsx:43-116`
- Modify: `e2e/corpus.spec.ts`

**Interfaces:**
- Consumes: `EtatPersistance`, `storeDonnees.hydrater`, current in-memory `EtatCorpus`.
- Produces: `usePersistance()` and a blocking recovery UI.

- [ ] **Step 1: Write a failing E2E for a future document**

Add a helper that writes directly to the real browser database only for this persistence test, then add:

```ts
test('une version future bloque l’édition sans être écrasée', async ({ page }) => {
  await page.goto('/')
  await viderCorpus(page)
  const futur = {
    version: 2,
    series: {},
    annotations: [],
    profil: {},
    creeLe: '2026-07-26',
    champFutur: 'à conserver',
  }
  await ecrireEtatBrut(page, futur)
  await page.reload()
  await expect(page.getByRole('alertdialog')).toContainText('version plus récente')
  await expect(page.getByRole('button', { name: 'Réessayer' })).toBeVisible()
  expect(await lireEtatBrut(page)).toEqual(futur)
  await expect(page.getByRole('button', { name: 'Générer 18 mois' })).toHaveCount(0)
})
```

`viderCorpus`, `ecrireEtatBrut` and `lireEtatBrut` must each wait for the corresponding IndexedDB request/transaction completion. Reuse `viderCorpus` inside `demarrerAvecDemo` to remove duplicated deletion code.

- [ ] **Step 2: Run the single E2E and verify RED**

Run: `npx playwright test -g "version future bloque"`
Expected: failure because Corpus currently interprets the future document as an empty first launch and exposes the generation buttons.

- [ ] **Step 3: Add the recovery component and hook**

Add to `hooks.ts`:

```ts
export function usePersistance(): EtatPersistance {
  return useStore(storeDonnees, (s) => s.persistance)
}
```

`EcranPersistance` must render:

- `role="status"` with « Lecture des données… » for `chargement`;
- `role="alertdialog"`, `aria-modal="true"`, a French title and explanation for every error state;
- **Réessayer** for read/corrupt/incompatible states, calling `hydrater()`;
- **Télécharger l’état en mémoire** only for write/conflict states, serializing the current state exactly like the existing JSON export;
- **Recharger l’application** for all error states, calling `window.location.reload()`.

Do not render an action that can mutate data from this component.

- [ ] **Step 4: Gate App and initialize services only when safe**

In `App.tsx`, start `hydrater()` once on mount. Render only the persistence loading/error screen until the state becomes `pret`. For `erreur-ecriture` and `conflit`, keep the shell visible behind the blocking overlay so the in-memory state remains inspectable.

Move `demarrerSync()` and `demarrerSauvegardeAuto()` into an effect driven by `persistance.statut === 'pret'`, guarded by a `useRef` so they start once, including after a successful retry. Do not open DONN or start either service after a failed hydration.

- [ ] **Step 5: Run the E2E and verify GREEN**

Run: `npx playwright test -g "version future bloque"`
Expected: the recovery dialog appears, the raw future object remains byte-for-byte equivalent after JSON serialization, and no generation action is mounted.

- [ ] **Step 6: Write and verify a two-page conflict E2E**

Add:

```ts
test('deux onglets signalent un conflit au lieu de perdre des données', async ({ context, page }) => {
  await page.goto('/')
  await viderCorpus(page)
  await page.reload()
  const autre = await context.newPage()
  await autre.goto('/')

  await page.getByRole('button', { name: 'Générer 18 mois' }).click()
  await expect.poll(async () => (await lireEtatBrut(page)).revision).toBe(1)
  await autre.getByRole('button', { name: 'Générer 3 ans' }).click()
  await expect(autre.getByRole('alertdialog')).toContainText('autre onglet')

  const courant = await lireEtatBrut(page)
  expect(courant).toMatchObject({ format: 1, revision: 1 })
  expect(courant.etat.series.vfc).toHaveLength(540)
})
```

Run: `npx playwright test -g "deux onglets signalent"`
Expected RED before the revision-aware UI is complete if the test was added earlier; expected GREEN now, with the first tab’s 540-day state still persisted.

- [ ] **Step 7: Apply the React quality checklist**

Confirm that `EcranPersistance` is a top-level component, contains no component declared inside another component, uses primitive effect dependencies, does not duplicate global listeners, provides a labelled modal role, restores no unsafe background interaction, and performs JSON serialization only from a click handler.

- [ ] **Step 8: Commit**

```bash
git add src/App.tsx src/core/hooks.ts src/shell/EcranPersistance.tsx e2e/corpus.spec.ts
git commit -m "feat: afficher les erreurs de persistance"
```

---

### Task 6: Full regression verification

**Files:**
- Verify only; modify a file only when a failure is directly caused by Tasks 1–5.

**Interfaces:**
- Consumes: all persistence changes.
- Produces: fresh evidence for unit, type, build and browser behavior.

- [ ] **Step 1: Run all source tests**

Run: `npx vitest run src`
Expected: all source test files pass with zero failed test.

- [ ] **Step 2: Run typecheck and production build**

Run: `npm run typecheck && npm run build`
Expected: both commands exit 0.

- [ ] **Step 3: Run all browser tests**

Run: `npm run test:e2e`
Expected: the 9 existing tests plus the 2 persistence tests pass.

- [ ] **Step 4: Verify the worktree and scope**

Run: `git status --short --branch && git diff 1499eeb..HEAD --check && git diff --stat 1499eeb..HEAD`
Expected: no whitespace errors; changes are limited to the design/plan, core persistence/store, recovery UI, Donnees reset handler and tests.
