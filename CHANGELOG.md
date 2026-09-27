# Changelog

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
