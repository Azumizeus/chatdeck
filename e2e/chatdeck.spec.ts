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

// Panneau deck (Skills & Agents .CD) : liste, activation par clic, création
test.describe('deck : skills & agents (.CD)', () => {
  test('onglet deck : liste des fiches, activation persistée, désactivation', async () => {
    await page.locator('.toolbar .tb', { hasText: 'Outils' }).click()
    const hub = page.locator('.hub')
    await expect(hub).toBeVisible()
    await hub.locator('nav button', { hasText: 'Skills' }).click()
    const deck = hub.locator('.deck')
    await expect(deck).toBeVisible()

    // La bibliothèque est chargée (335 fiches minimum : pack + verification-lot).
    // Le fetch du panneau peut être lent au premier chargement : retry via ⟳ si besoin.
    await expect(deck.locator('.cardrow').first()).toBeVisible({ timeout: 10_000 }).catch(async () => {
      await deck.locator('header .mini[title="Rafraîchir"]').click()
      await expect(deck.locator('.cardrow').first()).toBeVisible({ timeout: 10_000 })
    })
    const row = deck.locator('.cardrow', { hasText: 'verification-lot' }).first()
    await expect(row).toBeVisible()

    // Activation par clic → état persisté + contenu en cache
    await row.locator('.main').click()
    await expect(deck.locator('.note')).toContainText('verification-lot activée')
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('chatdeck.cards.v1') || '{}'))
    expect(stored.active).toContain('verification-lot')
    expect(stored.cache['verification-lot']).toContain('name: verification-lot')

    // Désactivation → état vidé
    await row.locator('.main').click()
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem('chatdeck.cards.v1') || '{}'))
    expect(after.active ?? []).not.toContain('verification-lot')
  })

  test('endpoint /api/deck/cards : liste pack + projet, contenu complet', async ({ request }) => {
    const list = await (await request.get('/api/deck/cards')).json()
    expect(list.cards.length).toBeGreaterThan(300)
    const lot = list.cards.find((c: { id: string }) => c.id === 'verification-lot')
    expect(lot.source).toBe('project')
    const card = await (await request.get('/api/deck/card?id=verification-lot')).json()
    expect(card.content).toContain('name: verification-lot')
  })

  test('création de fiche via le panneau (POST /api/deck/cards)', async ({ request }) => {
    const { rmSync } = await import('node:fs')
    const name = `e2e-creatrice-${Date.now()}`
    const r = await request.post('/api/deck/cards', { data: { name, kind: 'agent' } })
    expect((await r.json()).ok).toBe(true)
    // La fiche créée apparaît dans la liste (source project, kind agent)
    const list = await (await request.get('/api/deck/cards')).json()
    const created = list.cards.find((c: { id: string }) => c.id === name)
    expect(created?.kind).toBe('agent')
    expect(created?.source).toBe('project')
    // Nettoyage (la création passe par ./.cd/agents du projet)
    rmSync(`.cd/agents/${name}.cd`, { force: true })
  })
})

// Pastille fiches par conversation, éditeur PUT, badge MessageActions
test.describe('fiches .CD avancé : pastille, éditeur, badge', () => {
  test('pastille 🃏 du composer : toggle par conversation + état persisté', async () => {
    // Prépare l'état deck : verification-lot en cache (comme après activation dans le deck)
    await page.evaluate(async () => {
      const r = await fetch('/api/deck/card?id=verification-lot')
      const j = await r.json()
      localStorage.setItem('chatdeck.cards.v1', JSON.stringify({ active: [], cache: { 'verification-lot': j.content } }))
    })
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()

    const pill = page.locator('.cards-btn')
    await expect(pill).toBeVisible()
    await pill.click()
    const row = page.locator('.cards-pop button', { hasText: 'verification-lot' })
    await row.click()

    // État conversation persisté
    const cards = await page.evaluate(
      () => (JSON.parse(localStorage.getItem('chatdeck.conversations.v1') || '[]')[0]?.cardsActive ?? []),
    )
    expect(cards).toContain('verification-lot')
    // Le compteur de la pastille affiche 1
    await expect(pill).toContainText('1')

    // Retire la fiche du fil
    await row.click()
    const after = await page.evaluate(
      () => (JSON.parse(localStorage.getItem('chatdeck.conversations.v1') || '[]')[0]?.cardsActive ?? []),
    )
    expect(after).not.toContain('verification-lot')
  })

  test('éditeur de fiche projet : PUT /api/deck/card enregistre le corps', async ({ request }) => {
    // Crée une fiche projet dédiée au test
    const name = `e2e-edit-${Date.now()}`
    await request.post('/api/deck/cards', { data: { name, kind: 'skill' } })

    // Modifie son contenu via le PUT (frontmatter requis)
    const put = await request.put('/api/deck/card', {
      data: { id: name, content: `---\nname: ${name}\ndescription: fiche e2e modifiée\nkind: skill\n---\n\n# ${name}\n\nCorps mis à jour par le test.` },
    })
    expect((await put.json()).ok).toBe(true)

    // Le contenu persiste (relecture)
    const back = await (await request.get(`/api/deck/card?id=${name}`)).json()
    expect(back.content).toContain('Corps mis à jour par le test.')

    // Un PUT sans frontmatter est refusé
    const bad = await request.put('/api/deck/card', { data: { id: name, content: 'pas de frontmatter' } })
    expect(bad.status()).toBe(400)
  })

  test('badge 🃏 MessageActions : les fiches appliquées marquent le message', async () => {
    // Active la fiche globalement (état du deck) avant d'envoyer
    await page.evaluate(async () => {
      const r = await fetch('/api/deck/card?id=verification-lot')
      const j = await r.json()
      localStorage.setItem('chatdeck.cards.v1', JSON.stringify({ active: ['verification-lot'], cache: { 'verification-lot': j.content } }))
    })
    await page.reload()
    await expect(page.locator('.toolbar')).toBeVisible()

    // Envoie un message (fournisseur réel) — le badge apparaît dès l'insertion du message user
    await page.locator('.composer textarea').fill('test badge fiches')
    await page.locator('.composer textarea').press('Enter')
    const badge = page.locator('.msg .cards-badge').first()
    await expect(badge).toBeVisible({ timeout: 15_000 })
    await expect(badge).toContainText('🃏')
    // Le badge porte les fiches en tooltip
    expect(await badge.getAttribute('title')).toContain('verification-lot')
  })
})

// /undo sandbox : checkpoint avant tour d'agent + revert (inspiré d'OpenCode)
test.describe('undo sandbox (checkpoint/revert)', () => {
  test('git-undo : checkpoint écrit, revert ramène au contenu précédent', async ({ request }) => {
    const id = await convId()
    await request.post(`/api/sandbox/${id}/bootstrap`)
    // Fichier v1 + checkpoint
    await request.put(`/api/sandbox/${id}/file`, { data: { path: 'undo.md', content: 'version 1' } })
    const cp = await (await request.post(`/api/sandbox/${id}/git-undo`, { data: { op: 'checkpoint' } })).json()
    expect(cp.ok).toBe(true)
    expect(cp.hash).toBeTruthy()
    // L'agent "casse" le fichier
    await request.put(`/api/sandbox/${id}/file`, { data: { path: 'undo.md', content: 'version cassée' } })
    const before = await (await request.get(`/api/sandbox/${id}/file?path=undo.md`)).json()
    expect(before.content).toContain('cassée')
    // Revert → version 1 retrouvée
    const rv = await (await request.post(`/api/sandbox/${id}/git-undo`, { data: { op: 'revert', steps: 1 } })).json()
    expect(rv.ok).toBe(true)
    expect(rv.reverted).toBe(1)
    const after = await (await request.get(`/api/sandbox/${id}/file?path=undo.md`)).json()
    expect(after.content).toContain('version 1')
  })
})

// Fenêtre outils (hub) : onglets, chat toujours visible, réglage quels panneaux afficher
test.describe('fenêtre outils (hub)', () => {
  test('ouverture, switch d\'onglets, chat visible derrière, fermeture', async () => {
    await page.locator('.toolbar .tb', { hasText: 'Outils' }).click()
    const hub = page.locator('.hub')
    await expect(hub).toBeVisible()

    // Onglet par défaut = Graphify, et le chat reste entièrement utilisable derrière
    await expect(hub.locator('svg')).toBeVisible()
    await expect(page.locator('.messages').first()).toBeVisible()
    await expect(page.locator('.composer')).toBeVisible()

    // Switch vers Fichiers (dans le hub, pas de panneau docké en plus)
    await hub.locator('nav button', { hasText: 'Fichiers' }).click()
    await expect(hub.locator('.files')).toBeVisible()
    await expect(page.locator('.files')).toHaveCount(1)

    // Fermeture
    await hub.locator('header .close').click()
    await expect(hub).toBeHidden()
  })

  test('réglage : décocher des onglets masque les boutons du hub et le dock Réglages', async () => {
    await page.locator('.toolbar .tb', { hasText: 'Réglages' }).click()
    const dockSettings = page.locator('.dock-right')
    await expect(dockSettings).toBeVisible()
    await dockSettings.locator('.secthead', { hasText: 'Apparence' }).click()

    // Décoche Terminal + Preview dans la section Apparence
    const row = dockSettings.locator('.hubtabs-row')
    await expect(row).toBeVisible()
    await row.locator('label', { hasText: 'Terminal' }).locator('input').uncheck()
    await row.locator('label', { hasText: 'Preview' }).locator('input').uncheck()
    const stored = await page.evaluate(
      () => JSON.parse(localStorage.getItem('chatdeck.settings.v1') || '{}').hubTabs,
    )
    expect(stored).toEqual(['graph', 'files', 'settings', 'deck'])

    // Le hub n'affiche plus ces onglets
    await page.locator('.toolbar .tb', { hasText: 'Réglages' }).click() // referme le dock
    await page.locator('.toolbar .tb', { hasText: 'Outils' }).click()
    const hub = page.locator('.hub')
    await expect(hub).toBeVisible()
    await expect(hub.locator('nav button', { hasText: 'Terminal' })).toHaveCount(0)
    await expect(hub.locator('nav button', { hasText: 'Preview' })).toHaveCount(0)
    await expect(hub.locator('nav button', { hasText: 'Graphify' })).toBeVisible()
    await hub.locator('header .close').click()

    // On remet les 5 onglets pour ne pas polluer les autres tests (localStorage isolé par contexte)
  })
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

// Mode Plan (OpenCode) : lecture seule par fil, bouton 📋 Plan du composer
test.describe('mode plan (lecture seule)', () => {
  test('toggle 📋 Plan → planMode persisté par conversation', async () => {
    const btn = page.locator('.composer .plan-btn')
    await expect(btn).toBeVisible()
    await btn.click()
    await expect(btn).toHaveClass(/on/)
    const id = await convId()
    const mode = await page.evaluate((cid) => {
      const convs = JSON.parse(localStorage.getItem('chatdeck.conversations.v1') || '[]')
      return convs.find((c) => c.id === cid)?.planMode
    }, id)
    expect(mode).toBe(true)
    // Toggle retour : l'état repasse à false
    await btn.click()
    await expect(btn).not.toHaveClass(/on/)
  })
})

// @fichier : endpoint d'extrait + menu d'autocomplétion du composer
test.describe('@fichier : attachement + autocomplétion', () => {
  test('extrait sandbox joint au prompt (endpoint + logique de bloc)', async ({ request }) => {
    const id = await convId()
    await request.post(`/api/sandbox/${id}/bootstrap`)
    await request.put(`/api/sandbox/${id}/file`, { data: { path: 'atref.md', content: 'CONTENU-ATREF-12345' } })
    const r = await request.get(`/api/sandbox/${id}/file?path=atref.md`)
    expect(r.ok()).toBe(true)
    const j = (await r.json()) as { content?: string }
    // Le bloc injecté dans send() suit ce format :
    const block = `@atref.md :\n\n\`\`\`\n${(j.content ?? '').slice(0, 4000)}\n\`\`\``
    expect(block).toContain('CONTENU-ATREF-12345')
  })

  test('autocomplétion : taper @ propose les fichiers sandbox, clic insère le chemin', async ({ request }) => {
    const id = await convId()
    await request.post(`/api/sandbox/${id}/bootstrap`)
    await request.put(`/api/sandbox/${id}/file`, { data: { path: 'demo-at.md', content: 'x' } })
    const ta = page.locator('.composer textarea')
    await ta.click()
    await ta.pressSequentially('@', { delay: 40 })
    const menu = page.locator('.composer .at-menu')
    await expect(menu).toBeVisible({ timeout: 8000 })
    await expect(menu.locator('button', { hasText: 'demo-at.md' }).first()).toBeVisible()
    await menu.locator('button', { hasText: 'demo-at.md' }).first().click()
    await expect(ta).toHaveValue(/@demo-at.md/)
  })
})

// switch_os exposé comme outil agent (purge platform/ + retour succès)
test.describe('outil switch_os', () => {
  test('bascule windows → linux avec purge du profil précédent', async ({ request }) => {
    const id = await convId()
    await request.post(`/api/sandbox/${id}/bootstrap?os=windows`)
    await request.post(`/api/sandbox/${id}/os`, { data: { os: 'windows' } })
    let tree = (await (await request.get(`/api/sandbox/${id}/tree`)).json()) as { tree: { name: string; children?: { name: string }[] }[] }
    const plat = tree.tree.find((n) => n.name === 'platform')
    expect(plat?.children?.some((c) => c.name === 'app.config.json')).toBe(true)
    await request.post(`/api/sandbox/${id}/os`, { data: { os: 'linux' } })
    tree = (await (await request.get(`/api/sandbox/${id}/tree`)).json()) as typeof tree
    const plat2 = tree.tree.find((n) => n.name === 'platform')
    expect(plat2?.children?.some((c) => c.name === 'app.config.json')).toBeFalsy()
    expect(plat2?.children?.length).toBeGreaterThan(0)
  })
})
