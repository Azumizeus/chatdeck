# ⚡ ChatDeck

**Interface de chat LLM légère et fluide** — un onglet de navigateur, zéro process en fond, zéro Docker. Pensée pour une machine sous charge (le contraire d'OpenHands).

![stack](https://img.shields.io/badge/Svelte%205%20%2B%20TypeScript%20%2B%20Vite-ChatDeck-4f8cff)

## Pourquoi

Après avoir coupé OpenHands (conteneur 3,8 GB / 200 % CPU), ChatDeck offre le chat multi-modèles le plus léger possible : un serveur de dev Vite, un onglet, c'est tout.

## Fournisseurs branchés

| Fournisseur | Modèles préconfigurés | Note |
|---|---|---|
| **OpenRouter** | GPT-4.1 mini / GPT-4.1, Claude Sonnet 4, Gemini 2.5 Flash, Llama 3.3 70B | 458 modèles disponibles, recommandé |
| **NVIDIA NIM** | Nemotron 3 Super 120B, Nemotron 3.5 Lightning 30B | lightning parfois saturé (16/16) |
| **Cohere** | Command A, Command R+ | rapide (< 2 s), validé |
| **Mistral** | Mistral Large, Codestral | clé souvent rate-limitée (429) |

## Démarrer

```bash
cd ~/projects/chatdeck
npm install

# Clés optionnelles en dev (préchargées auto dans l'app) — gitignore :
echo '{"openrouter":"sk-or-…","nvidia":"nvapi-…","cohere":"…","mistral":"…"}' > keys.local.json

npm run dev          # http://localhost:5199
```

Les clés peuvent aussi se saisir dans l'app : **⚙︎ Réglages (⌘K)** — test en direct par fournisseur, stockage `localStorage` (jamais envoyées ailleurs qu'au fournisseur choisi, via le proxy Vite).

## Fonctionnalités

- **Streaming SSE** token par token avec curseur animé + **Stop** (abort)
- **Markdown sûr** : marked + DOMPurify (blocs de code, tables, listes)
- **Multi-conversations** persistées (`localStorage`), titre auto, suppression
- **Sélecteurs fournisseur/modèle** par conversation, recharge à chaud
- Réglages : température, tokens max, instructions système
- Copier une réponse en un clic

## Architecture

```
src/
├── App.svelte              # état, streaming, layout
├── lib/
│   ├── llm.ts              # providers OpenAI-compatibles + streamChat()
│   ├── store.ts            # conversations/clés/réglages persistés
│   ├── markdown.ts         # marked + DOMPurify
│   └── components/         # Sidebar, ChatMessage, Composer, SettingsModal
vite.config.ts              # proxy par fournisseur (zéro CORS) + /keys.local (dev only)
```

Le navigateur ne parle **qu'à localhost** : les 4 fournisseurs sont proxifiés par Vite en dev (SSE inclus). En production, faire `npm run build` et servir derrière n'importe quel reverse-proxy équivalent.

## Stack

**Svelte 5** (runes `$state`/`$derived`/`$effect`) + **TypeScript** strict + **Vite 6** + marked/DOMPurify. Aucun framework CSS, aucun state manager externe — ~15 kB de deps au total.

## Onglets frères

- Fiche hub : `~/projects/REPOS.md` → section « ChatDeck »
- Inspirations UX : [abdulmominsakib/localmind](https://github.com/abdulmominsakib/localmind) (mobile) · [NakliTechie/LocalMind](https://github.com/NakliTechie/LocalMind) (web WebGPU)
