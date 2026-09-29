# Architecture LaunchAgents — ChatDeck et ses services

> Machine : MacBook Pro Intel, macOS 14.8.7. Tous les agents sont **utilisateur**
> (`~/Library/LaunchAgents/`, domaine `gui/$(id -u)`) — ils démarrent au login,
> pas au boot. État vérifié après reboot réel le 2026-09-29 01:31 : 4/4 up.

## Vue d'ensemble

| Service | Label launchd | Port | Rôle |
|---|---|---|---|
| vite (UI dev) | `com.mickael.chatdeck` | :5199 | Serveur SvelteKit/Vite du projet `~/projects/chatdeck` |
| Watchdog vite | `com.mickael.chatdeck-watchdog` | — | Relance vite toutes les 2 min s'il est muet |
| FreeLLMAPI | `com.mickael.freellmapi` | :8000 | 2ᵉ maillon de la cascade (34 providers gratuits) |
| OmniRoute | `com.omniroute.autostart` | :20128 | 1ᵉʳ maillon de la cascade (Docker + conteneur) |
| App ChatDeck | `com.mickael.chatdeck-app` | dynamique | Ouvre `/Applications/ChatDeck.app` (api-server spawné par l'app, port aléatoire) |
| Vérif post-reboot | `com.mickael.chatdeck-postboot` | — | Sonde les 4 services 2 min après login, écrit le bilan |

Agents annexe (hors périmètre ChatDeck, préexistants) :
`com.nexus.omniroute.config-sync`, `com.nexus.omniroute.model-scan`.
Retiré le 2026-09-29 : `com.mickael.chatdeck-dev` (doublon de vite, voir
« Piège du doublon » plus bas).

## Flux au login

```
login
 ├─ com.mickael.chatdeck (KeepAlive)      → node vite.js :5199
 ├─ com.mickael.freellmapi (KeepAlive)    → node server/dist/index.js :8000
 ├─ com.omniroute.autostart               → bash .omniroute/omniroute_autostart.sh
 ├─ com.mickael.chatdeck-app              → open -a /Applications/ChatDeck.app
 │                                          └─ l'app spawn son api-server (port aléatoire, ex. :52929)
 └─ com.mickael.chatdeck-postboot         → sleep 120 → sonde → ~/Library/Logs/chatdeck-postboot.log
        (+ en continu : chatdeck-watchdog toutes les 120 s → sonde :5199 → kickstart si muet)
```

## Les 6 agents en détail

### 1. `com.mickael.chatdeck` — vite :5199 (le propriétaire unique)

`~/Library/LaunchAgents/com.mickael.chatdeck.plist` — **KeepAlive + RunAtLoad**.
ProgramArguments : binaire node **direct** (jamais `npx`, voir pièges) +
`node_modules/vite/bin/vite.js --port 5199 --strictPort`. Logs :
`~/Library/Logs/chatdeck-vite.log`. Depuis 0.4.9, Vite écoute en **IPv4
explicite** (`host: '127.0.0.1'` dans vite.config.ts) :
`curl http://127.0.0.1:5199` répond 200. (Avant : écoute double-pile et ordre
de résolution de `localhost` variable → « Failed to fetch » aléatoires —
raison du fix.)

### 2. `com.mickael.chatdeck-watchdog` — le gardien de vite

`~/tools/chatdeck-watchdog.sh`, **StartInterval 120**. Sonde
`/api/sandbox/mcp-config` sur les deux piles (IPv4 puis IPv6) ; si muet :
`launchctl kickstart -k gui/$(id -u)/com.mickael.chatdeck` (kickstart, pas
nohup : un process spawné par un job launchd meurt avec son groupe). Log :
`~/Library/Logs/chatdeck-watchdog.log` (rotation > 512 Ko). Abandonne après un
échec de relance (pas de boucle infinie) — le KeepAlive de launchd prend le
relais de toute façon.

### 3. `com.mickael.freellmapi` — la 2ᵉ marche de la cascade

`com.mickael.freellmapi.plist` — KeepAlive. Lance
`~/tools/freellmapi/server/dist/index.js` (build tsc du repo
`tashfeenahmed/freellmapi`) avec `PORT=8000` et
`FREEAPI_ENV_PATH=~/tools/freellmapi/.env`. Log :
`~/tools/freellmapi/server/freellm.log` (setup code one-time au boot, traces
[Proxy]). Santé : `curl http://127.0.0.1:8000/` → **404 = vivant** (pas de
route racine) ; chat réel ~10-60 s (modèles gratuits « auto » lents —
comportement attendu, la cascade bascule).

### 4. `com.omniroute.autostart` — la 1ʳᵉ marche de la cascade

`~/.omniroute/omniroute_autostart.sh` (préexistant, modèle des autres).
« Garantit Docker + conteneur OmniRoute (port 20128) ». Santé : `/` → **307 =
vivant** (pas de /health) ; tester un POST /v1/chat/completions pour un vrai
test.

### 5. `com.mickael.chatdeck-app` — l'app packagée

`com.mickael.chatdeck-app.plist` — RunAtLoad, ProgramArguments
`/usr/bin/open -a /Applications/ChatDeck.app`. Simple et fiable : `open` est
idempotent. **Le port de l'api-server change à chaque lancement** (ex. :55863
puis :52929) — ne jamais le coder en dur ; le lire via :

```bash
APID=$(pgrep -f "api-server.mjs --serve" | head -1)
lsof -nP -iTCP -sTCP:LISTEN -a -p "$APID" | tail -1
```

### 6. `com.mickael.chatdeck-postboot` — la preuve que tout est revenu

`~/tools/chatdeck-postboot.sh` — RunAtLoad one-shot : `sleep 120` (laisser tout
monter), sonde vite (:5199, deux piles), freellm (:8000), omniroute (:20128),
process ChatDeck, puis écrit le bilan dans
`~/Library/Logs/chatdeck-postboot.log` :

```
2026-09-29 01:31:07 vite:5199 v4=000 v6=200 (200 attendu)
2026-09-29 01:31:07 freellm:8000 http=404 (404 attendu = serveur vivant)
2026-09-29 01:31:07 omniroute:20128 http=307 (307/200 attendu)
2026-09-29 01:31:07 app ChatDeck: up
2026-09-29 01:31:07 BILAN: 4/4 services up
```

(Log historique, pris avant le fix IPv4 de 0.4.9 : à l'époque vite répondait
en v6 seulement. Depuis, c'est `v4=200` qui est attendu.)

Après un reboot : `cat ~/Library/Logs/chatdeck-postboot.log` — c'est tout.

## Commandes utiles

```bash
launchctl list | grep -Ei "chatdeck|freellm|omniroute"   # état + dernier exit code
launchctl kickstart -k gui/$(id -u)/com.mickael.chatdeck # redémarrer vite
launchctl kickstart -k gui/$(id -u)/com.mickael.freellmapi
launchctl bootout gui/$(id -u)/<label>                   # décharger un agent
launchctl bootstrap gui/$(id -u) <plist>                 # (re)charger un agent
tail -f ~/Library/Logs/chatdeck-postboot.log             # bilan post-reboot
```

Un plist modifié doit être rechargé : `bootout` puis `bootstrap` (ou
`kickstart -k` si seul le process importe).

## Pièges (tous rencontrés)

1. **`npx` sous launchd** : échoue avec « env: node: No such file or
   directory » (PATH minimal) → toujours le binaire node direct
   (`~/.nvm/versions/node/v24.16.0/bin/node`) + env PATH dans le plist.
2. **Doublon vite** : deux agents (`com.mickael.chatdeck` KeepAlive +
   `com.mickael.chatdeck-dev`) se battaient pour :5199 → « reste muet après
   40s » intermittents dans le log watchdog. Un seul propriétaire par port ;
   l'agent retiré est conservé en `.plist.disabled`.
3. **KeepAlive + kickstart manuel** : launchd relance tout seul un process
   KeepAlive tué — inutile de le pkiller hors launchd, sinon double instance.
4. **Port de l'api-server** : aléatoire à chaque lancement de l'app — ne pas
   lire `~/.chatdeck/chatdeck-port.txt` (périmé), utiliser la commande
   `lsof` ci-dessus.
5. **IPv4/IPv6** : depuis 0.4.9 vite écoute `127.0.0.1` uniquement —
   `v4=200` attendu au postboot. Le watchdog et le postboot sondent les deux
   piles, sans danger. (Avant le fix : double-pile, ordre de résolution
   variable → « Failed to fetch » aléatoires.)
6. **freellm lent** : 10-60 s par requête sur les modèles gratuits — pas un
   bug ; la cascade (cascade-server.ts, timeout 60 s) bascule vers le maillon
   suivant si besoin.

## Lien avec la cascade

Ordre du méga-pack : `omniroute → freellm → groq → cerebras → mistral →
cohere → gemini → openrouter → anthropic`. Les deux premiers maillons sont
locaux (LaunchAgents ci-dessus), les suivants sont des APIs cloud sondées par
`cascade-server.ts` (plugins Vite en dev, api-server.mjs en app packagée).
Voir aussi `docs/hdiutil-contournement.md` pour la release.
