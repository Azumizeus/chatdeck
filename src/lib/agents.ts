// Agents ChatDeck — Nexus (orchestrateur multidisciplinaire) et Seeker (exploratrice).
//
// Chaque agent expose des outils OpenAI-compatible (function calling) qui agissent
// sur la sandbox de la conversation (~/.chatdeck/workspaces/<conv-id>, endpoints
// /api/sandbox). Nexus peut déléguer à Seeker dans le même fil (délégation multi-agents).
import { streamChat, type WireMsg } from './llm'
import type { CustomProvider } from './store'

/* ---------- Condenseur de contexte (inspiré d'OpenHands) ----------
 *
 * Quand le fil dépasse CONTEXT_LIMIT messages, la partie ancienne de
 * l'historique est remplacée par un résumé LLM borné — le fil reste léger
 * sans perdre le fil narratif. Échec LLM → repli transparent : on renvoie
 * l'historique complet (jamais de conversation cassée pour un résumé).
 */

/** Seuil : au-delà de N messages (hors système), on condense l'historique ancien. */
export const CONTEXT_LIMIT = 40
/** Nombre de messages récents conservés tels quels autour du résumé. */
const CONTEXT_KEEP = 12

/**
 * Condense l'historique si nécessaire. `summarizer` désigne le modèle qui
 * résume (provider/model/key de la conversation courante). Renvoie les wires
 * prêt à envoyer — soit l'original, soit [résumé + récents].
 */
export async function condenseHistory(
  wires: WireMsg[],
  summarizer: { providerId: string; model: string; apiKey: string; customs?: CustomProvider[]; temperature?: number; maxTokens?: number },
): Promise<WireMsg[]> {
  const convo = wires.filter((w) => w.role !== 'system' && w.role !== 'tool' && !w.tool_calls)
  if (convo.length <= CONTEXT_LIMIT) return wires
  const cut = convo.length - CONTEXT_KEEP
  if (cut <= 0) return wires
  const old = convo.slice(0, cut)
  const transcript = old
    .map((w) => `${w.role.toUpperCase()} : ${typeof w.content === 'string' ? w.content.slice(0, 1500) : '(contenu structuré)'}`)
    .join('\n\n')
  const SYS = "Tu condenses l'historique d'une conversation technique pour qu'un agent puisse continuer à travailler sans le revoir en entier. Produis une synthèse factuelle et compacte (max ~300 mots) : sujet courant, décisions prises, fichiers créés/modifiés, outils utilisés et résultats, tâches restantes. Aucune invention, aucun commentaire — juste la synthèse."
  try {
    let summary = ''
    await streamChat({
      providerId: summarizer.providerId as never,
      apiKey: summarizer.apiKey,
      model: summarizer.model,
      temperature: 0.2,
      maxTokens: summarizer.maxTokens ?? 600,
      signal: AbortSignal.timeout(20_000),
      customs: summarizer.customs,
      messages: [
        { role: 'system', content: SYS },
        { role: 'user', content: `Historique à condenser (du plus ancien au plus récent) :\n\n${transcript.slice(0, 60_000)}` },
      ],
      onDelta: (t) => {
        summary += t
      },
    })
    if (!summary.trim()) return wires
    const head: WireMsg[] = wires.slice(0, wires.length - convo.length)
    return [...head, { role: 'system', content: `[Résumé des ${cut} premiers messages de la conversation] ${summary.trim()}` }, ...convo.slice(cut)]
  } catch {
    return wires
  }
}

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
/**
 * Outils disponibles pour un agent. `readOnly` (Mode Plan, inspiré d'OpenCode)
 * retire TOUT outil d'écriture : write_file, délégations et git_commit —
 * l'agent analyse et propose, il ne modifie jamais la sandbox.
 */
export function toolsFor(agent: AgentId, readOnly = false): ToolDef[] {
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
  const tools: ToolDef[] = [
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
    {
      type: 'function',
      function: {
        name: 'switch_os',
        description:
          'Change l\'environnement de développement de la sandbox : mac, windows ou linux. Purge les fichiers platform/ de l\'ancien profil et écrit celui choisi — l\'arborescence reflète le nouvel OS après l\'appel.',
        parameters: {
          type: 'object',
          properties: { os: P('os', 'string', 'Profil visé : mac | windows | linux') },
          required: ['os'],
        },
      },
    },
  ]
  if (!readOnly) return tools
  // Mode Plan : lecture seule — les noms d'outils d'écriture sont filtrés
  const deny = new Set(['write_file', 'git_commit', 'delegate_to_seeker', 'delegate_to_deck', 'delegate_to_nexus'])
  return tools.filter((t) => !deny.has(t.function.name))
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
    case 'switch_os': {
      const os = String(call.args.os ?? '')
      if (os !== 'mac' && os !== 'windows' && os !== 'linux') return `❌ os invalide : « ${os} » (mac | windows | linux)`
      const r = await fetch(`/api/sandbox/${convId}/os`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ os }),
      })
      const j = (await r.json()) as { ok?: boolean; os?: string; error?: string }
      if (j.error) return `❌ switch_os refusé : ${j.error}`
      return `✅ environnement basculé sur ${j.os} — platform/ purgé des autres profils, arborescence à jour (list_tree pour la voir)`
    }
    default:
      throw new Error(`outil inconnu : ${call.name}`)
  }
}

/* ---------- prompts système avec contexte sandbox ---------- */

export function systemPromptFor(agent: AgentId, settingsSystem: string, delegation?: { task: string; from?: AgentId }, readOnly = false): string {
  const persona = AGENTS[agent]
  const base = [persona.system, settingsSystem.trim()].filter(Boolean).join('\n\n')
  const writeTools = readOnly ? '' : "write_file (créer/modifier un fichier), git_commit (sauvegarder l'état), switch_os (basculer mac|windows|linux),"
  const sandbox = readOnly
    ? `Tu disposes d'une sandbox disque partagée par conversation, en MODE PLAN (lecture seule) : tu peux lister et lire les fichiers, exécuter des commandes d'inspection et consulter le web, mais tu ne dois PAS modifier la sandbox. Analyse, propose un plan d'implémentation en étapes concrètes, indique les fichiers à créer/modifier et les risques — sans rien écrire. Les chemins sont relatifs au workspace.`
    : `Tu disposes d'une sandbox disque partagée par conversation. Les chemins sont relatifs au workspace. En mode collaboratif, l'autre agent écrit dans le MÊME workspace : liste l'arbre avant d'écrire pour éviter d'écraser ses fichiers.`
  const capabilities = `## Environnement ChatDeck

Tu travailles dans ChatDeck, une app qui te donne un vrai poste de développement virtuel :

- **Sandbox disque persistante** par conversation (~/.chatdeck/workspaces/<id>). Tes fichiers survivent entre les tours et sont visibles par l'utilisateur dans le panneau Fichiers (hub « Outils »).
- **Trois environnements de développement simulés** : mac, windows, linux. Le profil actif détermine les fichiers platform/ du workspace (ex. Info.plist sous mac, app.config.json sous windows). Utilise switch_os pour changer — le disque est purgé de l'ancien profil automatiquement. L'utilisateur voit le même arbre que toi : annonce le changement si tu le fais.
- **Outils disponibles** : list_tree (arborescence), read_file, run_command (ls, cat, pwd, node -v, npm -v… liste blanche), ${writeTools} web_fetch (télécharger une page web), promptdeck_browse (catalogue de 190 agents + 133 skills pour personas et méthodes).
- **Git intégré** : le workspace est un dépôt ; git_commit fait add+commit de tout avec un message obligatoire. Des checkpoints automatiques permettent à l'utilisateur d'annuler un tour (bouton ↩) — ne compte pas dessus pour corriger tes erreurs, committe proprement.
- **Délégation** : ${agent === 'nexus' ? 'delegate_to_seeker (recherche/analyse approfondie) et delegate_to_deck (conception de prompts/personas)' : agent === 'deck' ? 'delegate_to_nexus (orchestration et synthèse)' : 'tu peux recevoir des missions de Nexus et rendre ton rapport via report_to_deck'}.
- **Fiches .CD actives** : si des fiches sont injectées ci-dessus (section « Fiches actives »), elles sont des méthodes/personas que tu DOIS appliquer pendant cette conversation.

Réponds en français, agis avec les outils au lieu de spéculer, et dis toujours à l'utilisateur ce que tu as fait sur le disque.`
  if (delegation) {
    const from = delegation.from === 'nexus' ? 'Nexus' : delegation.from === 'deck' ? 'PromptDeck' : 'Nexus'
    const reportTool = reportToolNameFor(agent)
    return `${base}\n\n${capabilities}\n\n${sandbox}\n\nMission transmise par ${from} : « ${delegation.task} »\nTravaille, puis appelle ${reportTool} avec ton rapport final.`
  }
  return `${base}\n\n${capabilities}\n\n${sandbox}`
}
