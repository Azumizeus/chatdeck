# ⚡ ChatDeck

**Client LLM « IDE premium » léger et fluide** — un onglet de navigateur, zéro process en fond, zéro Docker. Pensé pour une machine sous charge.

[![CI](https://github.com/Azumizeus/chatdeck/actions/workflows/ci.yml/badge.svg)](https://github.com/Azumizeus/chatdeck/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-4f8cff.svg)](LICENSE)
![Svelte 5 + TypeScript + Vite 6](https://img.shields.io/badge/Svelte%205%20%2B%20TypeScript%20%2B%20Vite%206-ChatDeck-ff3e00)
![svelte-check](https://img.shields.io/badge/svelte--check-0%20erreur%2C%200%20warning-brightgreen)
![tests](https://img.shields.io/badge/tests-64%20passants-brightgreen)
![bundle](https://img.shields.io/badge/bundle-~72%20kB%20gzip-4f8cff)

## Pourquoi

Après avoir coupé OpenHands (conteneur 3,8 GB / 200 % CPU), ChatDeck offre le chat multi-modèles le plus léger possible : un serveur de dev Vite, un onglet, c'est tout. La refonte « IDE premium » ajoute un châssis macOS, des panneaux dockables/popout, une fenêtre flottante avec snap 8 directions, une barre de tâches et un catalogue complet — toujours sans dépendance UI.

## Fournisseurs

| Fournisseur | Modèles | Note |
|---|---|---|
| **OpenRouter** | **Catalogue complet (~460 modèles) avec recherche**, 5 favoris préconfigurés | recommandé |
| **NVIDIA NIM** | Nemotron 3 Super 120B, Nemotron 3.5 Lightning 30B | lightning parfois saturé |
| **Cohere** | Command A, Command R+ | rapide (< 2 s), validé |
| **Mistral** | Mistral Large, Codestral | clé souvent rate-limitée (429) |
| **⭑ Personnalisés** | n'importe quel endpoint OpenAI-compatible | ajoutés depuis les réglages, proxifiés génériquement |

## Démarrer

```bash
npm install

# Clés optionnelles en dev (préchargées auto) — gitignore :
echo '{"openrouter":"sk-or-…","nvidia":"nvapi-…","cohere":"…","mistral":"…"}' > keys.local.json

npm run dev          # http://localhost:5199
```

Les clés se saisissent aussi dans **⚙︎ Réglages** (⌘K → « Réglages ») : test en direct par fournisseur, stockage `localStorage`, jamais envoyées ailleurs qu'au fournisseur choisi (via le proxy Vite). Fournisseurs custom : `custom-providers.local.json` (gitignore) alimente le proxy générique.

```bash
npm test             # Vitest : store, SSE, coût, snap, recherche (64 tests)
npm run check        # svelte-check (0 erreur, 0 warning)
npm run build        # bundle production (~72 kB gzip)
```

## Fonctionnalités

### Chat
- **Streaming SSE** token par token avec curseur animé + **Stop** (abort)
- **Markdown sûr** : marked + DOMPurify (code, tables, listes)
- Réglages : température, tokens max, instructions système
- Titre auto, copie en un clic, erreurs lisibles (401/429/réseau)

### Espace de travail « IDE premium »
- **Châssis macOS** : 3 pastilles (fermer / réduire / plein écran), barre de titre glassmorphism
- **Onglets de conversations** : ouvrir/fermer/réordonner par drag, pastille fournisseur couleur, indicateur de streaming animé
- **Panneaux dockables** : sidebar et réglages repliables, redimensionnables au splitter (pointer events natifs, double-clic = reset), largeurs persistées
- **Popouts** : conversation ou réglages sortis en vraie fenêtre (`window.open`), synchronisés via **BroadcastChannel** (état, géométrie mémorisée, envoi depuis le popout)
- **Fenêtre flottante** : drag par la barre de titre, redimensionnement 8 directions (poignées exclusives bords + coins), snap aux zones — 4 quarters, 4 moitiés, plein écran — avec ghost outline animé 150 ms, cycle de zone quand le pointeur s'enfonce, géométrie persistée
- **Barre de tâches (pill)** : bouton jaune du châssis (ou ⌘K) réduit ChatDeck en pastille compacte avec état live du stream (point pulsant, tokens), restaurable en un clic
- **Barre d'état** : fournisseur, modèle, latence, **tokens réels** (usage renvoyé par l'API quand disponible, estimation sinon) et **coût estimé par conversation** (tarifs du catalogue OpenRouter, repli indicatif)
- **Palette de commandes ⌘K** : toutes les actions au clavier, dont snap zone suivante (⌘⌥S)
- **Barre d'outils permanente** : Agents · Duel · Fichiers · Terminal · Chercher · Réglages, présente dans tous les modes (docké, duel, flottant), états actifs surlignés

### Agents & sandbox (Nexus & Seeker)
- **Nexus** 🧠, super agent orchestrateur multidisciplinaire : il écrit le brief dans `NOTES.md`, crée les fichiers, délègue à **Seeker** 🔎 (exploratrice : recherche, analyse) puis conclut d'après son rapport — délégation multi-agents dans le même fil
- **Function calling réel** (OpenAI-compatible) : `list_tree`, `read_file`, `write_file`, `run_command`, `delegate_to_seeker`, `report_to_nexus` ; rounds d'outils plafonnés avec rappel de conclusion
- **Sandbox disque par conversation** : `~/.chatdeck/workspaces/<conv-id>/` créée au premier message du fil (README, NOTES, src/, package.json) via les endpoints `/api/sandbox` du serveur Vite — chemins confinés (anti path-traversal), tailles plafonnées, commandes agents en liste blanche
- **Terminal intégré** ⌨︎ : exécution réelle dans le workspace — `node`, `npm`, `npx`, `git`, `ls`, `cat`… — spawn sans shell, timeout 60 s, sortie streamée, historique ↑/↓
- **Panneau Fichiers** 📁 : explorer la sandbox, éditer, créer, supprimer
- **Santé sandbox** dans les réglages : racine, nombre de workspaces, tailles, suppression unitaire ou générale

### Mode duel
- **Deux conversations côte à côte** (⚔︎ dans la barre d'outils ou ⌘K) avec splitter redimensionnable (20–80 %, double-clic = 50)
- **Streaming concurrent** : chaque conversation stream indépendamment (Stop par colonne) ; bouton **⇉** envoie le même message aux deux — idéal pour comparer deux modèles

### Recherche globale ⌘⇧F
- Cherche dans **tous les messages de toutes les conversations**, insensible à la casse
- Extraits avec **surlignage** de la correspondance, badge agent/fournisseur ; clic = ouverture du fil, **saut au message** avec flash visuel

### Modèles
- **Catalogue OpenRouter complet** : combobox avec recherche (nom, id, contexte), navigation clavier, saisie libre de n'importe quel id, cache 10 min, repli sur la liste courte
- **Fournisseurs personnalisés** : nom, base URL, en-tête d'auth, clé, models en CSV, bouton « tester »

### Vie privée & données
- **Mode incognito 👻** (⌘⇧N) : conversation éphémère jamais écrite dans `localStorage` (id en `sessionStorage`, fin de session = fin des 👻), badge visible, **fusion manuelle** dans l'historique
- **Export** JSON (`{version, exportedAt, conversations[]}`) : conversation courante ou tout
- **Import** validé (schéma + sanitize), dédouillonné par id
- Thème **sombre / clair / auto**, taille de police, réduction des animations (respecte aussi `prefers-reduced-motion`)

## Raccourcis

| Raccourci | Action |
|---|---|
| `⌘K` | Palette de commandes |
| `⌘N` / `⌘⇧N` | Nouvelle conversation / incognito 👻 |
| `⌘W` | Fermer l'onglet courant |
| `⌘E` | Exporter la conversation |
| `⌘I` | Importer un JSON |
| `⌘\` | Toggle panneau latéral |
| `⌘⌥F` | Popout de la conversation |
| `⌘⌥S` | Snap : zone suivante (quarter → moitié → plein écran) |
| `⌘⇧F` | Recherche globale dans toutes les conversations |
| `Échap` | Fermer palette / recherche / annuler |

## Architecture

```
src/
├── App.svelte                    # orchestrateur : état, streaming, modes fenêtre, raccourcis
├── main.ts                       # dispatch app principale / popout (#popout=…)
└── lib/
    ├── llm.ts                    # fournisseurs + streamChat SSE (tool-calling inclus) + catalogue + tarifs
    ├── agents.ts                 # personas Nexus/Seeker, outils function calling, exécution sandbox
    ├── search.ts                 # recherche globale (extraits, plafonnement)
    ├── cost.ts                   # usage API + coût estimé par conversation (tarifs ou repli)
    ├── float.svelte.ts           # moteur flottant : zones de snap (quarters/moitiés/plein écran), resize 8 dirs
    ├── store.ts                  # conversations/clés/réglages/layout/customs persistés
    ├── layout.svelte.ts          # LayoutManager : panneaux, popouts, mode fenêtre, duel, BroadcastChannel
    └── components/
        ├── WindowFrame.svelte    # châssis macOS (3 pastilles)
        ├── Toolbar.svelte        # barre d'outils permanente (agents, duel, fichiers, terminal…)
        ├── FloatingWindow.svelte # fenêtre flottante : drag, resize 8 dirs, snap + ghost 150 ms
        ├── TaskbarPill.svelte    # pastille barre de tâches (état live, restaurable)
        ├── TabBar.svelte         # onglets réordonnables
        ├── Sidebar.svelte        # historique + import/export + incognito
        ├── Composer.svelte       # saisie + sélecteurs fournisseur/modèle/agents + envoi duel ⇉
        ├── ModelPicker.svelte    # combobox catalogue (~460 modèles)
        ├── SettingsPanel.svelte  # réglages dockable (clés, customs, apparence, santé sandbox)
        ├── FilesPanel.svelte     # explorateur de la sandbox par conversation
        ├── TerminalPanel.svelte  # terminal réel du workspace (spawn borné, sortie streamée)
        ├── SearchPanel.svelte    # recherche globale ⌘⇧F
        ├── StatusBar.svelte      # fournisseur, latence, tokens réels, coût estimé
        ├── CommandPalette.svelte # palette ⌘K
        ├── ChatMessage.svelte    # bulle markdown sûre + badges agents
        └── Popout.svelte         # fenêtre secondaire synchronisée
sandbox-server.ts                # sandbox disque : bootstrap/arbre/fichiers/exec/terminal (dev)
vite.config.ts                    # proxies par fournisseur + /api/custom/:id + /keys.local (dev)
```

Le navigateur ne parle **qu'à localhost** : fournisseurs intégrés proxifiés par Vite (SSE inclus), fournisseurs custom relayés par le proxy générique vers leur base URL. En production : `npm run build` + reverse-proxy équivalent.

## Stack

**Svelte 5** (runes `$state`/`$derived`/`$effect`, `$props()`), **TypeScript strict** (zéro `any`), **Vite 6**, marked/DOMPurify. Aucun framework CSS, aucun state manager externe, aucune lib de drag/resize (pointer events natifs). **~72 kB gzip** au total.

## Tests

- `src/lib/store.test.ts` — persistance, migration défensive, incognito exclu du stockage, import/export
- `src/lib/llm.test.ts` — parser SSE (deltas, `[DONE]`, fragments coupés, erreurs HTTP/SSE, abort), registre fournisseurs
- `src/lib/cost.test.ts` — usage réel vs estimé, tarifs catalogue vs repli, formatage des coûts
- `src/lib/float.test.ts` — resize 8 directions (minima, viewport), zones de snap, cycle, enfoncement
- `src/lib/search.test.ts` — extraits, casse, plafonnement par conversation, agents

## Onglets frères

- Fiche hub : `~/projects/REPOS.md` → section « ChatDeck »
- Prompt de refonte d'origine : `PROMPT-IDEAL-UI.md`
