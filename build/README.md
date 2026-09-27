# build/

Ressources de packaging Electron (electron-builder lit `buildResources: "build"`).

- `icon.png` — icône éclair ⚡ 512×512, générée par `node tools/gen-icon.mjs`
  (PNG encodé à la main, aucune dépendance). **Versionnée** (les autres non).
- `icon.iconset/` — les 10 tailles pour `iconutil` (`npm run icons`).
- `icon.icns` — icône macOS, produit de `iconutil -c icns build/icon.iconset`.

`npm run dmg` embarque `icon.icns` dans ChatDeck.app (Dock + DMG).
