// Agents ChatDeck — Nexus (orchestrateur multidisciplinaire) et Seeker (exploratrice).
//
// Chaque agent expose des outils OpenAI-compatible (function calling) qui agissent
// sur la sandbox de la conversation (~/.chatdeck/workspaces/<conv-id>, endpoints
// /api/sandbox). Nexus peut déléguer à Seeker dans le même fil (délégation multi-agents).

export type AgentId = 'nexus' | 'seeker'

export interface AgentPersona {
  id: AgentId
  name: string
  role: string
  emoji: string
  color: string
  /** Instructions système injectées quand l'agent parle */
  system: string
}

export const AGENTS: Record<AgentId, AgentPersona> = {
  nexus: {
    id: 'nexus',
    name: 'Nexus',
    role: 'Orchestrateur multidisciplinaire',
    emoji: '🧠',
    color: '#4f8cff',
    system: `Tu es Nexus, super agent orchestrateur multidisciplinaire (architecte logiciel, sécurité, données, produit). Tu pilotes la conversation et la sandbox : tu écris le brief dans NOTES.md, tu crées les fichiers, tu délègues à Seeker quand une exploration ou une recherche approfondie est nécessaire. Tu es rigoureux, structuré, tu réponds en français, concis et actionnable. Quand tu écris un fichier, résume ce que tu as écrit.`,
  },
  seeker: {
    id: 'seeker',
    name: 'Seeker',
    role: 'Exploratrice — recherche & analyse',
    emoji: '🔎',
    color: '#27c93f',
    system: `Tu es Seeker, agent exploratrice spécialisée en recherche et analyse : tu explores la sandbox (ls, cat, search), tu croises les informations, tu proposes des hypothèses testables et tu rédiges tes conclusions dans des fichiers si Nexus te le demande. Tu réponds en français, précise et curieuse.`,
  },
}

/* ---------- outils (function calling OpenAI-compatible) ---------- */

export interface ToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, { type: string; description: string }>
      required?: string[]
    }
  }
}

const P = (name: string, type: string, description: string): { type: string; description: string } => ({
  type,
  description,
})

/** Outils communs aux deux agents, agissant sur la sandbox de la conversation. */
export function toolsFor(agent: AgentId): ToolDef[] {
  const write: ToolDef[] =
    agent === 'nexus'
      ? [
          {
            type: 'function',
            function: {
              name: 'write_file',
              description: 'Écrit (ou écrase) un fichier dans la sandbox de la conversation. Crée les dossiers parents.',
              parameters: {
                type: 'object',
                properties: {
                  path: P('path', 'string', 'Chemin relatif dans le workspace (ex. src/app.js, NOTES.md)'),
                  content: P('content', 'string', 'Contenu complet du fichier'),
                },
                required: ['path', 'content'],
              },
            },
          },
          {
            type: 'function',
            function: {
              name: 'delegate_to_seeker',
              description:
                "Délègue une sous-tâche à Seeker (exploration, recherche, analyse). Utilise-le quand une tâche demande de l'exploration approfondie.",
              parameters: {
                type: 'object',
                properties: {
                  task: P('task', 'string', 'Consigne claire pour Seeker'),
                },
                required: ['task'],
              },
            },
          },
        ]
      : []
  return [
    {
      type: 'function',
      function: {
        name: 'list_tree',
        description: 'Liste l’arborescence de la sandbox (fichiers et dossiers).',
        parameters: { type: 'object', properties: {} },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_file',
        description: 'Lit le contenu d’un fichier de la sandbox.',
        parameters: {
          type: 'object',
          properties: { path: P('path', 'string', 'Chemin relatif dans le workspace') },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'run_command',
        description: 'Exécute une commande en liste blanche dans la sandbox : ls [chemin], cat <fichier>, pwd, node -v, npm -v.',
        parameters: {
          type: 'object',
          properties: { cmd: P('cmd', 'string', 'Commande à exécuter') },
          required: ['cmd'],
        },
      },
    },
    ...write,
  ]
}

/** Outil supplémentaire Seeker → rendre son rapport à Nexus (utilisé par la boucle de délégation). */
export const REPORT_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'report_to_nexus',
    description: 'Rends ton rapport final à Nexus (résumé des découvertes et fichiers produits).',
    parameters: {
      type: 'object',
      properties: { report: P('report', 'string', 'Rapport synthétique pour Nexus') },
      required: ['report'],
    },
  },
}

/* ---------- exécution des outils contre la sandbox ---------- */

export type ToolCall = { id: string; name: string; args: Record<string, unknown> }

async function api<T>(method: string, convId: string, action: string, body?: unknown, query = ''): Promise<T> {
  const res = await fetch(`/api/sandbox/${convId}/${action}${query}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const j = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`)
  return j
}

export interface FileNode {
  name: string
  type: 'file' | 'dir'
  size?: number
  children?: FileNode[]
}

/** Exécute un appel d'outil. Renvoie le résultat à renvoyer au modèle (chaîne). */
export async function execTool(convId: string, call: ToolCall): Promise<string> {
  switch (call.name) {
    case 'list_tree': {
      const j = await api<{ exists: boolean; tree: FileNode[] }>('GET', convId, 'tree')
      const fmt = (nodes: FileNode[], d = 0): string =>
        nodes
          .map((n) => `${'  '.repeat(d)}${n.type === 'dir' ? '📁' : '📄'} ${n.name}`)
          .join('\n')
      return j.exists ? fmt(j.tree) : '(workspace vide — appelle bootstrap_workspace si disponible, sinon demande à l’utilisateur de le créer)'
    }
    case 'read_file': {
      const p = String(call.args.path ?? '')
      const j = await api<{ content: string }>('GET', convId, 'file', undefined, `?path=${encodeURIComponent(p)}`)
      return j.content || '(fichier vide)'
    }
    case 'write_file': {
      const p = String(call.args.path ?? '')
      const c = String(call.args.content ?? '')
      await api('PUT', convId, 'file', { path: p, content: c })
      return `✅ écrit : ${p} (${c.length} caractères)`
    }
    case 'run_command': {
      const cmd = String(call.args.cmd ?? '')
      const j = await api<{ out: string }>('GET', convId, 'exec', undefined, `?cmd=${encodeURIComponent(cmd)}`)
      return j.out
    }
    default:
      throw new Error(`outil inconnu : ${call.name}`)
  }
}

/* ---------- prompts système avec contexte sandbox ---------- */

export function systemPromptFor(agent: AgentId, settingsSystem: string, delegation?: { task: string }): string {
  const persona = AGENTS[agent]
  const base = [persona.system, settingsSystem.trim()].filter(Boolean).join('\n\n')
  const sandbox = `Tu disposes d'une sandbox disque par conversation. Outils : list_tree, read_file, run_command${agent === 'nexus' ? ', write_file, delegate_to_seeker' : ''}. Les chemins sont relatifs au workspace.`
  if (agent === 'seeker' && delegation) {
    return `${base}\n\n${sandbox}\n\nMission transmise par Nexus : « ${delegation.task} »\nExplore, puis appelle report_to_nexus avec ton rapport final.`
  }
  return `${base}\n\n${sandbox}`
}
