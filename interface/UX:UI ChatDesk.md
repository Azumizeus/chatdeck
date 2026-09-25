Refonte complète de l'UI/UX de ChatDeck (~/projects/chatdeck) en IDE « geek premium » façon macOS.

CONTEXTE (respecte l'existant, ne réécris pas le backend) : Svelte 5 (runes $state/$derived/$effect), TypeScript strict, Vite 6, marked+DOMPurify. Fichiers : src/App.svelte, src/lib/llm.ts (PROVIDERS, streamChat SSE), src/lib/store.ts (Msg/Conversation/Keys/Settings persistés), src/lib/components/{Sidebar,ChatMessage,Composer,SettingsModal}.svelte, vite.config.ts (proxy par fournisseur + /keys.local en dev), src/app.css (variables). UI et commentaires en français, 2 espaces, zéro `any`, svelte-check = 0 erreur.

1. ESPACE MULTI-FENÊTRES DÉPLOYABLE — panneaux dockables avec splitter H/V, zones de snap (moitié, quarters, plein écran), collapse au double-clic sur la séparation, et « popout » dans une vraie fenêtre secondaire (window.open) synchronisée par BroadcastChannel (layout, conversation active, thème), avec repli en surcouche interne si indisponible. Layout persisté et réinitialisable.

2. ONGLETS + RÉGLAGES — barre d'onglets façon IDE (ouvrir/fermer/réordonner par drag, titre auto, pastille fournisseur, état streaming animé) ; le ⚙︎ devient un panneau dockable au lieu d'une modale.

3. CHÂSSIS MACOS — barre de titre à 3 pastilles (rouge fermer / jaune minimiser / vert plein écran) + bouton « barre des tâches » qui réduit l'app en barre système avec indicateur live (état requête, modèle, coût estimé), restaurable en un clic ; barre déplaçable, double-clic = plein écran.

4. REDIMENSIONNEMENT INTELLIGENT 8 DIRECTIONS — poignées (pointer events, sans lib) sur les 4 bords et 4 coins (N/S/E/O/NE/NO/SE/SO), curseurs appropriés, ghost outline pendant le drag, min/max par panneau, snap aux bords et zones avec animation 150 ms, double-clic = reset.

5. CLÉS MULTI-PROVIDERS — garder les 4 fournisseurs (OpenRouter, NVIDIA NIM, Cohere, Mistral) + fournisseurs personnalisés (nom, base URL OpenAI-compatible, clé, en-tête d'auth) avec bouton « tester la clé » (/models) ; les custom passent par un proxy générique /api/custom/:id à ajouter dans vite.config.ts. Réglages : température, tokens max, instructions système, thème sombre/clair, taille de police, réduction des animations, effacement des données.

6. CATALOGUE OPENROUTER COMPLET — champ texte libre (n'importe quel id) + combobox avec recherche qui fetch GET /api/openrouter/api/v1/models au focus (nom, id, contexte), filtrable et sélectionnable au clavier, mémorisé par conversation, repli sur la liste courte si l'appel échoue.

7. IMPORT/EXPORT & INCOGNITO — export d'une ou toutes les conversations en JSON {version, exportedAt, conversations[]} (téléchargement + copie presse-papiers), import avec validation de schéma, aperçu et confirmation, et mode incognito (conversation jamais persistée, badge 👻, raccourci dédié, option « fusionner dans l'historique »).

8. DESIGN GEEK PREMIUM — thème sombre charbon, bordures hairline 1px, accents dégradé indigo→cyan, typo mono pour les métadonnées, micro-animations 120–180 ms, glassmorphism discret sur barre de titre et barre d'état, barre d'état (fournisseur, modèle, latence, tokens, état du stream), palette ⌘K étendue, icônes SVG inline, respect de prefers-reduced-motion.

CONTRAINTES — zéro Docker, zéro process en fond, tout dans l'onglet ; pas de lib de drag/resize ; ne pas casser le streaming SSE, l'abort/Stop, la persistance existante ni le préchargement des clés dev ; migration localStorage sans perte.

VALIDATION — npx svelte-check = 0 erreur, npm run build passe ; test navigateur sur 2 fournisseurs, streaming, les 8 directions de resize, snap, popout, import/export, incognito, thèmes ; mise à jour du README et de la fiche ~/projects/REPOS.md.