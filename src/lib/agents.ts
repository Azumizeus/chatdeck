// Agents ChatDeck — Nexus (orchestrateur multidisciplinaire) et Seeker (exploratrice).
//
// Chaque agent expose des outils OpenAI-compatible (function calling) qui agissent
// sur la sandbox de la conversation (~/.chatdeck/workspaces/<conv-id>, endpoints
// /api/sandbox). Nexus peut déléguer à Seeker dans le même fil (délégation multi-agents).

export type AgentId = 'nexus' | 'seeker' | 'deck'

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
  deck: {
    id: 'deck',
    name: 'PromptDeck',
    role: 'Stratège prompts & prompts système',
    emoji: '🃏',
    color: '#b06bff',
    system: `Tu es PromptDeck, agent stratège issu du MEGA PACK PromptDeck (190 agents, 133 skills) : tu conçois et améliores les prompts système, tu décomposes les tâches complexes en sous-prompts, tu proposes des personas et des skills adaptés. En mode collaboratif, tu travailles EN PARALLÈLE avec Nexus dans le MÊME workspace sandbox : écris tes livrables dans des fichiers clairement nommés (préfixe deck-, ex. deck-prompts.md), lis ceux de Nexus (préfixe nexus-) et mentionne explicitement les fichiers que tu as lus. Tu réponds en français, créatif et méthodique.`,
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

/** Outils des agents, agissant sur la sandbox (partagée) de la conversation. */
export function toolsFor(agent: AgentId): ToolDef[] {
  // write_file : Nexus et PromptDeck (collaboration au même workspace) ; Seeker reste lecture
  const write: ToolDef[] =
    agent === 'nexus' || agent === 'deck'
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
        ]
      : []
  // Délégations : Nexus → Seeker / PromptDeck ; PromptDeck → Nexus (bidirectionnel)
  const delegate: ToolDef[] =
    agent === 'nexus'
      ? [
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
          {
            type: 'function',
            function: {
              name: 'delegate_to_deck',
              description:
                'Délègue une sous-tâche à PromptDeck (conception de prompts, personas, skills, décomposition en sous-prompts).',
              parameters: {
                type: 'object',
                properties: {
                  task: P('task', 'string', 'Consigne claire pour PromptDeck'),
                },
                required: ['task'],
              },
            },
          },
        ]
      : agent === 'deck'
        ? [
            {
              type: 'function',
              function: {
                name: 'delegate_to_nexus',
                description:
                  'Délègue une sous-tâche à Nexus (architecture, écriture de code, décisions produit). Rapport retour garanti.',
                parameters: {
                  type: 'object',
                  properties: {
                    task: P('task', 'string', 'Consigne claire pour Nexus'),
                  },
                  required: ['task'],
                },
              },
            },
          ]
        : []
  const extra: ToolDef[] =
    agent === 'deck'
      ? [
          {
            type: 'function',
            function: {
              name: 'promptdeck_browse',
              description: 'Explore le MEGA PACK PromptDeck (agents + skills) pour choisir personas et skills adaptés à la tâche.',
              parameters: { type: 'object', properties: {} },
            },
          },
        ]
      : []
  return [
    ...extra,
    ...delegate,
    ...write,
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
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description:
          'Explore le web : télécharge une page http(s) et renvoie son texte brut (200 ko max). Utilise-le pour documenter, vérifier une API ou citer une source.',
        parameters: {
          type: 'object',
          properties: { url: P('url', 'string', 'URL http(s) complète à récupérer') },
          required: ['url'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'git_commit',
        description:
          'Commit auto : git add + commit de TOUS les fichiers du workspace via l\'endpoint sécurisé (message obligatoire, branche par défaut uniquement).',
        parameters: {
          type: 'object',
          properties: {
            message: P('message', 'string', 'Message de commit concis et descriptif'),
          },
          required: ['message'],
        },
      },
    },
  ]
}

/** Outils « rendre rapport » après délégation (Seeker et PromptDeck → Nexus, Nexus → PromptDeck). */
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

export const REPORT_TO_DECK_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'report_to_deck',
    description: 'Rends ton rapport final à PromptDeck (livrables produits, décisions prises).',
    parameters: {
      type: 'object',
      properties: { report: P('report', 'string', 'Rapport synthétique pour PromptDeck') },
      required: ['report'],
    },
  },
}

/** Outil de rapport attendu quand un agent travaille pour un autre (délégation). */
export function reportToolFor(worker: AgentId): ToolDef {
  return worker === 'deck' ? REPORT_TO_DECK_TOOL : REPORT_TOOL
}

/** Nom de l'outil de rapport que cet agent doit appeler pour conclure une délégation. */
export const reportToolNameFor = (worker: AgentId): string =>
  worker === 'deck' ? 'report_to_deck' : 'report_to_nexus'

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
    case 'web_fetch': {
      const url = String(call.args.url ?? '')
      const r = await fetch(`/api/sandbox/${convId}/webfetch?url=${encodeURIComponent(url)}`)
      const j = (await r.json()) as { status?: number; text?: string; error?: string; contentType?: string }
      if (j.error) return `Erreur web_fetch : ${j.error}`
      return `HTTP ${j.status} (${j.contentType ?? '?'}) — ${url}\n\n${(j.text ?? '').slice(0, 12_000)}`
    }
    case 'promptdeck_browse': {
      const r = await fetch('/api/sandbox/promptdeck')
      const j = (await r.json()) as { path?: string; tree?: { name: string; type: string; children?: { name: string; type: string }[] }[]; error?: string }
      if (j.error) return `PromptDeck indisponible : ${j.error}`
      const fmt = (nodes: { name: string; type: string }[] | undefined, d = 0): string =>
        (nodes ?? []).map((n) => `${'  '.repeat(d)}${n.type === 'dir' ? '📁' : '📄'} ${n.name}${n.type === 'dir' && 'children' in n && Array.isArray((n as { children?: unknown }).children) ? ` (${((n as { children: unknown[] }).children).length})` : ''}`).join('\n')
      return `PromptDeck : ${j.path}\n\n${fmt(j.tree)}`
    }
    case 'delegate_to_deck':
      throw new Error('DELEGATE:deck:' + String(call.args.task ?? ''))
    case 'delegate_to_nexus':
      throw new Error('DELEGATE:nexus:' + String(call.args.task ?? ''))
    case 'git_commit': {
      const message = String(call.args.message ?? '')
      const r = await fetch(`/api/sandbox/${convId}/git-commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const j = (await r.json()) as { ok?: boolean; hash?: string; subject?: string; files?: number; error?: string }
      if (j.error) return `❌ commit refusé : ${j.error}`
      return `✅ commit ${j.hash} — « ${j.subject} » (${j.files} fichiers)`
    }
    default:
      throw new Error(`outil inconnu : ${call.name}`)
  }
}

/* ---------- prompts système avec contexte sandbox ---------- */

export function systemPromptFor(agent: AgentId, settingsSystem: string, delegation?: { task: string; from?: AgentId }): string {
  const persona = AGENTS[agent]
  const base = [persona.system, settingsSystem.trim()].filter(Boolean).join('\n\n')
  const sandbox = `Tu disposes d'une sandbox disque partagée par conversation. Outils : list_tree, read_file, run_command, web_fetch, git_commit${agent === 'nexus' ? ', write_file, delegate_to_seeker, delegate_to_deck' : agent === 'deck' ? ', write_file, delegate_to_nexus' : ', write_file'}. Les chemins sont relatifs au workspace. En mode collaboratif, l'autre agent écrit dans le MÊME workspace : liste l'arbre avant d'écrire pour éviter d'écraser ses fichiers.`
  if (delegation) {
    const from = delegation.from === 'nexus' ? 'Nexus' : delegation.from === 'deck' ? 'PromptDeck' : 'Nexus'
    const reportTool = reportToolNameFor(agent)
    return `${base}\n\n${sandbox}\n\nMission transmise par ${from} : « ${delegation.task} »\nTravaille, puis appelle ${reportTool} avec ton rapport final.`
  }
  return `${base}\n\n${sandbox}`
}
