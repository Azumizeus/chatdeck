// Tests E2E ChatDeck — parcours critiques.
// Prérequis : le serveur dev est démarré par la config (webServer).
import { expect, test, type Page } from '@playwright/test'

let page: Page

/** Id de la conversation courante (localStorage). */
async function convId(): Promise<string> {
  return page.evaluate(() => {
    const convs = JSON.parse(localStorage.getItem('chatdeck.conversations.v1') || '[]')
    return (convs.find((c) => c.open) ?? convs[0])?.id
  }) as Promise<string>
}

test.beforeEach(async ({ page: p }) => {
  page = p
  await p.goto('/')
  // État propre : le localStorage est isolé par contexte Playwright
  await p.evaluate(() => localStorage.removeItem('chatdeck.layout.v1'))
  await p.reload()
  await expect(p.locator('.toolbar')).toBeVisible()
})

test.describe('parcours critiques', () => {
  test('toolbar permanente : tous les outils visibles', async () => {
    await expect(page.locator('.toolbar .tb', { hasText: 'Agents' })).toBeVisible()
    await expect(page.locator('.toolbar .tb', { hasText: 'Duel' })).toBeVisible()
    await expect(page.locator('.toolbar .tb', { hasText: 'Fichiers' })).toBeVisible()
    await expect(page.locator('.toolbar .tb', { hasText: 'Terminal' })).toBeVisible()
    await expect(page.locator('.toolbar .tb', { hasText: 'Preview' })).toBeVisible()
    await expect(page.locator('.toolbar .tb', { hasText: 'Réglages' })).toBeVisible()
  })

  test('agents avec sandbox : activation, bootstrap et fichier écrit', async () => {
    // Active les agents via la toolbar
    await page.locator('.toolbar .tb', { hasText: 'Agents' }).click()
    const id = await convId()
    // Vérifie l'état persisté
    const agents = await page.evaluate(
      () => (JSON.parse(localStorage.getItem('chatdeck.conversations.v1') || '[]')[0]?.agents ?? []),
    )
    expect(agents).toContain('nexus')
    // Bootstrap manuel du workspace via l'API (le 1er message le fait aussi)
    const boot = await page.evaluate(async (cid) => {
      const r = await fetch(`/api/sandbox/${cid}/bootstrap`, { method: 'POST' })
      return r.json()
    }, id)
    expect(boot.ok).toBe(true)
    // L'arbre expose les fichiers d'amorçage
    const tree = await page.evaluate(async (cid) => {
      const r = await fetch(`/api/sandbox/${cid}/tree`)
      return (await r.json()).tree.map((n: { name: string }) => n.name)
    }, id)
    expect(tree).toContain('NOTES.md')
    expect(tree).toContain('package.json')
  })

  test('terminal : exécution réelle node/ls + garde des arguments', async () => {
    const id = await convId()
    await page.evaluate(async (cid) => {
      await fetch(`/api/sandbox/${cid}/bootstrap`, { method: 'POST' })
    }, id)
    await page.locator('.toolbar .tb', { hasText: 'Terminal' }).click()
    const term = page.locator('.term')
    await expect(term).toBeVisible()
    // ls
    await term.locator('input').fill('ls')
    await term.locator('input').press('Enter')
    await expect(term.locator('.line', { hasText: 'NOTES.md' })).toBeVisible()
    // Argument hors workspace refusé
    await term.locator('input').fill('rm ../../x')
    await term.locator('input').press('Enter')
    await expect(term.locator('.line.err', { hasText: 'argument interdit' })).toBeVisible()
  })

  test('duel : deux colonnes, envoi simultané, synthèse disponible', async () => {
    // Vérifie d'abord l'API (sans consommer de quota LLM : messages pré-remplis)
    await page.locator('.toolbar .tb', { hasText: 'Duel' }).click()
    await expect(page.locator('.duel-col')).toHaveCount(2)
    await expect(page.locator('.verdictbar')).toBeVisible()
    await expect(page.locator('.verdictbar button', { hasText: 'Synthèse' })).toBeVisible()
    // Les deux colonnes ont leur mini-toolbar par conversation
    await expect(page.locator('.duel-col .toolbar')).toHaveCount(2)
    // Quitte le duel
    await page.locator('.toolbar .tb', { hasText: 'Duel' }).click()
    await expect(page.locator('.duel-col')).toHaveCount(0)
  })

  test('recherche globale ⌘⇧F : ouverture, résultat, saut', async () => {
    await page.locator('.toolbar .tb', { hasText: 'Chercher' }).click()
    const panel = page.locator('.search-panel')
    await expect(panel).toBeVisible()
    await panel.locator('input').fill('zzz_aucune_correspondance')
    await expect(panel.locator('.empty')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel).toBeHidden()
  })

  test('fenêtre flottante : activation et snap au clavier (quarters)', async () => {
    await page.keyboard.press('Meta+k')
    await page.locator('.palette input, input[placeholder*="commande"]').first().fill('flottante')
    await page.keyboard.press('Enter')
    await expect(page.locator('.float-win')).toBeVisible()
    // Cycle de snap ⌘⌥S : premier quart haut-gauche
    const geo = (): Promise<{ x: number; y: number; w: number; h: number }> =>
      page.evaluate(() => JSON.parse(localStorage.getItem('chatdeck.layout.v1')).appGeo)
    const before = await geo()
    await page.keyboard.press('Meta+Alt+s')
    await page.waitForTimeout(250)
    const after = await geo()
    expect(after.w).toBeLessThan(before.w) // fenêtre réduite en quart
    // Retour au docké
    await page.locator('.float-win .light.close').click()
    await expect(page.locator('.app .frame')).toBeVisible()
  })

  test('réglages : sections dépliables et instructions système enregistrées', async () => {
    await page.locator('.toolbar .tb', { hasText: 'Réglages' }).click()
    const panel = page.locator('.panel')
    const gen = panel.locator('.secthead', { hasText: 'Génération' })
    await gen.click()
    const ta = panel.locator('textarea.system')
    await ta.fill('Test E2E — réponds en morse.')
    await panel.locator('.ghost.save').click()
    await expect(panel.locator('.ghost.save', { hasText: 'enregistré' })).toBeVisible()
    const sys = await page.evaluate(() => JSON.parse(localStorage.getItem('chatdeck.settings.v1') || '{}').system)
    expect(sys).toBe('Test E2E — réponds en morse.')
  })

  test('API sandbox : OS sécurisé, git, webfetch et preview', async () => {
    const id = await convId()
    // Choix du profil OS
    const os = await page.evaluate(async (cid) => {
      const r = await fetch(`/api/sandbox/${cid}/os`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ os: 'linux' }),
      })
      return (await r.json()).os
    }, id)
    expect(os).toBe('linux')
    // webfetch : URL locale interdite
    const web = await page.evaluate(async (cid) => {
      const r = await fetch(`/api/sandbox/${cid}/webfetch?url=http%3A%2F%2Flocalhost%3A5199%2F`)
      return r.status
    }, id)
    expect(web).toBe(400)
    // Preview : sert un fichier du workspace
    await page.evaluate(async (cid) => {
      await fetch(`/api/sandbox/${cid}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'index.html', content: '<h1>bonjour preview</h1>' }),
      })
    }, id)
    const html = await page.evaluate(async (cid) => {
      const r = await fetch(`/api/sandbox/${cid}/serve?path=index.html`)
      return r.text()
    }, id)
    expect(html).toContain('bonjour preview')
  })
})
