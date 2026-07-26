import { expect, test, type Page } from '@playwright/test'

/**
 * Parcours réels dans le vrai navigateur — ce que les 257 tests unitaires ne
 * voient pas : rendu, gestes, navigation entre fenêtres.
 *
 * Chaque test repart d'un stockage vierge et repasse par le SEUL chemin
 * utilisateur (générer la démonstration) : pas d'état injecté en douce.
 */

async function demarrerAvecDemo(page: Page): Promise<void> {
  await page.goto('/')
  await page.evaluate(async () => {
    localStorage.clear()
    await new Promise((fin) => {
      const demande = indexedDB.deleteDatabase('corpus')
      demande.onsuccess = demande.onerror = demande.onblocked = fin
    })
  })
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
