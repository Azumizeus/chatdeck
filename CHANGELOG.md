# Changelog

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
