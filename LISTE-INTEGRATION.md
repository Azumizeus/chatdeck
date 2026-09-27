# Intégration ChatDeck ← OpenHands & OpenCode

Analyse des deux repos de référence (26/09/2026) et ce qu'on va en retenir.
Sources : `github.com/OpenHands/OpenHands` (Agent Canvas + Agent Server/SDK),
`github.com/opencode-ai/opencode` (agent terminal, docs opencode.ai).

## Ce qu'ils font de mieux (résumé)

**OpenHands** : Agent Canvas (control center multi-backends locaux/VM/cloud,
bascule sans perdre le contexte), Agent Server REST (plusieurs agents par
machine), **Event System immuable + EventLog rejouable**, **Context Condenser**
(historique borné remplacé par un résumé LLM), **microagents** (fiches
contextuelles déclenchées par mots-clés), automations (schedules/webhooks →
Slack/GitHub/Linear), Agent Skills en slash-menu.

**OpenCode** : agents primaires **Build/Plan** (Plan = lecture seule, édits
interdits), **sous-agents @mention** (General/Explore/Scout), **permissions
par outil** (`allow/ask/deny` sur edit/bash/...), **/undo & /redo** (revert des
modifs de l'agent, message rejouable), sessions enfants navigables
(parent/child cycle), /share (lien de conversation), @fuzzy-search de fichiers
dans le prompt, images drag&drop dans le prompt, AGENTS.md committé
(/init analyse le projet), compaction automatique, /connect multi-providers.

## Liste d'intégration dans ChatDeck (par priorité)

| # | Fonction | Venant de | Effort | Où dans ChatDeck |
|---|----------|-----------|--------|------------------|
| 1 | **Mode Plan** (lecture seule) | OpenCode | S | agents.ts : persona `plan` sans outils d'écriture ; toggle Tab dans le composer |
| 2 | **Permissions par outil** (allow/ask/deny) | OpenCode | M | SettingsPanel → `agents.ts` (gate autour d'execTool) |
| 3 | **/undo — revert des modifs agent** | OpenCode | M | sandbox : checkpoint git avant chaque tour d'agent ; bouton ↩ dans MessageActions |
| 4 | **Condenseur de contexte** | OpenHands | M | au-delà de N messages : résumé LLM injecté, EventLog conservé dans le fil |
| 5 | **Microagents (fiches par mots-clés)** | OpenHands | S | nos fiches .CD gagnent un champ `triggers:` ; match dans send() |
| 6 | **@fichier dans le prompt** | OpenCode | S | autocomplétion @ dans Composer → extrait du fichier sandbox attaché |
| 7 | **AGENTS.md par projet (/init)** | OpenCode | S | bouton « /init » → écrit AGENTS.md dans la sandbox, injecté au system |
| 8 | **Sessions enfants (sous-agents)** | OpenCode | L | délégations déjà faites → arborescence navigable dans le fil |
| 9 | **Automations (schedule/webhook)** | OpenHands | L | hors scope desktop v1 — carte pour plus tard |
| 10 | **Multi-backends (bascule serveur)** | OpenHands | L | hors scope desktop v1 |

Légende : S = petite, M = moyenne, L = grosse.
Décision : on attaque 1, 3, 5, 6, 7 (quick wins à forte valeur), puis 2 et 4.
