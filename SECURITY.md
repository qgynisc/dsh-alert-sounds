# Security Policy

## Reporting a vulnerability

If you find a security issue in `dsh-alert-sounds`, please report it privately rather than opening a public issue.

- Report it via a **private security advisory** — go to this repo's **Security** tab → **Report a vulnerability** (maintainer: [`@qgynisc`](https://github.com/qgynisc)).

This plugin is a fork of `dsh-alert-sound` by [@Machine-126](https://github.com/Machine-126); vulnerabilities inherited from upstream should also be reported upstream (or here — we will pass them on).

## Scope

`dsh-alert-sounds` is a **browser-only client plugin** for the DeepSeek Harness web GUI. It:

- makes **no network requests**, sends nothing to any server, and uses no analytics/telemetry;
- reads session state **in memory only** (session list `running`/`updatedAt`, `uiSession.pendingInteractions` — kind/tool name/reason/question text, the snapshot's `lastAgentError`, and the last assistant reply text **only when read-aloud is enabled**);
- persists only your own settings and uploaded custom sounds in `localStorage` (`dsh-alert-sounds.v1` / `dsh-alert-sounds.custom.v1`);
- plays audio through the browser's own Web Audio and Speech Synthesis APIs.

Relevant risk areas worth reporting: anything that could exfiltrate session content, anything that writes outside its own `localStorage` keys, and any way the bundle could be made to execute code beyond what the DSH module loader hands it (the build only allows `require('react')` and rejects anything else).

## Supported versions

Only the latest published version of `@qgynisc/dsh-alert-sounds` is supported.
