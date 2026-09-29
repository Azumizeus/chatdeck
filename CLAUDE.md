# ChatDeck

Interface multi-LLM (Svelte 5 + Vite 6) pour discuter avec plusieurs providers et
comparer leurs réponses. Serveur de bac à sable Node dédié, clés en local uniquement.

## Avant de commencer : consulte la bibliothèque

Ce projet embarque une bibliothèque de **636 fiches** (446 skills, 190 agents) sous
`promptdeck/`. Avant d'inventer une méthode ou de deviner ce qu'un agent ferait,
cherche ce qui existe déjà :

```bash
node promptdeck/search.mjs "ta tâche en français" --max 3
node promptdeck/search.mjs --show <id>          # charge 1 à 3 fiches
node promptdeck/search.mjs --categories
```

La recherche est bilingue : écris en français, elle trouve les fiches anglaises.

**Ne lis jamais `promptdeck/library/` en entier.** C'est une base de données à
interroger, pas une pile de prompts. Le skill `promptdeck` (dans `.claude/skills/`)
contient la table de routage complète — lis-le si tu hésites.

## Docs du projet

`docs/architecture.md` (serveur/endpoints/sandbox — **à lire avant de toucher à
sandbox-server.ts**), `docs/launchagents.md` (services locaux),
`docs/studyvault.md` (tuteur/Anki/OCR), `docs/hdiutil-contournement.md` (DMG),
`docs/guide-interactif.html` (guide utilisateur).

## Commandes

```bash
./bin/chatdeck              # démarre + ouvre le navigateur (port libre auto)
./bin/chatdeck --port 5200  # force le port
./bin/chatdeck --check      # svelte-check
./bin/chatdeck --stop       # arrête le serveur laissé en arrière-plan
npm test                    # vitest
npm run test:e2e            # playwright
npm run build               # dist/
```

`./bin/chatdeck` est préféré à `npm run dev` : il trouve un port libre (5199 est
souvent déjà pris) et n'ouvre le navigateur qu'une fois le serveur prêt. En
tâche de fond : `npm run dev:bg` (pid dans `.vite-dev.pid`, log `vite-dev.log`),
arrêt via `npm run dev:bg:stop` — indispensable après un redémarrage de machine.

## Réseau et santé

- **6 fournisseurs intégrés** : openrouter, nvidia, cohere, mistral, groq
  (path `/openai/v1`), xai (path `/v1`) — définis dans `PROVIDERS` (llm.ts),
  clés dans `Keys` (store.ts).
- **Proxy fournisseurs partagé** (`provider-proxy-server.ts`) : plugin Vite
  `providerProxyServer()` en dev **et** `providerProxyMount` monté dans
  `ChatDeckApi.start()` en app packagée. Ne jamais remettre de `server.proxy`
  pour les fournisseurs — c'est l'oubli de ce mount en packagé qui causait
  « réponse vide » (0.4.9). Verrous e2e dans `e2e/standalone-api.spec.ts`.
- `/api/health` sonde les providers (cache TTL 10 s, timeout 5 s) et renvoie
  `{ok, server, providers:{id:{up,status,ms}}, allUp}`.
- Vite écoute en **IPv4 explicite** (`host: '127.0.0.1'` dans vite.config.ts) :
  ne pas repasser à `localhost` — l'ordre de résolution v4/v6 variait et
  provoquait des « Failed to fetch » aléatoires.
- Côté client : `src/lib/net.svelte.ts` (singleton `net`) sonde le proxy toutes
  les 60 s ; `NetworkBanner.svelte` affiche un « Réessayer » si le proxy est
  down (hystérésis : 2 échecs consécutifs), et StatusBar montre des pastilles
  vert/rouge par provider.

## Interface (éléments récents)

- **MessageActions.svelte** : barre sous chaque message (copier, régénérer,
  répondre, Obsidian, réutiliser, tronquer) — branchée sur la vue principale et
  le duel.
- **Délégation bidirectionnelle** : `delegate_to_deck` / `delegate_to_nexus` /
  `delegate_to_seeker` interceptés dans `runTurns` (agents.ts) ; l'agent cible
  rend son rapport via `report_to_deck` / `report_to_nexus`, injecté comme
  message « (X a rendu son rapport à Y) » dans le fil d'origine (≤ 6 sauts).
- **FilesPanel.svelte** : gestionnaire complet — arbre filtrable, renommer /
  dupliquer / supprimer, import drag&drop, download via /serve, preview live,
  diff Git par commit (endpoint sandbox `git-diff`), switcher d'OS, bouton ⤢.
- **GraphPanel.svelte + organize.ts** : graphe draggable avec positions
  persistées (`chatdeck.graph.v1`), rangement auto (type/agent/récence), export
  PNG 2×.
- **WelcomeTour.svelte** : visite guidée 6 étapes au premier lancement ;
  réglage `Settings.showTour` (Réglages → Apparence), rejouable via ⌘K « tour ».- **HubWindow.svelte** : fenêtre outils à onglets (graph/files/terminal/preview/
  settings/deck) ; réglage `Settings.hubTabs`/`hubDefault` (l'onglet actif est
  réécrit dans `hubDefault` au switch), géométrie
  `chatdeck.hub.v1` ; les panneaux y sont re-ancrés via la classe `.hubbed` (ils sont
  `position: fixed` chez eux) ; quand le hub affiche un onglet, le panneau
  docké équivalent est masqué (`!showHub || hubActive !== …`). Chaque onglet
  peut être extrait en popout dédié (`/#popout=<panel>`, canal
  `chatdeck-sync-v1`). **Fichiers et Graphify n'existent plus qu'en hub** :
  `toggleFiles()` et tous les boutons Graphify appellent `openHub(...)` —
  ne pas recréer d'overlay fixed pour eux. Le **terminal** est docké sous le
  composer (`.term-docked`, override `:global(.term)`).
- **Fiches par conversation** : `Conversation.cardsActive` (ids) prioritaire
  sur la sélection globale du DeckPanel ; pastille 🃏 du composer (menu
  `cards-pop`) ; le `Msg.cards` de l'envoi alimente le badge 🃏 de
  MessageActions. Édition des fiches projet : PUT `/api/deck/card`
  (frontmatter requis, pack en lecture seule).
- **Mode Plan** : `Conversation.planMode` → `toolsFor(agent, readOnly)` filtre
  write_file/git_commit/délégations + prompt « lecture seule » ; toggle Tab ou
  bouton 📋 Plan dans Composer. **/undo** : endpoint sandbox `git-undo`
  (checkpoint avant chaque runTurns, revert = reset vers le commit checkpoint,
  jamais les commits utilisateur) ; bouton ↩ dans MessageActions quand agents
  actifs et pas en Plan. **@fichier** : regex `@[\w./-]+` dans send() → extraits
  (4 ko) via /file dans le system. **Microagents** : champ `triggers:` (CSV) du
  frontmatter matché dans `activeCardsSystem()`.
- **Géométries** : hub par défaut amarré à DROITE du chat
  (`defaultHubGeometry`) — ne pas recentrer ; appGeo flottante re-clampée au
  viewport au montage (sinon zone noire dans les navigateurs plus larges).
- **CLI `deck`** (travail d'un autre agent, non commité à ce jour) : lit les
  fiches `.CD` dans `promptdeck/library/`, `./.cd/` et `~/.chatdeck/`.
  Première fiche projet : `.cd/skills/verification-lot.cd`.
- **DeckPanel.svelte** (onglet deck du hub, popout `#popout=deck`) : liste les
  fiches via `/api/deck/cards` (plugin `deckServer` de sandbox-server.ts),
  active par clic — état `chatdeck.cards.v1` (`{active, cache}` via
  `loadDeckState/saveDeckState`) — et crée des fiches (POST `/api/deck/cards`)
  dans `./.cd/`. L'injection dans le prompt se fait dans `App.send()` via
  `activeCardsSystem()` (plafond 12 fiches actives, cache rempli à
  l'activation — ne pas appeler `/api/deck/card` dans send()).
- **Profil OS (sandbox-server.ts)** : le POST `/api/sandbox/:id/os` purge les
  `platform/` des autres profils avant d'écrire celui choisi — un switch
  mac→windows→mac ne laisse plus de fichiers résiduels.
- **Rangement Obsidian** : SettingsPanel regroupe les notes par dossier
  (`groupNotes`, `vaultSummary` dans organize.ts).
- **ModelPicker** : badges « gratuit » / `formatPrice()` (USD/Mtok) + ctx k ;
  le modèle courant reste listé même hors catalogue (recherche « codex » →
  gpt-5.1-codex dans les 460 modèles OpenRouter).
- **Connecteurs intégrés** : `BUILTIN_CONNECTORS` (store.ts) = 5 — workspace,
  deck, horloge, **web** (`local://web`, historique/favoris/cache via
  `~/.chatdeck/web.local.json`) et **browser-use** (`local://mcp`, serveur MCP
  de `~/.chatdeck/mcp-servers.local.json`).
- **Spawn MCP anti-crash** (sandbox-server.ts) : `child.on('error')` +
  `mcpProcs.delete(name)` — un spawn raté (ex. `npx` ENOENT sous launchd) ne
  fait plus crasher vite. C'est ce qui rendait les e2e instables (9,6 min,
  17→27 tests passés) ; depuis : 33/33 en ~30 s.
- **PROVIDER_IDS** (provider-proxy-server.ts) : la liste des 6 fournisseurs
  intégrés — source unique importée par le mount standalone de `ChatDeckApi`
  (une liste en dur à 4 avait laissé groq/xai sans proxy en app ; verrous
  e2e standalone 12/12). Ajouter un fournisseur = PROVIDERS (llm.ts) + Keys
  (store.ts) + TARGETS (provider-proxy-server.ts) + PROVIDER_TARGETS
  (vite.config.ts) + Labels (SettingsPanel/StatusBar).
- **Tuteur générique** (fiche globale `tuteur.cd`, remplace tuteur-nexus) :
  flashcards une carte/message, verdicts ✅/🟡/❌, persiste `progress.md` dans
  le coffret. Précharge auto : `tutorCardsBlock()` (App.svelte, async) matche
  `quiz|r[eé]vis\w*` et injecte `[CARTES DU COFFRET « X »]` (anki.md/quiz.md,
  tronqué 24k) dans le system via /api/sandbox.
- **Outils StudyVault** : `tools/anki-export.mjs` (<coffret>|`--all <racine>`,
  sources anki.md Q:/R:/T: ou quiz.md), `tools/render-pdf.mjs` (pdfjs-dist→PNG)
  et `tools/ocr-vision.js` (OCR Vision macOS via JXA — zéro compilation,
  remplace un swiftc bloqué). Fiches globales : `ocr-pdf`, `studyvault-anki`.
- **App/install** : build mac **x64-only** (`build.mac.target`), DMG créée à la
  main en UDZO (`docs/hdiutil-contournement.md`) — le DMG-mounter
  d'electron-builder reste bloqué (diskarbitrationd). Les fiches globales
  vivent dans `~/.chatdeck/` : le bundle n'a pas de `.cd/` et « global » a
  priorité. LaunchAgents documentés dans `docs/launchagents.md`.
- **Équipe V5** (fiches `.cd/agents/` + `~/.chatdeck/agents/`) : FullStack
  Lead, DevSec Expert, Web3X Senior, X-Architect — **l'id de fiche est le
  nom de fichier** (espaces compris : « FullStack Lead.cd ») ; délégation
  = agents du fil courant, rôle V5 à préciser dans la mission.
- **Monaco dans FilesPanel** (`MonacoEditor.svelte`) : import dynamique
  (chunk séparé, chargé à l'ouverture d'un fichier), workers `?worker`,
  thème `chatdeck` (variables CSS), repli textarea si échec de chargement
  (`monacoFailed`). Ne pas importer Monaco en statique — +857 kB gzip au
  bundle principal.

## Règles du projet

- **Vérifier avant d'affirmer.** `npm run check` pour les types, `npm test` pour le
  comportement. « Ça devrait marcher » n'est pas une vérification.
- **Le sandbox est sensible.** `sandbox-server.ts` exécute du code non fiable : pas
  de `eval`, pas d'accès réseau libre, toute entrée passe par DOMPurify et par la
  validation de `marked`.
- **Les clés ne quittent jamais la machine.** `keys.local.json` est gitignoré. Ne
  le lis pas pour le recopier, ne l'affiche pas dans une réponse.
- **Changements minimaux.** Une modification = une raison d'être. Pas de refactor
  opportuniste dans le même diff.

## deck — la CLI agent de ChatDeck

`deck` est notre propre agent en ligne de commande (installé sur le PATH, source
dans `bin/deck.mjs`). Il lit les fiches au **format .CD** — Markdown + frontmatter
(`name`, `description`, `kind: skill|agent`, `tools`) — depuis trois endroits, le
projet gagnant en priorité :

1. `promptdeck/library/` — les 636 fiches générées
2. `./.cd/` — fiches du projet courant
3. `~/.chatdeck/` — fiches globales (ex. `reponse-concise.cd` = style de réponse)

```bash
deck doctor              # état clés + bibliothèque
deck search "revue de code"
deck ask "question"      # réponse simple (--provider nvidia|cohere|mistral)
deck run "tâche"         # agent avec outils : read/list/search/bash/write
deck cd --new <nom>      # crée une fiche .CD à remplir dans ./.cd/skills/
```

`deck run` demande confirmation avant chaque `bash`/`write` (jamais hors du
projet). `--yes` saute les confirmations — à réserver aux scripts.

Pour ajouter une méthode permanente : `deck cd --new ma-methode`, remplir la
fiche, elle est utilisée au prochain `deck run`.

## StudyVault

Le dossier `StudyVault/` (si présent) est géré par les skills `tutor-setup` et
`tutor` de la bibliothèque. `tutor-setup` convertit des PDF en notes et appelle
`pdftotext` — un `pdftotext` maison (`tools/pdftotext.mjs`) est déjà sur le PATH,
poppler n'est pas requis.
