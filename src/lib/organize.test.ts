// Tests du rangement automatique (Graphify + Obsidian) — calcul pur, aucun DOM.
import { describe, expect, it } from 'vitest'
import { groupNotes, organizeGraph, ORGANIZE_LABELS, vaultSummary } from './organize'

type Kind = 'conversation' | 'workspace' | 'agent'

const node = (id: string, kind: Kind, agent?: string) => (agent ? { id, kind, agent } : { id, kind })

const W = 640
const H = 420

describe('organizeGraph', () => {
  it('mode type : trois bandes (conversations / workspaces / agents)', () => {
    const nodes = [node('c1', 'conversation'), node('c2', 'conversation'), node('w1', 'workspace'), node('a1', 'agent', 'nexus')]
    const pos = organizeGraph(nodes, 'type', W, H)
    expect(pos.get('c1')!.y).toBeCloseTo(H * 0.18, 5)
    expect(pos.get('c2')!.y).toBeCloseTo(H * 0.18, 5)
    expect(pos.get('w1')!.y).toBeCloseTo(H * 0.5, 5)
    expect(pos.get('a1')!.y).toBeCloseTo(H * 0.82, 5)
    // Deux conversations de la même bande : espacées d'au moins 90 px
    expect(Math.abs(pos.get('c1')!.x - pos.get('c2')!.x)).toBeGreaterThanOrEqual(90)
  })

  it('un nœud isolé est centré dans sa bande', () => {
    const pos = organizeGraph([node('c1', 'conversation')], 'type', W, H)
    expect(pos.get('c1')!.x).toBeCloseTo(W / 2, 5)
  })

  it('mode agent : une colonne par agent (nexus / seeker / deck)', () => {
    const nodes = [node('n', 'agent', 'nexus'), node('s', 'agent', 'seeker'), node('d', 'agent', 'deck')]
    const pos = organizeGraph(nodes, 'agent', W, H)
    expect(pos.get('n')!.x).toBeCloseTo(W * 0.25, 5)
    expect(pos.get('s')!.x).toBeCloseTo(W * 0.5, 5)
    expect(pos.get('d')!.x).toBeCloseTo(W * 0.75, 5)
  })

  it('mode recent : conversations à gauche, agents et workspaces à droite', () => {
    const nodes = [node('c1', 'conversation'), node('a1', 'agent', 'seeker'), node('w1', 'workspace')]
    const pos = organizeGraph(nodes, 'recent', W, H)
    expect(pos.get('c1')!.x).toBeLessThanOrEqual(W * 0.55)
    expect(pos.get('a1')!.x).toBeGreaterThanOrEqual(W * 0.68)
    expect(pos.get('w1')!.x).toBeGreaterThanOrEqual(W * 0.68)
  })

  it('anti-collision : jamais moins de 90 px entre nœuds d’une même bande', () => {
    const convs = Array.from({ length: 8 }, (_, i) => node(`c${i}`, 'conversation'))
    const pos = organizeGraph(convs, 'type', W, H)
    const xs = convs.map((n) => pos.get(n.id)!.x).sort((a, b) => a - b)
    for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(90 - 1e-9)
  })
})

describe('groupNotes', () => {
  const notes = [
    { path: 'b/2.md', size: 10 },
    { path: 'a/1.md', size: 20 },
    { path: 'racine.md', size: 5 },
  ]

  it('regroupe par dossier, dossiers et notes triés', () => {
    const groups = groupNotes(notes)
    expect(groups.map((g) => g.label)).toEqual(['📄 racine', '📁 a', '📁 b'])
    expect(groups[1].notes.map((n) => n.path)).toEqual(['a/1.md'])
  })

  it('filtre insensible à la casse sur le chemin', () => {
    const groups = groupNotes([...notes, { path: 'Obsidian/cartes.md', size: 1 }], 'OBS')
    expect(groups).toHaveLength(1)
    expect(groups[0].notes[0].path).toBe('Obsidian/cartes.md')
  })

  it('aucun résultat → aucun groupe', () => {
    expect(groupNotes(notes, 'inexistant')).toEqual([])
  })
})

describe('vaultSummary', () => {
  it('compte notes, dossiers de premier niveau et taille en ko', () => {
    const s = vaultSummary([
      { path: 'a/1.md', size: 1024 },
      { path: 'b/2.md', size: 2048 },
    ])
    expect(s).toBe('2 notes · 2 dossier(s) · 3 ko')
  })

  it('bascule en Mo au-delà d’un mégaoctet', () => {
    const s = vaultSummary([{ path: 'gros.bin', size: 1.5 * 1024 * 1024 }])
    expect(s).toBe('1 notes · 1 dossier(s) · 1.5 Mo')
  })

  it('affiche au minimum 1 ko', () => {
    const s = vaultSummary([{ path: 'x.md', size: 100 }])
    expect(s).toContain('1 ko')
  })

  it('libellés des modes de rangement', () => {
    expect(Object.keys(ORGANIZE_LABELS)).toEqual(['type', 'agent', 'recent'])
  })
})
