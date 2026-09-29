# Architecture serveur — ChatDeck

> Faits vérifiés dans le code (sandbox-server.ts, cascade-server.ts,
> provider-proxy-server.ts, electron/main.mjs). En cas de doute, le code gagne.

## Deux modes, un seul serveur

Le MÊME code serveur sert le dev et l'app packagée : `sandbox-server.ts`,
bundlé par esbuild (`npm run build:api` → `electron/api-server.mjs`).

| | Dev | App packagée |
|---|---|---|
| Serveur | Plugin Vite (`sandboxServer()`, `deckServer()`, `cascadeServer()`, `providerProxyServer()`) | `ChatDeckApi` (classe du même fichier) spawné par `electron/main.mjs` |
| URL | `http://127.0.0.1:5199` (vite, **IPv4 explicite**) | `http://127.0.0.1:<port aléatoire>` — lu via `lsof`, pas via `chatdeck-port.txt` (périmé) |
| UI | modules Vite à la volée | `dist/` servi statiquement, fallback SPA (toute route inconnue → index.html) |
| Clés | `keys.local.json` du projet (`/keys.local`) | `~/.chatdeck/keys.local.json` d'abord, puis projet |

**Règle d'or** : tout nouvel endpoint `/api/*` doit être monté DEUX FOIS
(plugin Vite ET `ChatDeckApi.start()`) sinon il répond le fallback SPA en app
— HTML lu comme JSON/SSE → « Unexpected token '<' » ou « réponse vide ».
C'est le bug des versions 0.4.6 (cascade) et 0.4.9 (proxy fournisseurs).
Les verrous e2e : `e2e/standalone-api.spec.ts` (12 tests, bundle réel).

## Endpoints (montage dans ChatDeckApi.start / plugins Vite)

| Endpoint | Handler | Rôle |
|---|---|---|
| `/health`, `/api/health` | — | standalone : `{ok, server:'standalone'}` immédiat ; dev : sonde des 6 fournisseurs (cache 10 s, timeout 5 s, 1 retry anti cold-start) |
| `/keys.local` | — | clés locales (dev : projet ; app : `~/.chatdeck/`) — **jamais bundlé, gitignoré** |
| `/api/sandbox/<conv>/<action>` | `sandboxHandler` | sandbox disque (voir plus bas) |
| `/api/deck/…` | `deckHandler` | fiches .CD : cards/card/search (frontmatter parsé), écriture limitée à `./.cd/` |
| `/api/cascade`, `/api/cascade-check` | `cascadeApiMount` | cascade méga-pack (voir plus bas) |
| `/api/<fournisseur>/…` | `providerProxyMount` | proxy des **6** fournisseurs (`PROVIDER_IDS` de provider-proxy-server.ts — liste partagée, ne JAMAIS re-lister en dur) |
| tout le reste | — | `dist/` puis fallback SPA (index.html) |

## Sandbox disque

- Racine : `~/.chatdeck/workspaces/` — un espace **par conversation** et **par
  OS** : `<conv-id>/` (OS hôte) + `<conv-id>@@mac|windows|linux`. Le POST
  `/api/sandbox/:id/os` purge les `platform/` des autres profils avant
  d'écrire celui choisi.
- Confinement : `safeResolve`/`safeResolveIn` (realpath, anti path-traversal),
  tailles plafonnées, commandes agents en **liste blanche** (`sandboxExec`),
  spawn **sans shell**, timeout 60 s.
- Toollog : journal des outils par conversation (`loadToolLog` — lecture
  tableau stricte, cf. 0.4.3).
- MCP stdio : serveurs de `~/.chatdeck/mcp-servers.local.json`, handshake
  initialize/initialized, appariement JSON-RPC par id. **Anti-crash** :
  `child.on('error')` + retrait du registre — un spawn raté (`npx` ENOENT
  sous launchd) ne tue plus le serveur (0.4.9).
- Cleanup : POST `/api/sandbox/cleanup` `{orphans, maxAgeDays}` (🧹 Réglages).

## Cascade méga-pack (cascade-server.ts)

Ordre : `omniroute → freellm → groq → cerebras → mistral → cohere → gemini →
openrouter → anthropic` — 2 maillons locaux (OmniRoute :20128, FreeLLMAPI
:8000, LaunchAgents) + 7 APIs cloud. Timeout d'appel 60 s, bascule au maillon
suivant, réponse : gagnant `{text, provider, latencyMs, switches, attempts}`
ou 502 JSON. Clés résolues depuis `keys.local.json` (projet) ET
`~/.chatdeck/keys.local.json` (app). `/api/cascade-check` : santé des 9
maillons.

## Proxy fournisseurs (provider-proxy-server.ts)

`PROVIDER_IDS` = openrouter, nvidia, cohere, mistral, **groq** (path
`/openai/v1`), **xai** (path `/v1`). Re-émission `fetch` (SSE inclus,
`duplex: 'half'`), en-têtes hop-by-hop retirés, échec réseau → **502 JSON**
(jamais HTML). Plugin Vite sur `/api` + mount standalone — les deux passent
par la même fonction.

## Electron (electron/main.mjs)

Spawn l'api-server (Node embarqué), écrit le port dans
`userData/chatdeck-port.txt` (référence faible : le port **change à chaque
lancement**, préférer `lsof -nP -iTCP -sTCP:LISTEN -a -p $(pgrep -f
"api-server.mjs --serve")`). Géométrie persistée (`chatdeck-window.json`,
`-multi` → `chatdeck-window-multi.json`), single-instance par défaut, IPC
« + instance ». Fenêtre OS = châssis ; les modes flottant/pill/snap restent
navigateur-only (guards 0.4.6).

## Sécurité (règles non négociables)

- Le sandbox exécute du code non fiable : pas de `eval`, pas d'accès réseau
  libre, entrées UI passées par DOMPurify + validation marked.
- Les clés ne quittent jamais la machine : `keys.local.json` gitigné, jamais
  loggué, jamais renvoyé ailleurs qu'au fournisseur choisi (via le proxy).
- Aucun write hors workspace sandbox + dossiers projet explicitement
  autorisés (`projects-folders.local.json`, lecture seule, cap 1 Mo).

## Ports de la machine (usage personnel)

| Port | Service | LaunchAgent |
|---|---|---|
| 5199 | vite dev (UI + API) | `com.mickael.chatdeck` (KeepAlive + watchdog 2 min) |
| aléatoire | api-server app | spawné par ChatDeck.app (`com.mickael.chatdeck-app`) |
| 8000 | FreeLLMAPI | `com.mickael.freellmapi` |
| 20128 | OmniRoute | `com.omniroute.autostart` |

Détail LaunchAgents + pièges : [launchagents.md](launchagents.md).
