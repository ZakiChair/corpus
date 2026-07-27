import { expect, test, type Page } from '@playwright/test'

/**
 * Parcours réels dans le vrai navigateur — ce que les 257 tests unitaires ne
 * voient pas : rendu, gestes, navigation entre fenêtres.
 *
 * Chaque test repart d'un stockage vierge et repasse par le SEUL chemin
 * utilisateur (générer la démonstration) : pas d'état injecté en douce.
 */

interface EtatBrut {
  format?: number
  revision?: number
  etat?: { series: Record<string, unknown[]> }
  [cle: string]: unknown
}

async function viderCorpus(page: Page): Promise<void> {
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise<void>((resoudre, rejeter) => {
      const demande = indexedDB.deleteDatabase('corpus')
      demande.onsuccess = () => resoudre()
      demande.onerror = () => rejeter(demande.error)
    })
  })
}

async function ecrireCleEtatBrute(page: Page, cle: string, valeur: unknown): Promise<void> {
  await page.evaluate(async ({ cle, brut }) => {
    const db = await new Promise<IDBDatabase>((resoudre, rejeter) => {
      const demande = indexedDB.open('corpus', 2)
      demande.onupgradeneeded = () => {
        if (!demande.result.objectStoreNames.contains('etat')) {
          demande.result.createObjectStore('etat')
        }
        if (!demande.result.objectStoreNames.contains('sync')) {
          demande.result.createObjectStore('sync')
        }
      }
      demande.onsuccess = () => resoudre(demande.result)
      demande.onerror = () => rejeter(demande.error)
    })
    try {
      await new Promise<void>((resoudre, rejeter) => {
        const transaction = db.transaction('etat', 'readwrite')
        transaction.objectStore('etat').put(brut, cle)
        transaction.oncomplete = () => resoudre()
        transaction.onerror = () => rejeter(transaction.error)
        transaction.onabort = () => rejeter(transaction.error)
      })
    } finally {
      db.close()
    }
  }, { cle, brut: valeur })
}

async function ecrireEtatBrut(page: Page, valeur: unknown): Promise<void> {
  await ecrireCleEtatBrute(page, 'courant', valeur)
}

async function lireCleEtatBrute(
  page: Page,
  cle: string,
): Promise<{ presente: boolean; typeValeur: string }> {
  return page.evaluate(async (cleLue) => {
    const db = await new Promise<IDBDatabase>((resoudre, rejeter) => {
      const demande = indexedDB.open('corpus', 2)
      demande.onsuccess = () => resoudre(demande.result)
      demande.onerror = () => rejeter(demande.error)
    })
    try {
      return await new Promise<{ presente: boolean; typeValeur: string }>(
        (resoudre, rejeter) => {
          const transaction = db.transaction('etat', 'readonly')
          const magasin = transaction.objectStore('etat')
          const lecture = magasin.get(cleLue)
          const presence = magasin.count(cleLue)
          transaction.oncomplete = () =>
            resoudre({ presente: presence.result > 0, typeValeur: typeof lecture.result })
          transaction.onerror = () => rejeter(transaction.error)
          transaction.onabort = () => rejeter(transaction.error)
        },
      )
    } finally {
      db.close()
    }
  }, cle)
}

async function lireEtatBrut(page: Page): Promise<EtatBrut | undefined> {
  return page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resoudre, rejeter) => {
      const demande = indexedDB.open('corpus', 2)
      demande.onsuccess = () => resoudre(demande.result)
      demande.onerror = () => rejeter(demande.error)
    })
    try {
      return await new Promise<EtatBrut | undefined>((resoudre, rejeter) => {
        const transaction = db.transaction('etat', 'readonly')
        const demande = transaction.objectStore('etat').get('courant')
        let resultat: EtatBrut | undefined
        demande.onsuccess = () => {
          resultat = demande.result as EtatBrut
        }
        demande.onerror = () => rejeter(demande.error)
        transaction.oncomplete = () => resoudre(resultat)
        transaction.onerror = () => rejeter(transaction.error)
        transaction.onabort = () => rejeter(transaction.error)
      })
    } finally {
      db.close()
    }
  })
}

async function demarrerAvecDemo(page: Page): Promise<void> {
  await page.goto('/')
  await viderCorpus(page)
  await page.reload()
  // Premier lancement : DONN s'ouvre seule, c'est la porte d'entrée.
  const generer = page.getByRole('button', { name: 'Générer 18 mois' })
  await expect(generer).toBeVisible()
  await generer.click()
  await expect(page.locator('[aria-label="Bilan du jour"]')).toContainText('métriques suivies')
}

function fenetre(page: Page, titre: string) {
  return page.locator(`[role="dialog"][aria-label="${titre}"]`)
}

async function ouvrir(page: Page, mnemonique: string): Promise<void> {
  await page.keyboard.press('Meta+k')
  await page.getByPlaceholder('Fenêtre, mnémonique…').fill(mnemonique)
  await page.keyboard.press('Enter')
}

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

test('le dialogue de récupération reçoit le focus', async ({ page }) => {
  await page.goto('/')
  await viderCorpus(page)
  await ecrireEtatBrut(page, {
    version: 2,
    series: {},
    annotations: [],
    profil: {},
    creeLe: '2026-07-26',
  })
  await page.reload()

  const dialogue = page.getByRole('alertdialog')
  await expect(dialogue).toBeVisible()
  await expect
    .poll(() => dialogue.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true)
})

test('deux onglets signalent un conflit au lieu de perdre des données', async ({ context, page }) => {
  await page.goto('/')
  await viderCorpus(page)
  await page.reload()
  const autre = await context.newPage()
  await autre.goto('/')

  await page.getByRole('button', { name: 'Générer 18 mois' }).click()
  await expect.poll(async () => (await lireEtatBrut(page))?.revision).toBe(1)
  const documentAvantConflit = await lireEtatBrut(page)
  expect(documentAvantConflit).toMatchObject({ format: 1, revision: 1 })

  await autre.getByRole('button', { name: 'Générer 3 ans' }).click()
  await expect(autre.getByRole('alertdialog')).toContainText('autre onglet')
  await autre.keyboard.press('Meta+k')
  await expect(autre.getByPlaceholder('Fenêtre, mnémonique…')).toHaveCount(0)

  const documentApresConflit = await lireEtatBrut(page)
  expect(documentApresConflit).toEqual(documentAvantConflit)
})

test('une valeur undefined présente sous courant reste un document corrompu', async ({ page }) => {
  await page.goto('/')
  await viderCorpus(page)
  await ecrireEtatBrut(page, undefined)
  await page.reload()

  await expect(page.getByRole('alertdialog')).toContainText('illisible')
  expect(await lireCleEtatBrute(page, 'courant')).toEqual({
    presente: true,
    typeValeur: 'undefined',
  })
})

test('le CAS IndexedDB ne remplace pas une valeur undefined présente', async ({ page }) => {
  await page.goto('/')
  await viderCorpus(page)
  await page.reload()
  const generer = page.getByRole('button', { name: 'Générer 18 mois' })
  await expect(generer).toBeVisible()

  await ecrireEtatBrut(page, undefined)
  await generer.click()

  await expect(page.getByRole('alertdialog')).toContainText('autre onglet')
  expect(await lireCleEtatBrute(page, 'courant')).toEqual({
    presente: true,
    typeValeur: 'undefined',
  })
})

test('un secours présent valant undefined n’est pas écrasé', async ({ page }) => {
  await page.goto('/')
  await viderCorpus(page)
  await ecrireCleEtatBrute(page, 'secours', undefined)
  await ecrireEtatBrut(page, { version: 1 })
  await page.reload()

  await expect(page.getByRole('alertdialog')).toContainText('illisible')
  expect(await lireCleEtatBrute(page, 'secours')).toEqual({
    presente: true,
    typeValeur: 'undefined',
  })
})

test('confirme un effacement seulement après sa réussite', async ({ page }) => {
  await demarrerAvecDemo(page)
  const donnees = fenetre(page, 'Données')

  await donnees.getByRole('button', { name: 'Tout effacer' }).click()
  await donnees.getByRole('button', { name: 'Confirmer l’effacement' }).click()

  await expect(donnees).toContainText('Toutes les données ont été effacées.')
})

test('premier lancement, démonstration, et toutes les fenêtres à leur taille par défaut', async ({ page }) => {
  await demarrerAvecDemo(page)
  // Chaque fenêtre du registre s'ouvre et affiche du contenu — à sa taille
  // PAR DÉFAUT, celle où les défauts de mise en page se cachent.
  const attendus: [string, string, string | RegExp][] = [
    ['SIGN', 'Signaux', /signal|Rien d’inhabituel/],
    ['SERI', 'Séries', 'unités brutes'],
    ['LOAD', 'Charge', 'Chronique 42 j'],
    ['COMP', 'Comparaison', /net|bruit/],
    ['CORR', 'Corrélations', 'décalage qui les maximise'],
    ['EVTS', 'Événements', 'occurrences'],
    ['HYPO', 'Hypothèses', 'Écart des médianes'],
    ['SAIS', 'Saisie', 'aujourd’hui'],
    ['ANNO', 'Journal', 'Intensité'],
  ]
  for (const [mnemo, titre, contenu] of attendus) {
    await ouvrir(page, mnemo)
    await expect(fenetre(page, titre), `fenêtre ${mnemo}`).toContainText(contenu)
  }
})

test('le bilan juge un jour face aux mêmes jours de semaine', async ({ page }) => {
  await demarrerAvecDemo(page)
  await expect(fenetre(page, 'Bilan du jour')).toContainText(/normale des \w+s/)
})

test('la saisie refuse une valeur hors bornes', async ({ page }) => {
  await demarrerAvecDemo(page)
  await ouvrir(page, 'SAIS')
  const sais = fenetre(page, 'Saisie')
  await sais.locator('label', { hasText: 'Poids' }).locator('input').fill('745')
  await expect(sais).toContainText('hors bornes')
  await expect(sais.getByRole('button', { name: /Enregistrer/ })).toBeDisabled()
})

test('l’étude d’événement signale les lignes de base contaminées', async ({ page }) => {
  await demarrerAvecDemo(page)
  await ouvrir(page, 'EVTS')
  // Les séances (3-4 par semaine dans la démonstration) contaminent leurs
  // propres lignes de base : la fenêtre doit le DIRE, pas le cacher.
  await expect(fenetre(page, 'Événements')).toContainText('contaminée')
})

test('glisser une fenêtre au bord gauche l’ancre en moitié d’écran, la ré-attraper la décroche', async ({ page }) => {
  await demarrerAvecDemo(page)
  const seri = fenetre(page, 'Séries')
  const barre = seri.locator('span', { hasText: 'SERI' }).first()
  const origine = await barre.boundingBox()
  await page.mouse.move(origine!.x + 5, origine!.y + 5)
  await page.mouse.down()
  await page.mouse.move(600, 400, { steps: 5 })
  await page.mouse.move(5, 500, { steps: 5 })
  await page.mouse.up()
  const boite = await seri.boundingBox()
  expect(boite!.x).toBe(0)
  expect(Math.round(boite!.width)).toBe(800)

  // La ré-attraper rend sa taille d'avant.
  await page.mouse.move(200, boite!.y + 8)
  await page.mouse.down()
  await page.mouse.move(500, 300, { steps: 5 })
  await page.mouse.up()
  const rendue = await seri.boundingBox()
  expect(Math.round(rendue!.width)).toBe(860)
})

test('⌥→ ancre au clavier et ⌥↓ restaure', async ({ page }) => {
  await demarrerAvecDemo(page)
  await page.keyboard.press('Alt+ArrowRight')
  const geometrie = () =>
    page.evaluate(() => {
      const liste = JSON.parse(localStorage.getItem('corpus:fenetres')!)
      return liste.reduce((m: { z: number }, f: { z: number }) => (f.z > m.z ? f : m))
    })
  const ancree = await geometrie()
  expect(ancree.x).toBe(800)
  await page.keyboard.press('Alt+ArrowDown')
  const restauree = await geometrie()
  expect(restauree.largeur).not.toBe(ancree.largeur)
})

test('une tuile du bilan ouvre la série correspondante', async ({ page }) => {
  await demarrerAvecDemo(page)
  await page.getByRole('button', { name: 'Mosaïque' }).click()
  const blan = fenetre(page, 'Bilan du jour')
  await blan.locator('span', { hasText: 'BLAN' }).first().click()
  await blan.locator('[role="button"]', { hasText: 'FC repos' }).first().click()
  const seri = fenetre(page, 'Séries')
  // Le bouton de métrique actif porte la couleur de série en style inline.
  const actifs = seri.locator('button[style*="c-serie"]')
  await expect(actifs).toHaveCount(1)
  await expect(actifs.first()).toHaveText('FC repos')
})

test('le jour survolé dans LOAD se trace dans SERI', async ({ page }) => {
  await demarrerAvecDemo(page)
  await ouvrir(page, 'LOAD')
  await page.getByRole('button', { name: 'Mosaïque' }).click()
  const canvas = fenetre(page, 'Charge').locator('canvas')
  const boite = await canvas.boundingBox()
  await page.mouse.move(boite!.x + boite!.width * 0.6, boite!.y + boite!.height * 0.4)
  await expect(fenetre(page, 'Séries').locator('div[class*="bg-attenue/40"]')).toBeVisible()
})

test('les données saisies survivent au rechargement', async ({ page }) => {
  await demarrerAvecDemo(page)
  await ouvrir(page, 'SAIS')
  const sais = fenetre(page, 'Saisie')
  await sais.locator('label', { hasText: 'Énergie' }).locator('input').fill('7')
  await sais.getByRole('button', { name: /Enregistrer/ }).click()
  await expect(sais).toContainText('Enregistré.')
  // L'écriture est différée de 400 ms : le rechargement immédiat est
  // précisément le scénario que la purge sur pagehide doit couvrir.
  await page.reload()
  // La disposition persiste : SAIS est déjà ouverte au retour.
  await expect(
    fenetre(page, 'Saisie').locator('label', { hasText: 'Énergie' }).locator('input'),
  ).toHaveAttribute('placeholder', '7')
})

test('les gestes du canvas s’activent quand les données arrivent après l’ouverture', async ({ page }) => {
  await page.goto('/')
  await viderCorpus(page)
  await page.reload()
  await expect(page.getByRole('button', { name: 'Générer 18 mois' })).toBeVisible()
  // SERI est montée VIDE : son canvas n'existe pas encore. C'est le parcours
  // du premier lancement — la fenêtre invite à générer depuis DONN, puis les
  // données arrivent SANS que la fenêtre soit démontée.
  await ouvrir(page, 'SERI')
  await expect(fenetre(page, 'Séries')).toContainText('Aucune série à tracer')
  // SERI recouvre DONN : on l'ancre à droite pour dégager le bouton.
  await page.keyboard.press('Alt+ArrowRight')
  await fenetre(page, 'Données').getByRole('button', { name: 'Générer 18 mois' }).click()
  const seri = fenetre(page, 'Séries')
  const canvas = seri.locator('canvas')
  await expect(canvas).toBeVisible()
  // Le survol doit répondre : réticule + infobulle datée du jour pointé.
  const boite = await canvas.boundingBox()
  await page.mouse.move(boite!.x + boite!.width * 0.6, boite!.y + boite!.height * 0.4)
  await page.mouse.move(boite!.x + boite!.width * 0.62, boite!.y + boite!.height * 0.4)
  await expect(seri.locator('div.backdrop-blur-sm')).toBeVisible()
})

test('une fenêtre qui ne charge pas n’emporte pas le reste du terminal', async ({ page }) => {
  await demarrerAvecDemo(page)
  // Panne de chargement d'un module de fenêtre : coupure réseau, ou
  // déploiement qui a renommé les fichiers pendant qu'un onglet restait ouvert.
  await page.route('**/fenetres/Correlations*', (route) => route.abort())
  await ouvrir(page, 'CORR')
  await expect(fenetre(page, 'Corrélations')).toContainText('n’a pas pu charger')
  // Les fenêtres déjà chargées restent vivantes.
  await expect(page.locator('[aria-label="Bilan du jour"]')).toContainText('métriques suivies')
})
