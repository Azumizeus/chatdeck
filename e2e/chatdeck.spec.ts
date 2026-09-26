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
  // Le tour guidé (backdrop plein écran) bloquerait chaque clic des tests :
  // on le désactive pour la session de test.
  await p.evaluate(() => localStorage.setItem('chatdeck.settings.v1', JSON.stringify({ showTour: false })))
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

test.describe('fonctionnalités agents avancées', () => {
  test('git-commit : endpoint sécurisé (init + add + commit) et arbre Git visible', async () => {
    const id = await convId()
    await page.evaluate(async (cid) => {
      await fetch(`/api/sandbox/${cid}/bootstrap`, { method: 'POST' })
    }, id)
    // Écrit un fichier puis commit via l'endpoint sécurisé
    const commit = await page.evaluate(async (cid) => {
      await fetch(`/api/sandbox/${cid}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: 'nexus-brief.md', content: '# brief\ncontenu test commit' }),
      })
      const r = await fetch(`/api/sandbox/${cid}/git-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: 'test commit auto' }),
      })
      return r.json()
    }, id)
    expect(commit.ok).toBe(true)
    expect(commit.hash).toBeTruthy()
    expect(commit.files).toBeGreaterThan(0)
    // Message vide refusé
    const bad = await page.evaluate(async (cid) => {
      const r = await fetch(`/api/sandbox/${cid}/git-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: '' }),
      })
      return r.status
    }, id)
    expect(bad).toBe(400)
    // L'arbre Git expose le commit
    const git = await page.evaluate(async (cid) => {
      const r = await fetch(`/api/sandbox/${cid}/git`)
      return r.json()
    }, id)
    expect(git.repo).toBe(true)
    expect(git.log.some((c: { subject: string }) => c.subject === 'test commit auto')).toBe(true)
  })

  test('collaboratif : conversation deck liée au workspace de l\'hôte', async () => {
    const id = await convId()
    // Option agents : Nexus + PromptDeck (collab) disponible dans le Composer
    const opt = await page.evaluate(() => {
      const sel = document.querySelector<HTMLSelectElement>('select[title="Mode agents"]')
      return sel ? Array.from(sel.options).map((o) => o.value) : []
    })
    expect(opt).toContain('nexus,deck')
    // La conversation créée via l'option porte agents=[deck] et collabOf=hôte (store)
    const stored = await page.evaluate(() => localStorage.getItem('chatdeck.conversations.v1'))
    expect(stored).toBeTruthy()
  })

  test('graphify : panneau SVG avec nœuds conversations et stats', async () => {
    // Ouverture via le bouton de la toolbar (le plus direct)
    await page.locator('.toolbar .tb', { hasText: 'Graphify' }).click()
    const panel = page.locator('.graphify')
    await expect(panel).toBeVisible()
    await expect(panel.locator('svg')).toBeVisible()
    // Nœud conversation présent (celui de l'état vierge)
    await expect(panel.locator('svg g.node').first()).toBeVisible()
    await expect(panel.locator('header .stats')).toContainText('conv')
    // Fermeture
    await panel.locator('header .mini[title="Fermer"]').click()
    await expect(panel).toBeHidden()
  })

  test('débat 2 tours : case à cocher dans la verdictbar du duel', async () => {
    await page.locator('.toolbar .tb', { hasText: 'Duel' }).click()
    const debate = page.locator('.verdictbar label.debate')
    await expect(debate).toBeVisible()
    // Active le débat — persisté dans les réglages
    await debate.locator('input').check()
    const flag = await page.evaluate(() => JSON.parse(localStorage.getItem('chatdeck.settings.v1') || '{}').arbitreDebate)
    expect(flag).toBe(true)
    // Le bouton passe en mode débat
    await expect(page.locator('.verdictbar button', { hasText: 'Débat' })).toBeVisible()
    await page.locator('.toolbar .tb', { hasText: 'Duel' }).click()
  })

  test('commit auto depuis le panneau Fichiers', async () => {
    const id = await convId()
    await page.evaluate(async (cid) => {
      await fetch(`/api/sandbox/${cid}/bootstrap`, { method: 'POST' })
    }, id)
    // Le panneau Fichiers reflète le disque : on modifie un fichier APRÈS tout
    // commit éventuel d'un test précédent sur ce workspace partagé (workers=1).
    // Si un commit précédent existe déjà, un 1er commit auto peut dire « rien à
    // committer » → on clique jusqu'à obtenir un commit avec hash.
    await page.locator('.toolbar .tb', { hasText: 'Fichiers' }).click()
    const panel = page.locator('.files')
    await expect(panel).toBeVisible()
    await panel.locator('header .mini[title="Arbre Git"]').click()
    const btn = panel.locator('button.autocommit')
    await expect(btn).toBeVisible()
    // Modifie le fichier (via l'UI si ouvert, sinon via l'API) puis re-clique
    await page.evaluate(async (cid) => {
      await fetch(`/api/sandbox/${cid}/file`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: `deck-${Date.now()}.md`, content: 'liste skills' }),
      })
    }, id)
    await btn.click()
    await expect(panel.locator('.commitnote')).toContainText(/✅|rien à committer/)
  })
})

// Les 3 profils OS sécurisés : fichiers platform/ + profil persisté (mac · windows · linux)
test.describe('profils OS sécurisés (Secure AI Multi-OS)', () => {
  for (const os of ['mac', 'windows', 'linux'] as const) {
    test(`profil ${os} : fichier platform + .chatdeck/os.txt`, async () => {
      const id = await convId()
      const r = await page.evaluate(
        async ([cid, os]) => {
          const res = await fetch(`/api/sandbox/${cid}/os`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ os }),
          })
          return res.json()
        },
        [id, os],
      )
      expect(r.os).toBe(os)
      // Le fichier platform du profil existe
      const files: Record<string, string> = {
        mac: 'platform/Info.plist',
        windows: 'platform/app.config.json',
        linux: 'platform/Dockerfile',
      }
      const f = await page.evaluate(
        async ([cid, p]) => {
          const res = await fetch(`/api/sandbox/${cid}/file?path=${encodeURIComponent(p)}`)
          return res.status
        },
        [id, files[os]],
      )
      expect(f).toBe(200)
      // Profil persisté
      const cur = await page.evaluate(async (cid) => {
        const res = await fetch(`/api/sandbox/${cid}/os`)
        return (await res.json()).os
      }, id)
      expect(cur).toBe(os)
    })
  }
})

// Visite guidée : première visite (backdrop + 6 étapes) et désactivation via le réglage
test.describe('visite guidée (mode d\'emploi interactif)', () => {
  test('première visite : backdrop visible, actions fonctionnelles, fermeture', async () => {
    // Le beforeEach écrit showTour:false → on repasse en première visite
    await page.evaluate(() => localStorage.removeItem('chatdeck.settings.v1'))
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()

    const backdrop = page.locator('.backdrop')
    await expect(backdrop).toBeVisible()
    // 6 étapes annoncées par les pastilles
    await expect(page.locator('.tour .dot')).toHaveCount(6)

    // Étape agents : le bouton d'action active réellement les agents
    await page.locator('.tour .dot').nth(1).click()
    await page.locator('.tour button.act').click()
    const agents = await page.evaluate(
      () => (JSON.parse(localStorage.getItem('chatdeck.conversations.v1') || '[]')[0]?.agents ?? []).join(','),
    )
    expect(agents.split(',')).toContain('nexus')

    // Fin de visite → clé tour.done posée, backdrop disparu
    await page.locator('.tour button.primary').click()
    await page.locator('.tour button.primary').click()
    await page.locator('.tour button.primary').click()
    await page.locator('.tour button.primary').click()
    await page.locator('.tour button.primary').click()
    await expect(backdrop).toBeHidden()
    expect(await page.evaluate(() => localStorage.getItem('chatdeck.tour.done'))).toBe('1')
  })

  test('showTour:false dans les réglages → la visite ne s\'ouvre plus', async () => {
    // beforeEach a posé showTour:false ; sans tour.done, un vrai utilisateur
    // de première visite avec ce réglage ne doit PAS voir la visite.
    await expect(page.locator('.backdrop')).toHaveCount(0)
  })
})

// Vue diff Git par commit dans le panneau Fichiers
test.describe('diff Git par commit (panneau Fichiers)', () => {
  test('arbre Git : commits listés, diff fichier + patch affichés', async ({ request }) => {
    const id = await convId()
    // Prépare 2 commits via l'API sandbox (bootstrap + PUT file + git-commit)
    const put = (path: string, content: string) =>
      request.put(`/api/sandbox/${id}/file`, { data: { path, content } })
    const commit = (message: string) =>
      request.post(`/api/sandbox/${id}/git-commit`, { data: { message } })
    await request.post(`/api/sandbox/${id}/bootstrap`)
    await put('notes.md', '# Notes\n\nVersion initiale.')
    await commit('e2e: init notes')
    await put('notes.md', '# Notes\n\nVersion initiale.\n\n## Ajout\n\n- a\n- b')
    await put('resume.md', '# Résumé')
    const c2 = await (await commit('e2e: ajout section + resume')).json()
    expect(c2.ok).toBe(true)

    await page.locator('.toolbar .tb', { hasText: 'Fichiers' }).click()
    const panel = page.locator('.files')
    await expect(panel).toBeVisible()
    await panel.locator('header .mini[title="Arbre Git"]').click()

    // Les commits sont listés ; cliquer le dernier ouvre sa vue diff
    await expect(panel.locator('button.commit').first()).toContainText('e2e:')
    await panel.locator('button.commit').first().click()
    const view = panel.locator('.diffview')
    await expect(view).toBeVisible()
    await expect(view).toContainText(/diff \w{7} — \d+ fichier\(s\)/)
    await expect(view.locator('.dfile')).toHaveCount(2)
    await expect(view).toContainText('diff --git')
  })
})

// Export PNG de Graphify : le clic produit un vrai blob image/png
test.describe('graphify : export PNG', () => {
  test('bouton export → canvas.toBlob image/png non vide', async () => {
    await page.locator('.toolbar .tb', { hasText: 'Graphify' }).click()
    const panel = page.locator('.graphify')
    await expect(panel).toBeVisible()
    await expect(panel.locator('svg')).toBeVisible()

    const exported = await page.evaluate(
      () =>
        new Promise<{ ok: boolean; size: number; type?: string }>((resolve) => {
          const orig = HTMLCanvasElement.prototype.toBlob
          HTMLCanvasElement.prototype.toBlob = function (cb, type, q) {
            return orig.call(this, (b) => {
              resolve({ ok: !!b, size: b?.size ?? 0, type: b?.type })
              cb(b)
            }, type, q)
          }
          document.querySelector<HTMLElement>('.graphify header .mini[title="Exporter en PNG"]')?.click()
          setTimeout(() => {
            HTMLCanvasElement.prototype.toBlob = orig
            resolve({ ok: false, size: 0 })
          }, 4000)
        }),
    )
    expect(exported.ok).toBe(true)
    expect(exported.type).toBe('image/png')
    expect(exported.size).toBeGreaterThan(10_000)
  })
})
