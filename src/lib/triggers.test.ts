// Tests unitaires des microagents — champ triggers: des fiches .CD.
// La logique de scan vit dans activeCardsSystem (App.svelte) ; ce test couvre
// le parsing frontmatter/triggers exact qu'elle exécute, sur les mêmes regex.
import { describe, expect, it } from 'vitest'

/** Copie exacte de la logique de scan de activeCardsSystem (extract de test). */
export function matchTriggers(raw: string, userText: string): boolean {
  const m = /^---\r?\n[\s\S]*?\r?\n---/.exec(raw)
  const tr = m?.[0].match(/^triggers:(.*)$/m)
  if (!tr) return false
  const words = tr[1].split(/[,;]/).map((w) => w.trim().toLowerCase()).filter((w) => w.length >= 3)
  return words.some((w) => userText.toLowerCase().includes(w))
}

const card = `---
name: demo-produit
description: Démo des fenêtres
kind: skill
tools: [read, list]
triggers: démo, démonstration, visite guidée
---
Contenu de la fiche.`

const noTriggers = `---
name: verification-lot
kind: skill
---
Rien ici.`

describe('microagents : triggers de fiches .CD', () => {
  it('détecte un mot-clé du champ triggers (insensible à la casse)', () => {
    expect(matchTriggers(card, 'fais-moi une DÉMO du produit')).toBe(true)
    expect(matchTriggers(card, 'lance la visite guidée')).toBe(true)
  })

  it('ne déclenche pas hors mots-clés ni sans champ triggers', () => {
    expect(matchTriggers(card, 'bonjour agent')).toBe(false)
    expect(matchTriggers(noTriggers, 'démo')).toBe(false)
  })

  it('ignore les déclencheurs trop courts (< 3) et les séparateurs ;', () => {
    const c = '---\nname: x\ntriggers: a, ab, demo; test\n---\nx'
    expect(matchTriggers(c, 'demo')).toBe(true)
    expect(matchTriggers(c, 'test')).toBe(true)
    expect(matchTriggers(c, 'ab')).toBe(false)
  })
})
