# StudyVault — coffrets de révision, tuteur et export Anki

> Le parcours complet : PDF scanné → texte → coffret de révision → session
> tuteur → cartes Anki. Tout vit dans la sandbox ChatDeck (aucun service
> externe). Détail serveur : [architecture.md](architecture.md).

## Le coffret

Un coffret = un dossier `StudyVault/<nom>/` dans un workspace sandbox
(ex. `~/.chatdeck/workspaces/p-<id>/StudyVault/nexus/`) :

| Fichier | Rôle |
|---|---|
| `README.md` | présentation du coffret |
| `notes.md` | notes de cours (issues du PDF via tutor-setup/OCR) |
| `quiz.md` | quiz numéroté + section « Réponses » |
| `anki.md` | **source canonique des cartes** (Q:/R:/T:) |
| `anki-<nom>.txt` | export TSV Anki (régénérable, jamais édité à la main) |
| `progress.md` | progression du tuteur (cartes vues, verdicts, reprise) |

## Créer un coffret

1. **PDF texte** : le `pdftotext` maison est déjà sur le PATH
   (`tools/pdftotext.mjs`, interface poppler, poppler n'est pas requis) — les
   skills `tutor-setup`/`tutor` de la bibliothèque s'en servent.
2. **PDF scanné** : OCR local macOS — `tools/render-pdf.mjs` (pdfjs-dist →
   PNG) puis `tools/ocr-vision.js` (Vision macOS via **JXA**, zéro
   compilation ; swiftc bloqué sur cette machine). Fiche skill : `ocr-pdf`
   (~/.chatdeck/).
3. Demander à l'agent (fiche `tutor-setup`) de générer notes + quiz + anki.md
   dans le coffret.

## Réviser avec le tuteur (fiche globale `tuteur.cd`)

- Activer la fiche **tuteur** (DeckPanel ou pastille 🃏 du composer) puis
  écrire « quiz » ou « révise <coffret> » dans le message.
- **Précharge auto** (`tutorCardsBlock()` dans App.svelte) : le message
  matche `quiz|révis*` → le système injecte `[CARTES DU COFFRET « X »]`
  (anki.md ou quiz.md du coffret, tronqué 24k) dans le prompt. Le tuteur
  démarre même sans outil read.
- Session : **une carte par message**, verdicts ✅/🟡/❌, score courant,
  progression écrite dans `progress.md` (reprise là où on s'est arrêté).
- Fonctionne avec n'importe quel fournisseur (cascade incluse — testé en
  réel avec bascule omniroute→freellm en pleine session).

## Exporter vers Anki

```bash
node tools/anki-export.mjs <chemin/du/coffret>          # un coffret
node tools/anki-export.mjs <racine> --all               # tous les coffrets
node tools/anki-export.mjs <coffret> -o custom.txt      # autre sortie
```

- Sources (dans l'ordre) : `anki.md` (blocs `Q:` / `R:` / `T:` séparés par
  une ligne vide) sinon `quiz.md` (2 formats : réponses inline
  `### Q1 (réponse: X)` ou questions numérotées + section « Réponses »).
- Sortie : TSV avec en-têtes natifs Anki 23.10+ (`#separator:tab`,
  `#html:false`, `#tags column:3`), tags par défaut `studyvault`.
- Import dans Anki : Fichier → Importer, type « Notes ».

## Fiches .CD du parcours

| Fiche | Type | Où |
|---|---|---|
| `tuteur` | agent | `~/.chatdeck/` (globale) — générique, tout coffret |
| `ocr-pdf` | skill | `~/.chatdeck/` |
| `studyvault-anki` | skill | `~/.chatdeck/` |
| `tutor-setup`, `tutor` | skills | bibliothèque `promptdeck/` (embarquée) |

Les fiches globales vivent dans `~/.chatdeck/` car le bundle app n'a pas de
`.cd/` et la source « global » a priorité dans le scan deck.
