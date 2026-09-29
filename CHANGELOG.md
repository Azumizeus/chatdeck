# Changelog

## 0.4.9

### Corrigé
- **« OpenRouter : réponse vide (modèle saturé ?) » en app packagée** : le
  proxy des fournisseurs intégrés (`/api/openrouter`…) n'existait que dans
  `server.proxy` de Vite — l'api-server autonome de l'app renvoyait le
  fallback SPA (index HTML, HTTP 200), lu comme du SSE sans `data:`. Nouveau
  `provider-proxy-server.ts` partagé : plugin Vite (remplace `server.proxy`,
  doublon retiré) + `providerProxyMount` dans `ChatDeckApi`. Verrous e2e :
  le POST ne doit jamais renvoyer le fallback SPA (7/7 standalone).
- **« Failed to fetch » aléatoires** : Vite écoutait sur les deux piles et
  `localhost` se résolvait dans un ordre variable — `host: '127.0.0.1'`
  explicite dans vite.config.ts.
- **Groq/xAI sans proxy en app packagée** : le mount standalone de
  `ChatDeckApi` listait 4 fournisseurs en dur — les POST `/api/groq/…` et
  `/api/xai/…` retombaient sur le fallback SPA (« réponse vide », même bug
  que celui corrigé pour openrouter). Fix : liste unique `PROVIDER_IDS`
  (provider-proxy-server.ts) importée par le mount ; verrous e2e étendus
  aux 6 fournisseurs (standalone 12/12).
- **Crash vite si un spawn MCP échoue** : `spawn npx` ENOENT sous launchd
  levait un `error` non géré → série e2e instable (9,6 min, 17→27 tests).
  Handler `child.on('error')` + retrait du process mort — e2e **33/33 en
  ~30 s**.

### Ajouté
- **Tuteur générique** (fiche agent `tuteur.cd`) : révision flashcards de
  n'importe quel coffret StudyVault — une carte par message, verdicts
  ✅/🟡/❌, score courant, reprise via `progress.md`.
- **Précharge auto des cartes du coffret** : « quiz nexus » / « révise
  <coffret> » injecte `anki.md`/`quiz.md` de la sandbox dans le system
  (`[CARTES DU COFFRET]`) — le tuteur démarre sans outil read.
- **`tools/anki-export.mjs`** : export Anki TSV d'un coffret (source
  `anki.md` ou `quiz.md`) — un coffret ou `--all` ; en-têtes natifs Anki
  23.10+. Fiche skill `studyvault-anki`.
- **Outils OCR PDF scanné** : `tools/render-pdf.mjs` (pdfjs-dist) +
  `tools/ocr-vision.js` (Vision macOS via JXA, zéro compilation) — fiche
  skill `ocr-pdf`.
- **2 nouveaux fournisseurs intégrés : Groq et xAI** (6 au total) — Groq
  (path `/openai/v1` : GPT-OSS 120B/20B, Llama 3.3, Qwen3 ; clé gratuite sur
  console.groq.com) et xAI (path `/v1` : Grok 4, Grok Code Fast). Clés
  optionnelles dans ⚙︎ Réglages ou `keys.local.json`.
- **Badges de prix dans le ModelPicker** : « gratuit » (prompt+completion à
  0 $) sinon USD/Mtok prompt/completion, plus la taille de contexte — et le
  modèle courant reste listé même hors catalogue.
- **Connecteurs intégrés web et browser-use** (5 au total) : **web**
  (historique web_search, favoris, cache des pages fetchées —
  `~/.chatdeck/web.local.json`) et **browser-use** (pilotage navigateur,
  16 outils via le serveur MCP de `~/.chatdeck/mcp-servers.local.json`).

## 0.4.8

### Ajouté
- **Hysteresis NetworkBanner** : 2 échecs CONSÉCUTIFS de la sonde proxy avant
  d'afficher « Réseau injoignable » — une micro-coupure ou une sonde isolée ne
  fait plus clignoter l'UI (l'event `offline` navigateur force l'affichage,
  lui, est fiable).
- **LaunchAgents** : `com.mickael.freellmapi` (serveur :8000, KeepAlive) et
  `com.mickael.chatdeck-dev` (vite :5199 au reboot) — comme omniroute.
- **Fiche `.cd/skills/lancer-studyvault.cd`** : procédure locale StudyVault /
  tutor / tutor-setup (deck_load, pdftotext, coffret Obsidian, quiz).

### Corrigé
- **freellm de retour dans la cascade** : FreeLLMAPI V13 (installée dans
  `~/tools/freellmapi`) exige une clé unifiée — `needsKey: true` + résolution
  auth.json (alignée sur la clé du dashboard, jamais affichée) ; timeout
  d'appel 30 s → 60 s (les modèles « auto » gratuits routent vers des
  backends lents). Prouvé : `auto` → kilo-auto répond en ~10-14 s.

## 0.4.7

### Ajouté
- **web_search : l'agent accède enfin au web sans URL** — nouvel outil
  (DuckDuckGo Lite parsé en DOM, passé par les mêmes bornes que web_fetch :
  http(s), pas de localhost, timeout, taille plafonnée) qui renvoie les 10
  premiers résultats (titre + URL + extrait). web_fetch reste pour lire une
  page précise. Prompt système durci : ne JAMAIS répondre « je n'ai pas de
  navigateur » ni « donne-moi une URL » — chercher directement.
- **Fiche agent AEGIS-7** (`.cd/agents/aegis-7.cd`) : le persona improvisé
  par le modèle devient officiel — 7 rôles, triggers, méthodes et la règle
  d'or « utilise web_search/web_fetch au lieu de promettre ».

## 0.4.10

### Corrigé
- **Recherche ModelPicker qui « ne trouvait rien »** : dans la liste déroulante
  (197 px), le bloc `.meta` (badge prix + ctx, inflexible) écrasait l'id du
  modèle — réduit à 0 px, la recherche « sonnet » n'affichait aucun des 10
  résultats existants. `.meta` devient rétrécissable (ellipsis), `.id` prend
  l'espace restant ; vérifié en live (ids 72-156 px, « sonnet » → 5 modèles).
- **Faux « Réseau injoignable »** : la sonde proxy comptait un chargement
  lent (> 6 s, vite saturé) comme une panne — `net.svelte.ts` distingue
  désormais « lent mais up » (> 6 s) d'un vrai down (timeout 8 s) ;
  l'hystérésis 2 échecs consécutifs reste en place.
- **Focus clavier invisible** : aucun contour n'était rendu sur la navigation
  Tab — `:focus-visible` global (2 px, `var(--accent)`) dans app.css, avec
  variantes button/[role=tab]/[role=option]. Vérifié en e2e (outline 2 px
  visible après Tab).
- **Accessibilité du fil et des contrôles** : `.messages` en `role="log"`
  + `aria-live="polite"` (vue principale et duel) — les lecteurs d'écran
  annoncent les réponses ; aria-labels ajoutés (Envoyer/Stop/⇉ du composer,
  fermeture d'onglet nommée, ＋, suppression de conversation avec son titre,
  combobox ARIA complète sur le picker : role/aria-expanded/aria-controls/
  aria-label + listbox id).
- **Cibles tactiles < 24 px** : fermeture d'onglet (16 px), ＋ et `.del` de
  la sidebar (21×20) portés à ≥ 24 px (hit area, visuel inchangé).
- **Barre d'état** : séparateur ajouté entre le bouton ⚡cascade et les
  pastilles fournisseurs (elles étaient collées, lues comme un seul bloc).
- **Comptes de modèles codés en dur** : placeholder « (458 modèles) » du
  picker retiré (« tape pour chercher »), doc llm.ts alignée sur
  « ~460 modèles » — le vrai catalogue OpenRouter est dynamique (460 au
  29/09, 20 gratuits).
- **Tests deck e2e en timeout sous charge** : `GET /api/deck/cards` relisait
  ~640 fichiers à chaque appel (1-3 s à froid, > 30 s sous forte charge
  machine — les 3 tests deck échouaient systématiquement). Cache de la
  liste invalidé par mtime des dossiers de fiches + invalidation explicite
  après création/édition + `?fresh=1` (bouton ⟳ du panneau). Mesuré :
  cold 0,99 s → warm 4 ms ; suite e2e complète **33/33**. (sandbox-server.ts,
  DeckPanel)

### Ajouté
- **Hint « mode agents » dans le composer** : taper « tu es Nexus », « tes
  outils »… en chat simple affiche une astuce discrète (le modèle n'a ni
  persona ni outils dans ce mode, par design) avec activation directe
  « 🧠 Nexus + 🔎 Seeker » en un clic — dismissible. (Composer)
- **Barre sécurité sandbox temps réel** (phase 3 de `docs/roadmap-secure-ai.md`)
  : 🔒 taille + nb de fichiers du workspace ouvert, dans le panneau Fichiers
  ET la barre d'état — poll léger 10 s de `/api/sandbox/status` (données
  déjà servies, zéro endpoint nouveau). (FilesPanel, StatusBar, App)
- **Bouton ▶ Exécuter dans l'éditeur** (phase 4) : en-tête de l'éditeur
  Monaco/textarea du panneau Fichiers — sauvegarde le fichier ouvert s'il
  est sale, exécute via l'endpoint du terminal réel (liste blanche node/npm/
  git…, timeout 60 s, cwd workspace), affiche la sortie dans un drawer avec
  commande éditable et journalise dans le toollog du fil. (FilesPanel,
  MonacoEditor inchangé)
- **Équipe V5 « Secure AI » en fiches agents** (phase 1 de
  `docs/roadmap-secure-ai.md`) : FullStack Lead, DevSec Expert, Web3X
  Senior et X-Architect — rôles et méthodes tirés des prototypes
  (`Secure AI  Multi-OS/`), outils réels de la sandbox. Fiches dans
  `.cd/agents/` + copies globales `~/.chatdeck/agents/`. Délégation testée
  en réel via la cascade : mission « en tant que DevSec Expert : audite… »
  → injection SQL détectée (sévérité, preuve, correctif paramétré).
- **Monaco Editor dans le panneau Fichiers** (phase 2) : le vrai moteur
  VS Code — coloration par langage, minimap, sticky scroll, bracket
  pairing. Import **dynamique** (chunk séparé, ~857 kB gzip, chargé
  uniquement à l'ouverture d'un fichier), workers via `?worker` de Vite,
  thème `chatdeck` dérivé des variables de l'app, models par URI
  `inmemory://sandbox/<path>`, **repli textarea** si Monaco échoue
  (`monacoFailed`). Cœur de l'app : ~122 kB gzip (Monaco exclu).
### Ajouté
- **Sortie du duel visible dans les colonnes** : le bouton ⚔️ Duel (rendu
  « Quitter le duel » une fois en duel) est réaffiché dans les mini-toolbars
  perConv — depuis 0.4.6 les colonnes n'offraient que Agents/Fichiers/Terminal
  et on ne pouvait plus rebasculer vers la vue agent qu'en cherchant la
  verdictbar. Entrée/sortie désormais possibles depuis n'importe quelle colonne.
- **E2e verrou serveur autonome** (`e2e/standalone-api.spec.ts`, 5 tests) :
  bundle le VRAI sandbox-server.ts comme `build:api`, boot le serveur autonome
  et exige du JSON sur /health, /api/cascade-check, /api/cascade (gagnant ou
  502), 404 et /api/sandbox + /api/deck — le bug packagé « Unexpected token
  '<' » ne peut plus revenir.

### Documenté
- `docs/hdiutil-contournement.md` : diagnostic du montage DMG bloqué (étape
  diskarbitrationd uniquement — `attach -nomount` OK, `diskutil` OK) et le
  contournement prouvé `-mountpoint`, plus l'install direct depuis
  `release/mac/`.

## 0.4.6

### Corrigé
- **Cascade morte dans l'app packagée (« Unexpected token '<', '<!doctype' »)** :
  les endpoints `/api/cascade*` n'existaient QUE dans le plugin Vite (dev) — en
  packagé, le serveur autonome répondait le fallback SPA (index.html) et le
  panneau Cascade échouait au JSON.parse. Refactor : `cascadeApiMount` partagé
  (plugin Vite + serveur autonome), monté dans ChatDeckApi à côté de
  sandbox/deck ; la résolution de clés lit aussi `~/.chatdeck/keys.local.json`
  (le dossier projet n'existe pas en packagé). Prouvé en autonome : santé 9
  providers + test réel (cohere gagnant après 5 bascules).
- **Fenêtre flottante / snap / pill désactivés en Electron** : la fenêtre OS
  fournit déjà châssis, déplacement et redimensionnement — ces modes (et leurs
  doubles encadrements potentiels) n'ont de sens qu'en navigateur, où ils
  restent intacts. Guards à la source (layout.setAppMode, floatWith, cycleSnap,
  togglePill, ⌘⌥S) + commandes de palette filtrées en Electron.

## 0.4.5

### Corrigé
- **Double encadrement en fenêtre flottante (app de bureau)** : FloatingWindow
  dessinait son faux châssis macOS (pastilles + barre « ChatDeck — IDE premium »)
  PAR-DESSUS la fenêtre native Electron hiddenInset — le correctif 0.4.3 ne
  couvrait que le mode docké (WindowFrame). En Electron : plus de faux châssis
  (espace de drag natif), la vue flottante remplit la fenêtre OS, poignées de
  resize et bordure/ombre maison retirées (c'est la fenêtre OS qui le fournit).
  Le châssis complet reste en navigateur (snap, poignées, pastilles maison).

## 0.4.4

### Corrigé
- **Onglets du hub invisibles** : la nav du hub défilait (7 onglets > largeur)
  sans jamais révéler l'onglet actif — le hub semblait « désynchronisé » du
  contenu affiché (Réglages ouvert, marque « Terminal »). L'onglet actif est
  maintenant auto-scrollé dans le champ, scrollbar masquée.
- **Clignotement au survol** : les boutons d'action de message et la pill
  barre de tâches se déplaçaient de 1 px au survol — le curseur oscillait
  au bord (rentre/sort en boucle). Le survol ne déplace plus les boutons.
- **Barre d'état tronquée à droite** : « 0.00… », « UT… » — les compteurs
  tokens/coût/UTF-8 gardent leur largeur ; c'est le bloc de gauche (fournisseur
  + modèle) qui cède la place.
- **Bouton « suppr… » tronqué** (Réglages → Sandbox) : libellé complet
  « supprimer », non compressible.
- **Label « x Duel » illisible** : le caractère ⚔︎ (texte) se rendait en « x »
  dans la nav — remplacé par le vrai emoji ⚔️ (comme les autres onglets).

### Ajouté
- **Bannières visibles en mode duel** : NetworkBanner et CleanupBanner (🧹
  nettoyage sandbox) manquaient en duel — le mode court-circuitait le shell
  principal. Les orphelins sont visibles dans les deux colonnes.
- **Menu @fichier explicite** : taper @ avec une sandbox vide ouvrait… rien.
  Le menu affiche maintenant l'état (sandbox vide / agents requis / pas de
  fil agents) au lieu de rester muet — le menu avec fichiers est inchangé.

## 0.4.3

### Corrigé
- **« loadToolLog is not iterable »** : readJson étalait le tableau stocké en
  objet — chaque tour d'agent affichait l'erreur dans le fil. Lecture tableau
  stricte (toollog + projets).
- **Double encadrement en app de bureau** : WindowFrame dessinait sa barre
  titre à 3 pastilles SOUS la barre native Electron (hiddenInset) — supprimée
  dans Electron (détection userAgent), simple espace de drag à la place.
- **Preview en fenêtre volante** : le panneau n'est plus un overlay fixed au
  milieu du chat ; il remplit le hub ou le dock outils (ancrage absolute).
- **Suppression workspace** : DELETE d'une conversation retire maintenant la
  base + les espaces @@mac/windows/linux — plus de dossiers orphelins.

### Ajouté
- **Modèle affiché au-dessus de chaque réponse** (fournisseur + id du modèle).
- **Boutons de message toujours visibles** (opacité 0.45 → 1 au survol) et
  présents aussi sur les messages d'erreur (copier/supprimer utiles).
- **🧹 Nettoyage sandbox** dans Réglages : orphelins (conversations supprimées)
  + workspaces inactifs > 30 jours en un clic — la racine de 158 workspaces
  est retombée à 1 (projet conservé).
- Nouvel endpoint POST /api/sandbox/cleanup {orphans, maxAgeDays}.

## 0.4.2

### Corrigé
- **Le message qui disparaissait avec Entrée** : sans clé API, le texte était
  perdu et les réglages s'ouvraient en silence. Maintenant le message reste
  dans le fil avec une erreur explicite + réglages ouverts pour coller la clé.
- **Double terminal** (hub + dock) : gardes mutuelles entre les trois ancrages
  du terminal (hub, dock outils, sous-composer) — un seul rendu à la fois.

### Ajouté
- **Dock outils à droite** : Fichiers / Terminal / Preview se dockent comme
  Réglages quand le hub est fermé (hub prioritaire s'il est ouvert).
- **Terminal ↑↓ persistant** : historique par conversation (100 dernières),
  brouillon conservé pendant la navigation, Ctrl+C annule la ligne.
- **Hub restauré au lancement** : ouvert/fermé + onglet actif mémorisés.
- **Géométrie par instance** : les fenêtres --multi ont leur propre fichier
  (chatdeck-window-multi.json) — « + instance » n'écrase plus la principale.
- **write_project_file** : l'agent écrit un livrable dans le workspace partagé
  du projet (confirmation systématique, dossiers Mac toujours lecture seule).
- **Connecteurs MCP stdio** : serveurs locaux (~/.chatdeck/mcp-servers.local.json),
  handshake initialize/initialized, appariement JSON-RPC par id, tools listés
  dans le panneau Connecteurs et appelables via connector_call.
- **Fiche .cd/outils/macos-install.cd** (install macOS, testée via deck_load).

## 0.4.1

### Corrigé
- **Écran noir de l'app packagée** : l'app charge désormais l'UI depuis un
  serveur API local (`http://127.0.0.1:<port>`) au lieu de `file://` (chemins
  absolus /assets cassés + aucun endpoint /api + fetch bloqué par CORS).
  Même code de serveur que le dev : `sandbox-server.ts` exposé en bundle ESM
  (`npm run build:api` → `electron/api-server.mjs`), spawné par Electron avec
  son Node embarqué.

### Ajouté
- **Un espace disque par OS** : chaque conversation a ses espaces
  `<conv>@@mac`, `<conv>@@windows`, `<conv>@@linux` côte à côte — switch_os
  bascule instantanément SANS plus rien purger (les fichiers d'un OS sont
  retrouvés intacts après un aller-retour).
- **Outils agents `deck_search` / `deck_load`** : tous les agents peuvent
  chercher dans la bibliothèque PromptDeck (636 fiches, FR/EN) et charger une
  fiche comme méthode — plus besoin d'activer la fiche à la main.
- **Fiche `manuel-chatdeck`** (.cd/skills) : la carte de l'app pour les agents,
  activable dans le DeckPanel.
- **Catégorie « outils »** dans le deck (fiche kind: outil, dossier `.cd/outils/`).
- **Bibliothèque embarquée** dans l'app packagée (asarUnpack promptdeck/).

### UI
- Toolbar réorganisée en 3 groupes (sessions d'agents · espace de travail · app)
  avec séparateurs, `aria-pressed` sur les boutons à états, libellés précisés.

## 0.4.0 — Projets, terminal hub, fenêtre mémorisée

### Projets (inspiré Claude Desktop)
- **Section « Projets » dans la sidebar** : créer un projet, lui donner des
  **règles** (injectées au prompt de chaque conversation liée) et autoriser des
  **dossiers du Mac en lecture** (un chemin par ligne, `~/` accepté).
- **Sandbox par projet** : workspace dédié `~/.chatdeck/workspaces/p-<id>`
  partagé par toutes les conversations du projet (bootstrap auto au premier
  message d'un fil agents).
- **Nouveaux outils agents** : `list_project_tree` (arborescence projet +
  dossiers Mac) et `read_project_file` (lecture du workspace projet puis des
  dossiers autorisés — écriture toujours confinée à la sandbox).
- Sécurité : registre des dossiers sur disque (`~/.chatdeck/projects-folders.local.json`),
  realpath confiné, lecture seule, cap 1 Mo, 20 dossiers max.

### Bureau (Electron)
- **Géométrie de fenêtre persistée** : position/taille réouvertes au lancement,
  re-clampées à l'écran courant (`chatdeck-window.json` dans userData).
- (0.3.x) Icône app ⚡ dans le Dock/DMG, commande « + instance » (palette ⌘K),
  endpoint `POST /api/sandbox/launch-instance`.

### Corrections
- **Terminal flottant qui cachait l'app** : rendu dans le hub, il était resté
  `position: fixed` (classe `.hubbed` manquante) — il vit désormais DANS la
  fenêtre outils, comme les autres panneaux.
- Label « + instance » raccourci dans la palette.

### Tests
- svelte-check 0/0 · vitest 79/79 · e2e 33/33 · DMG arm64+x64.

## 0.3.0 — App de bureau, hub, condenseur

- Packaging DMG (electron-builder, arm64+x64, icône éclair ⚡).
- Multi-instances : single-instance par défaut, `--multi` = partition dédiée.
- Hub amarré à la zone libre (droite/gauche, réduction de l'app au besoin),
  panneaux `.hubbed` (Fichiers, Graphify, Preview, Deck).
- Condenseur de contexte (OpenHands), journal des outils, permissions
  allow/ask/deny (OpenCode), autocomplétion @fichier, mode Plan.
- Hub repliable en bande fine (double-clic sur la barre de titre).
