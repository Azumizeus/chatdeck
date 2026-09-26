// Graphe ChatDeck : conversations, workspaces sandbox et liens vers les agents.
// Calcul pur (aucune dépendance) — le rendu SVG est dans GraphPanel.svelte.

export interface GraphNode {
  id: string
  kind: 'conversation' | 'workspace' | 'agent'
  label: string
  /** Agent concerné (nœuds « agent ») */
  agent?: 'nexus' | 'seeker'
  /** Métadonnées d'affichage */
  detail?: string
}

export interface GraphLink {
  source: string
  target: string
  kind: 'sandbox' | 'agent'
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

interface ConvLike {
  id: string
  title: string
  model: string
  agents?: string[]
  sandboxReady?: boolean
  incognito?: boolean
  messages?: { role: string; content: string; agent?: string; toolEvents?: { tool: string; detail: string }[] }[]
}

/**
 * Construit le graphe : un nœud par conversation, un nœud workspace si agents,
 * un nœud par agent référencé (avec détection des liens entre messages d'agents
 * — délégations Nexus→Seeker visibles dans les toolEvents).
 */
export function buildGraph(convs: ConvLike[], workspaceIds: Set<string>): GraphData {
  const nodes: GraphNode[] = []
  const links: GraphLink[] = []

  for (const c of convs) {
    nodes.push({
      id: c.id,
      kind: 'conversation',
      label: c.title.slice(0, 22) || 'Sans titre',
      detail: `${c.messages?.length ?? 0} msg · ${c.model.split('/').pop() ?? c.model}${c.incognito ? ' · 👻' : ''}`,
    })

    const agents = c.agents ?? []
    const hasWs = workspaceIds.has(c.id)

    if (agents.length) {
      if (hasWs || c.sandboxReady) {
        nodes.push({ id: `ws:${c.id}`, kind: 'workspace', label: `sandbox ${c.id.slice(0, 8)}…` })
        links.push({ source: c.id, target: `ws:${c.id}`, kind: 'sandbox' })
      }
      const AGENT_LABELS: Record<string, { label: string; id: 'nexus' | 'seeker' }> = {
        nexus: { label: '🧠 Nexus', id: 'nexus' },
        seeker: { label: '🔎 Seeker', id: 'seeker' },
        deck: { label: '🃏 PromptDeck', id: 'seeker' }, // même teinte que les agents
      }
      for (const a of agents) {
        const aid = `agent:${a}:${c.id}`
        const meta = AGENT_LABELS[a] ?? { label: a, id: 'seeker' as const }
        nodes.push({ id: aid, kind: 'agent', label: meta.label, agent: meta.id })
        links.push({ source: c.id, target: aid, kind: 'agent' })
      }
      // Liens entre agents détectés dans les messages (délégations Nexus → Seeker)
      const nexusNode = `agent:nexus:${c.id}`
      for (const m of c.messages ?? []) {
        const delegated = (m.toolEvents ?? []).some((t) => t.tool === 'delegate_to_seeker')
        if (delegated && agents.includes('seeker')) {
          if (!links.some((l) => l.source === nexusNode && l.target === `agent:seeker:${c.id}`)) {
            links.push({ source: nexusNode, target: `agent:seeker:${c.id}`, kind: 'agent' })
          }
        }
      }
    }
  }
  return { nodes, links }
}

/** Couleurs par type de nœud (thème ChatDeck). */
export const KIND_COLOR: Record<GraphNode['kind'], string> = {
  conversation: '#4f8cff',
  workspace: '#ffb86b',
  agent: '#27c93f',
}

/** Layout déterministe : conversations sur 2 colonnes, agents/workspace en orbite. */
export function layoutGraph(data: GraphData, width: number, height: number): Map<string, { x: number; y: number }> {
  const pos = new Map<string, { x: number; y: number }>()
  const convs = data.nodes.filter((n) => n.kind === 'conversation')
  const others = data.nodes.filter((n) => n.kind !== 'conversation')

  convs.forEach((n, i) => {
    const col = i % 2
    const row = Math.floor(i / 2)
    pos.set(n.id, {
      x: width * (col === 0 ? 0.3 : 0.7),
      y: 40 + row * 64 + (col === 0 ? 0 : 32),
    })
  })

  others.forEach((n, i) => {
    const angle = (i / Math.max(1, others.length)) * Math.PI * 2
    pos.set(n.id, {
      x: width / 2 + Math.cos(angle) * Math.min(width, height) * 0.42,
      y: height / 2 + Math.sin(angle) * Math.min(width, height) * 0.3,
    })
  })
  return pos
}
