# TokenGauge

**English** | [简体中文](README.zh-CN.md) · [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A floating usage dashboard for macOS: multi-account, multi-provider views of AI service usage / quotas / balances.
**Plugin-based provider architecture** - ships with Volcengine Ark built in
(Agent Plan / Coding Plan 5h / 7d / monthly tier progress + reset countdowns; <70% green / 70-89% orange / >=90% red)
plus a DeepSeek balance example plugin out of the box. Any vendor can be added as a plugin.

The Volcengine Ark query logic is ported from [cc-switch](https://github.com/cc-switch/CCSwitch)'s `coding_plan.rs`
(control-plane OpenAPI + Signature V4), with attribution kept in the source header.

Original logic: the Volcengine **control-plane OpenAPI** (`open.volcengineapi.com`) with **Signature V4** (AK/SK), probing `GetAFPUsage`
(Agent Plan) first and falling back to `GetCodingPlanUsage` when unsubscribed. Accounts are queried concurrently
(`Promise.allSettled`).

## Usage

```bash
npm install        # first time
npm start          # launch the dashboard (no Dock icon, tray-resident)
```

- Tray icon: **left click shows the panel, right click opens the menu** (Settings… / Refresh Now / Hide / Quit);
  drag the panel by the three dots at the top
- Add / edit / delete accounts in Settings: pick a provider first, the credential form renders dynamically from its
  declared fields
- UI language switches between **Chinese and English** in Settings (defaults to the system language)
- Config lives at `~/Library/Application Support/TokenGauge/config.json` (0600 permissions)
- Auto refresh every 30s by default (>=5s configurable); a DeepSeek peak/off-peak hours timeline is pinned at the
  bottom of the panel (peak: 9:00-12:00 & 14:00-18:00 Beijing time)

## Provider plugins (contribute query logic)

Usage queries are abstracted behind a Provider contract. Any vendor can be plugged in as a JS file:

```bash
# Plugins directory (reachable via the "Plugins folder" button in Settings)
~/Library/Application Support/TokenGauge/providers/
```

**Contract**: `module.exports = { id, name, fields[], query(credentials) }`
- `id` globally unique; `fields` declares credential fields (Settings renders the form from them)
- `query` returns `{ ok, plan?, tiers: [{ name, utilization(0-100), resetsAt? }], queriedAt }`
- Queries run concurrently; a throw or `ok:false` only affects that account's panel
- See `providers/example.js` for a full template (DeepSeek balance; auto-copied into the plugins dir on first run)

Restart the app after changing a plugin. Plugins run in the main process - only install code you trust
(same trust model as VS Code extensions).

## Packaging & distribution (macOS)

```bash
make dist-arm64      # Apple Silicon dmg (default distribution, ~93MB)
make dist-x64        # Intel dmg
make dist-universal  # both arches in one dmg (twice the size)
```

(or `npm run dist` / `npm run dist:x64`; `make help` lists everything)

- Icons: `node scripts/gen-app-icon.js` regenerates the master, then re-run the icns step (see scripts/)
- **Sharing with friends**: send them the dmg; drag into /Applications. Signed but not notarized, so the first
  open needs **right click -> Open -> Open** (or System Settings -> Privacy & Security -> Open Anyway).
- Packaged and dev builds share `~/Library/Application Support/TokenGauge/` and a single-instance lock, so only one
  can run at a time.

## Development

```bash
make selftest   # deterministic self-tests: Signature V4 / tier parsing / config migration (vectors aligned with cc-switch)
make smoke      # boot smoke test: exits right after the window loads
make build
```
