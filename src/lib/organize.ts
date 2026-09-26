// Rangement automatique — empêche le « bordel » dans Graphify et Obsidian.
//
// Principe : on ne déplace JAMAIS de fichiers réels (coffrets Obsidian = données
// utilisateur). On organise l'AFFICHAGE :
//  - Graphify : modes de layout (par type / par agent / temporel) + espacement anti-collision
//  - Obsidian : regroupement par dossier trié + labels lisibles, jamais de move

export type OrganizeMode = 'type' | 'agent' | 'recent'

export const ORGANIZE_LABELS: Record<OrganizeMode, string> = {
  type: 'Par type',
  agent: 'Par agent',
  recent: 'Par fraîcheur',
}

/* ======================= Graphify ======================= */

interface GNode {
  id: string
  kind: 'conversation' | 'workspace' | 'agent'
  agent?: string
}

/**
 * Layout « rangé » pour le graphe : positionne par bandes selon le mode.
 *  - type   : conversations en 2 colonnes en haut, workspaces au milieu, agents en bas
 *  - agent  : une colonne par agent (nexus / seeker / deck), conversations en haut
 *  - recent : conversations triées par activité, agents sur le côté droit
 * Anti-collision : espacement minimal garanti entre nœuds d'une même bande.
 */
export function organizeGraph(
  nodes: GNode[],
  mode: OrganizeMode,
  width: number,
  height: number,
): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const convs = nodes.filter((n) => n.kind === 'conversation')
  const wss = nodes.filter((n) => n.kind === 'workspace')
  const agents = nodes.filter((n) => n.kind === 'agent')

  const spread = (items: GNode[], y: number, xmin: number, xmax: number): void => {
    if (!items.length) return
    const step = Math.max(90, (xmax - xmin) / Math.max(1, items.length - 1 || 1))
    const total = step * (items.length - 1)
    const startX = xmin + (xmax - xmin - total) / 2
    items.forEach((n, i) => pos.set(n.id, { x: items.length === 1 ? (xmin + xmax) / 2 : startX + i * step, y }))
  }

  if (mode === 'type') {
    spread(convs, height * 0.18, width * 0.12, width * 0.88)
    spread(wss, height * 0.5, width * 0.2, width * 0.8)
    spread(agents, height * 0.82, width * 0.12, width * 0.88)
  } else if (mode === 'agent') {
    // Une colonne par agent, conversations réparties au-dessus
    spread(convs, height * 0.16, width * 0.12, width * 0.88)
    const cols = ['nexus', 'seeker', 'deck']
    const groups = cols.map((a) => agents.filter((n) => n.agent === a))
    groups.forEach((g, i) => {
      const cx = width * (0.25 + i * 0.25)
      g.forEach((n, j) => pos.set(n.id, { x: cx, y: height * (0.5 + j * 0.18) }))
    })
    wss.forEach((n, i) => pos.set(n.id, { x: width * 0.08, y: height * (0.4 + i * 0.14) }))
  } else {
    // recent : les nœuds agent/workspace à droite, conversations serrées à gauche
    spread(convs, height * 0.3, width * 0.08, width * 0.55)
    spread(agents, height * 0.62, width * 0.68, width * 0.92)
    spread(wss, height * 0.85, width * 0.68, width * 0.92)
  }
  return pos
}

/* ======================= Obsidian ======================= */

export interface VaultNote {
  path: string
  size: number
}

export interface NoteGroup {
  /** Nom de dossier affiché (racine → « 📄 racine ») */
  dir: string
  label: string
  notes: VaultNote[]
}

/**
 * Regroupe les notes par dossier, triées : dossiers par nom, notes par nom.
 * Lisible et déterministe — et on ne touche pas au disque.
 */
export function groupNotes(notes: VaultNote[], query = ''): NoteGroup[] {
  const lq = query.trim().toLowerCase()
  const filtered = lq ? notes.filter((n) => n.path.toLowerCase().includes(lq)) : notes
  const map = new Map<string, VaultNote[]>()
  for (const n of filtered) {
    const dir = n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : ''
    const arr = map.get(dir) ?? []
    arr.push(n)
    map.set(dir, arr)
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dir, ns]) => ({
      dir,
      label: dir ? '📁 ' + dir : '📄 racine',
      notes: ns.sort((a, b) => a.path.localeCompare(b.path)),
    }))
}

/** Résumé humain d'un coffret : « 42 notes · 12 dossiers · 1,2 Mo ». */
export function vaultSummary(notes: VaultNote[]): string {
  const dirs = new Set(notes.map((n) => (n.path.includes('/') ? n.path.split('/')[0] : '')))
  const bytes = notes.reduce((a, n) => a + (n.size || 0), 0)
  const mo = bytes > 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} Mo` : `${Math.max(1, Math.round(bytes / 1024))} ko`
  return `${notes.length} notes · ${dirs.size} dossier(s) · ${mo}`
}
