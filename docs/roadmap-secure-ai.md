# Roadmap « Secure AI Multi-OS » — audit et plan d'intégration

> Source : prototypes HTML autonomes dans `Secure AI  Multi-OS/` (V1→V5 + 2
> éditeurs Monaco, non commités). Ce doc compare à ChatDeck 0.4.9 et propose
> un ordre d'intégration. **Les prototypes sont une spec UX, pas du code à
> porter** : ils simulent (terminal fictif, FS en mémoire, agent à réponses
> scriptées) là où ChatDeck exécute réellement (spawn, sandbox disque,
> function calling).

## Audit : ce que ChatDeck a déjà vs les prototypes

| Capacité (prototypes) | État dans ChatDeck 0.4.9 | Verdict |
|---|---|---|
| Sandbox multi-OS (mac/windows/linux, outils par OS) | **Réelle** : espaces disque `<conv>@@mac/windows/linux`, switch sans purge, profil OS écrit/purgé | ChatDeck devant |
| Terminal 20+ commandes | **Réel** : spawn sans shell, liste blanche, sortie streamée, historique | ChatDeck devant (prototypes = simulation) |
| Agent qui écrit du code | **Réel** : write_file/list/read + git_commit dans la sandbox, délégations Nexus⇄Seeker⇄Deck | ChatDeck devant |
| Preview live HTML/CSS/JS (V3 « multiviewer ») | FilesPanel a déjà le preview live | déjà couvert |
| Éditeur de code Monaco (V3.1+ « le vrai moteur ») | **Absent** — FilesPanel = arbre + preview, pas d'édition colorée ni multi-curseur | **GAP principal** |
| Équipe d'agents spécialisés (V5 : FullStack Lead, DevSec Expert, Web3X Senior, X-Architect, 25+ outils) | Mécanisme existe (personas + fiches .CD + délégation), mais les 4 rôles n'existent pas | **GAP facile** (fiches, zéro code) |
| Barre sécurité/métriques temps réel (RAM/CPU/état sandbox) | Santé sandbox dans Réglages (racine, tailles), rien en temps réel | GAP secondaire |
| Palette de commandes VS Code, panel Git, breadcrumbs | ⌘K + historique Git avec diff par commit existent | déjà couvert (façon ChatDeck) |
| Chiffrement AES-256, chroot, réseau virtuel | **Fiction des prototypes** — ChatDeck confine autrement (realpath, liste blanche, pas de réseau libre) | ne pas poursuivre |
| Boot animé, responsive mobile | N/A (app desktop) | ne pas poursuivre |

## Plan d'intégration proposé (ordre de valeur/effort)

### Phase 1 — L'équipe V5 en fiches .CD (zéro code, ~1 lot)
Créer dans `.cd/agents/` (+ copies globales `~/.chatdeck/agents/`) :
`fullstack-lead.cd`, `devsec-expert.cd`, `web3x-senior.cd`, `x-architect.cd`
— frontmatter `name/description/kind: agent/tools`, triggers, et le brief de
rôle tiré des prototypes. La délégation bidirectionnelle existante
(`delegate_to_deck/nexus/seeker`) fait fonctionner l'équipe immédiatement ;
chaque agent garde ses outils sandbox réels.

### Phase 2 — Monaco dans le panneau Fichiers (le gros morceau)
Ajouter `monaco-editor` (npm) monté dans le hub (onglet Fichiers → mode
« Éditeur ») : le FS = les endpoints `/api/sandbox` existants (read/write
via `/file`), pas de FS en mémoire comme les prototypes. Thème custom
vert/cyan repris du prototype 2, multi-onglets, sauvegarde = PUT /file.
Vigilances : bundle size (Monaco ~2 Mo gzip — lazy import), workers Vite
(`?worker`), et ne PAS recréer d'overlay fixed (règle hub, cf. CLAUDE.md).

### Phase 3 — Barre de sécurité sandbox
Pastille/barre live : taille workspace + nb fichiers (poll léger de
`/api/sandbox/status`), commandes refusées (tail du toollog). Données déjà
servies, juste de l'UI.

### Phase 4 — Bouton « Exécuter »
Dans l'éditeur Monaco : bouton play → `run_command` réel dans la sandbox
(node/jj selon l'OS du fil) + sortie dans le terminal docké existant.

### Hors périmètre (assumé)
AES-256/chroot/réseau virtuel (fiction), boot animé, mobile. Le prototype
« agent local scripté » est remplacé par le vrai function calling.

## Suites non-intégrées au repo (rappel)

- `bin/deck.mjs` (CLI deck, 501 lignes) et les fiches `.cd/` sont
  **gitignorés** — un clone du repo ne les reconstruit pas. À committer un
  jour (ou doc « comment les régénérer ») pour que le repo soit complet.
