# Changelog

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

## Non publié

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
