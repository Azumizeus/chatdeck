# ChatDeck — prompt de refonte UI/UX « IDE premium macOS »

> Prompt prêt à copier, rédigé à partir du code réel de `~/projects/chatdeck`.
> Utilisation : ouvre une nouvelle session Freebuff/Codebuff **dans `~/projects/chatdeck`** et colle le bloc ci-dessous.

---

## Prompt

```text
Refonte complète de l'UI/UX de ChatDeck (~/projects/chatdeck) en IDE « geek premium » façon macOS : espace multi-fenêtres déployable, châssis à 3 boutons, redimensionnement intelligent 8 directions, catalogue OpenRouter complet, import/export JSON et mode incognito.

CONTEXTE TECHNIQUE (respecte l'existant, ne réécris pas le backend)
- Stack : Svelte 5 (runes $state/$derived/$effect), TypeScript strict, Vite 6, marked + DOMPurify. Pas de framework CSS, pas de state manager externe.
- Fichiers : src/App.svelte (état global, streaming, layout), src/lib/llm.ts (PROVIDERS, streamChat SSE, providerOf, findModel), src/lib/store.ts (Msg, Conversation, Keys, Settings, load/save/newConversation), src/lib/components/{Sidebar,ChatMessage,Composer,SettingsModal}.svelte, vite.config.ts (proxy par fournisseur + endpoint dev /keys.local), src/app.css (variables CSS : --bg, --panel, --border, --accent…).
- Conventions : UI et commentaires en français, 2 espaces, aucun `any`, `npx svelte-check` doit rester à 0 erreur.

FONCTIONNALITÉS

1. Espace multi-fenêtres déployable
- Un modèle de panneaux dockables : splitter horizontal/vertical, redimensionnables, avec zones de snap (moitié, quarters, plein écran) et-collapse par double-clic sur la séparation.
- Chaque panneau peut être « popé » dans une vraie fenêtre secondaire (window.open) et rester synchronisé via BroadcastChannel (layout, conversation active, thème). Si le popout est indisponible, le panneau revient en surcouche interne sans casser l'état.
- Layout persisté dans localStorage, restitué au chargement, réinitialisable depuis les réglages.

2. Onglets + réglages
- Barre d'onglets de conversations (style IDE/navigateur) : ouvrir/fermer/réordonner par drag, titre auto depuis le 1er message, pastille du fournisseur, état streaming animé.
- Bouton ⚙︎ toujours visible qui ouvre le panneau de réglages (aujourd'hui une modale) : il devient un panneau dockable.

3. Châssis macOS
- Barre de titre factice : 3 pastilles rouge/jaune/vert (fermer, minimiser, plein écran) + bouton « envoyer vers la barre des tâches » qui réduit l'app en barre système avec un indicateur live (état de la requête, modèle courant, coût estimé si dispo), restaurable en un clic.
- La barre est déplaçable (drag) et double-clic = plein écran.

4. Redimensionnement intelligent 8 directions
- Poignées invisibles mais mutuellement exclusives sur les 4 bords et 4 coins (N, S, E, O, NE, NO, SE, SO), curseurs appropriés, ghost outline pendant le drag, min/max par panneau, snap aux bords de la fenêtre et aux zones (gauche/droite/haut/bas/moitiés/quarters) avec animation 150 ms, double-clic sur un bord = reset.

5. Réglages & clés multi-providers
- Clés pour n'importe quel provider : conserver les 4 fournisseurs existants (OpenRouter, NVIDIA NIM, Cohere, Mistral) et ajouter des fournisseurs personnalisés (nom, base URL OpenAI-compatible, clé, entête d'auth) avec bouton « tester la clé » qui appelle /models.
- La liste des fournisseurs devient dynamique (PROVIDERS + customs) sans casser le proxy Vite : les providers custom passent par un proxy générique /api/custom/:id, à ajouter dans vite.config.ts.
- Réglages : température, tokens max, instructions système, thème sombre/clair, taille de police, réduction des animations, effacement des données.

6. Catalogue OpenRouter complet
- Remplacer la liste figée de 5 modèles par : champ texte libre (n'importe quel id de modèle) + combobox avec recherche.
- Au focus, fetch GET /api/openrouter/api/v1/models (proxifié) et affiche la liste filtrable (nom, id, contexte si dispo), triée, avec sélection au clavier et modèle choisi mémorisé par conversation. Repli sur la liste courte si l'appel échoue.

7. Import/export & incognito
- Export : une conversation ou toutes → fichier JSON {version, exportedAt, conversations[]} téléchargé.
- Import : lecture d'un JSON (validation de schéma, aperçu du nombre de conversations, import en confirmation), avec un bouton de copie dans le presse-papiers pour l'export.
- Mode incognito : conversation éphémère (jamais écrite dans localStorage, badge 👻 persistant,Shortcut ⌘⇧N), avec option « fusionner dans l'historique » en fin de session.

8. Design « geek premium »
- Thème sombre par défaut, fond charbon profond, bordures hairline 1px, accents dégradé indigo→cyan, typo mono pour les métadonnées, micro-animations 120–180 ms, glassmorphism discret sur la barre de titre et la barre d'état.
- Barre d'état en bas : fournisseur, modèle, latence, tokens entrants/sortants, état du stream.
- Palette de commandes ⌘K étendue (nouvelle conversation, bascule de thème, popout, import/export, changement de modèle).
- Zéro image externe, icônes SVG inline, respect de prefers-reduced-motion.

CONTRAINTES
- Zéro process en fond, zéro Docker : tout reste dans l'onglet.
- Déps minimales (pas de lib de drag/resize : implémente le resizing en pointer events) ; garde le bundle léger.
- Ne casse pas : le streaming SSE, l'abort/Stop, la persistance des conversations existantes, le préchargement des clés dev via /keys.local.
- Migre les données existantes (localStorage) sans perte.

VALIDATION
- npx svelte-check = 0 erreur ; npm run build passe.
- Teste dans le navigateur : 2 fournisseurs, streaming, redimensionnement sur les 8 directions, snap, popout, import/export, incognito, thème clair/sombre.
- Mets à jour README.md (usage, raccourcis, architecture) et la fiche ChatDeck dans ~/projects/REPOS.md.
```

---

## Raccourcis proposés

| Raccourci | Action |
|---|---|
| `⌘K` | Palette de commandes |
| `⌘N` / `⌘⇧N` | Nouvelle conversation / nouvelle conversation incognito |
| `⌘T` | Ouvrir un onglet de conversation |
| `⌘W` | Fermer l'onglet courant |
| `⌘E` | Exporter la conversation |
| `⌘I` | Importer un JSON |
| `⌘\` | Toggle panneau latéral |
| `⌘⌥F` | Popout de la conversation courante |
| `Échap` | Fermer modale / annuler le drag |
