# Contournement du montage DMG bloqué (hdiutil)

## Symptôme (constaté le 2026-09-28, macOS Big Sur, Intel)

`hdiutil attach xxx.dmg` reste suspendu indéfiniment (pas d'erreur, aucun
process résiduel après kill). Idem sur une DMG de 1 Mo → ce n'est pas l'image.
Le Finder ne montre rien et les e2e qui montaient des DMG avant n'en montent
plus.

## Diagnostic éliminatoire

| Piste | Verdict |
|---|---|
| Disque plein | ❌ 16 Gi libres (52 %) |
| Image corrompue | ❌ `attach -nomount` vérifie la DMG et expose /dev/disk3s1 |
| diskarbitrationd mort | ❌ `diskutil list` répond normalement |
| Spotlight (mds) bloqué | ❌ tourne, non responsable |
| **Montage automatique (sélection du point de montage)** | ✅ **coupable** |

Le blocage est **uniquement l'étape d'arbitrage du point de montage** :
diskarbitrationd crée des stubs orphelins dans `/Volumes` (ex. `DJMickDunk 1`,
mode `d--x--x--x`, daté d'hier) au lieu de finaliser le montage. Les volumes
restent « à moitié montés » invisibles.

## Contournement prouvé (instantané)

```bash
mkdir -p /tmp/dmgmnt
hdiutil attach release/ChatDeck-0.4.6.dmg -nobrowse -mountpoint /tmp/dmgmnt
# → monte immédiatement : /tmp/dmgmnt/ChatDeck.app
hdiutil detach disk3   # ou : hdiutil detach /dev/disk3s1
```

L'option `-mountpoint` court-circuite la sélection automatique — la seule
étape cassée. Alternative équivalente : installer l'app **sans monter du
tout** la DMG, directement depuis le bundle produit par electron-builder :

```bash
npm run build && npx electron-builder --mac dmg   # produit release/mac/ChatDeck.app
rm -rf /Applications/ChatDeck.app && cp -R release/mac/ChatDeck.app /Applications/
```

Le bundle `release/mac/` et la DMG ont exactement le même contenu (même run).

## Remèdes à essayer (non testés ici, nécessitent un redémarrage)

1. **Redémarrer la machine** — relance diskarbitrationd proprement (le stub
   `DJMickDunk 1` disparaîtra probablement aussi).
2. Purger les stubs orphelins : vérifier `ls -la@ /Volumes/` après reboot.
3. Si ça persiste après reboot : `sudo launchctl kickstart -k
   system/com.apple.diskarbitrationd` (élévation requise).

## Impact sur ChatDeck

- `npm run dmg` n'est PAS affecté (electron-builder écrit la DMG, il ne la
  monte pas — seuls ses timeouts de build viennent de la machine chargée).
- Seule l'étape « monter la DMG pour installer » était bloquée → contournée
  par `release/mac/` (utilisé pour 0.4.6) ou `-mountpoint`.
