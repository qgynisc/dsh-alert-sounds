# dsh-alert-sounds

[![npm](https://img.shields.io/npm/v/@qgynisc/dsh-alert-sounds)](https://www.npmjs.com/package/@qgynisc/dsh-alert-sounds)
[![test](https://github.com/qgynisc/dsh-alert-sounds/actions/workflows/test.yml/badge.svg)](https://github.com/qgynisc/dsh-alert-sounds/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/qgynisc/dsh-alert-sounds)](https://github.com/qgynisc/dsh-alert-sounds/blob/main/LICENSE)
[![release](https://img.shields.io/github/v/release/qgynisc/dsh-alert-sounds)](https://github.com/qgynisc/dsh-alert-sounds/releases)

[简体中文](README.md) | **English**

Notification sounds and on-screen banners for the **DeepSeek Harness (dsh) web GUI**: a distinct tone (or a spoken utterance) plus a banner when a session needs an **approval**, needs an **answer**, **finishes a turn**, hits an **error**, or appears **stalled**.

> This project is a **fork of [@machine-126/dsh-alert-sound](https://github.com/Machine-126/dsh-alert-sound)** (MIT).
> The detection/playback code — including all of its hard-won fixes — is kept as-is. This fork does two things:
> ① rename + repackage (package name, loader id, slot ids and localStorage keys are all its own);
> ② **make the completion banner configurable instead of a fixed 3.6s flash** — so you still see it when you were away from the screen.

## Screenshots

![Settings → Alerts → On-screen banners: colours and layout of the five alert kinds (1×)](https://raw.githubusercontent.com/qgynisc/dsh-alert-sounds/main/docs/images/settings-toast.png)

The **On-screen banners** group under Settings → **Alerts**: all five kinds (approval / answer / complete / error / stalled) at a glance. The bars shown are **1× schematic previews** rendered by the **same component as the real banner**, so they never drift from the real thing; each row's **Preview** button pops a real banner at your current size, and **Pop one / check size** does the same with your current style.

## What this fork changes (vs upstream 0.3.14)

| | Upstream | This fork |
|---|---|---|
| **Banner dwell** | Fixed 3.6s auto-dismiss, and the toast was **off by default** (so you never saw it) | New **Toast style** setting, two **independent implementations**:<br>**① Built-in persistent card (default)** — stays until the pointer moves noticeably (≥8px) or you click; shows the completion time `HH:MM` and an `×`.<br>**② Original** — upstream's bottom-centre coloured bar with the 3.6s auto-dismiss. |
| Names / ids | `@machine-126/dsh-alert-sound`, slot id `dsh-alert`, keys `dsh-alert-sound.v1` | All renamed; the two plugins never share settings. |
| Structure | One hand-written 821-line `lib/client.js` | `src/client.js` (engine) + `src/panel.js` (UI) + `scripts/build.mjs` → `lib/`; 85 unit tests + install self-check |
| Upstream tracking | — | `npm run check:upstream` diffs upstream against the `vendor/` snapshot and names, per hunk, which function it belongs to and which file here to edit |
| React | top-level `require('react')` | failure-tolerant: without React the settings page is skipped, **sounds and detection keep working** |

Everything else (five kinds, tones, voice with fallback, repeats, DND, stall detection, system notifications, i18n, privacy) matches upstream.

## Sounds

The four built-in tones are **real, offline-rendered audio** (not a single browser-synthesised oscillator — swapped on 2026-10-06 after feedback that “these sounds are too thin”), inlined into `lib/client.js` at build time so they work offline without relying on the host serving static files:

| Label | Used for | Timbre | Length |
|---|---|---|---|
| Ding-dong | Output complete | Wooden marimba, two notes up (C5→G5) + light bell shimmer | 1.1s |
| Tap | Needs answer | Two short wooden taps up (B5→E6) | 0.6s |
| Alert | Needs approval | FM electronic pluck, three notes up + ping-pong delay | 1.2s |
| Low | Error / stalled | Two heavy sub-bass hits (thick saw + soft saturation + noise transient) | 1.3s |

All four are loudness-matched with EBU R128 (≈ −17.5 LUFS), so no single kind is dramatically louder than the others.

Two ways to use your own sounds:

1. **Settings → pick “Custom” → upload** (any mp3/wav/m4a/ogg, ≤2MB, stored in localStorage): no code changes, takes effect immediately;
2. **Replace a built-in tone**: drop your file into `assets/audio/` (or edit `scripts/render-audio.mjs` and re-render), run `npm run build`, and commit both — the audio is inlined into `lib/client.js`.

> Why inline as base64 instead of fetching a sibling mp3 at runtime: the DSH desktop app pulls client plugins through `__DSH_TRANSPORT__.loadBundle` **as source text**, so files next to the bundle have **no dependable URL**. The cost is roughly +70KB of bundle size.
> **MIDI (`.mid`) cannot be played directly**: browsers ship no MIDI synthesiser. Treat MIDI as a source format — render it to mp3 offline and inline it (`scripts/render-audio.mjs` is exactly that pipeline).

## Features

- **Five kinds, distinct real-audio tones** — needs approval / needs answer / output complete / error, plus an experimental **Stalled** kind (off by default).
- **The completion banner waits for you** — by default it sits at the bottom centre until you move the pointer or click, and tells you *when* it happened.
- **Switch toast style anytime** — go back to upstream's 3.6s bar when you want quiet, or keep the persistent card when you don't want to miss a completion.
- **Optional voice (zh/en)** — set a kind to **Voice** to hear it spoken; if speech synthesis fails to start, that kind's tone is played instead, so **an alert is never silent**.
- **Tones always play in full** — a 200ms silent warm-up wakes the output device (otherwise the first note is swallowed and you only hear the tail); multiple alerts play serially instead of interrupting each other.
- **Blocking events repeat** — approval/question re-alert every 10/20/30s until handled; errors repeat a few times.
- **Do-not-disturb window**, **scope** (all sessions or current only), **browser system notifications**.
- **Zero network** — everything happens in the browser; no requests, no telemetry.

## Requirements

- **DeepSeek Harness `0.1.2` or newer** (`dsh web`) — approval/question detection relies on `uiSession.pendingInteractions`; older versions only get complete/error alerts.
- A browser with Web Audio (tones); Web Speech for voice is optional and degrades to a tone.

## Install

```sh
dsh plugin --profile desktop add @qgynisc/dsh-alert-sounds
# or straight from GitHub (lib/ is committed, no build step needed):
dsh plugin --profile desktop add github:qgynisc/dsh-alert-sounds
# or use the bundled installer (backs up the profile manifest, removes the upstream plugin):
npm run install:desktop
```

> ⚠️ **Do not install this alongside upstream `@machine-126/dsh-alert-sound`** — you would get two sets of sounds and two banners. `npm run install:desktop` removes upstream for you (pass `--keep-upstream` to keep it), and `scripts/verify-install.mjs` checks for it.

Restart `dsh web` (or reload the page), then open **Settings → Alerts**.

## Settings

Interface language (auto/zh/en) · master volume (0–200%) · scope (all sessions / current only) · repeat interval (off/10/20/30s) · system notification · read-aloud · stall detection (off/1/2/5 min, experimental) · **toast on/off** · **toast style (built-in persistent card / original 3.6s bar)** · voice rate · do-not-disturb window · per-kind enable + sound (ding-dong = wooden marimba / tap / alert = FM electronic / low = sub-bass / voice / custom / mute) + preview, with custom audio upload (≤2MB) · restore defaults (with confirmation).

Preferences live in `localStorage` under `dsh-alert-sounds.v1` (settings) and `dsh-alert-sounds.custom.v1` (custom sounds) — different keys from upstream, so the two plugins don't touch each other's settings.

## Privacy

All processing stays in the browser. The plugin makes **no network requests**, sends nothing anywhere, and uses no analytics/telemetry. It reads, **in memory only**: the session list's `running`/`updatedAt`; `uiSession.pendingInteractions` (kind, tool name, reason, question text); the snapshot's `lastAgentError`; and — **only when “Read-aloud” is on** — the last assistant reply text. Nothing is stored or transmitted; the only persisted data is your own settings and uploaded custom sounds.

## Project layout

```
├─ package.json            # dsh.bundle + dsh.client (web client plugin)
├─ cordis.patch.yml        # composition patch: one inserted row (id=alert-sounds, name=package)
├─ src/{client,panel,host}.js
├─ scripts/                # build.mjs / rename / sync-upstream / install / verify-install
│  └─ render-audio.mjs     # offline-renders the four built-in tones → assets/audio/*.mp3 (needs ffmpeg)
├─ assets/audio/           # the four built-in tones as mp3 — committed, inlined into lib/client.js by the build
├─ tests/                  # 85 unit tests, run against the built lib/ artifacts
├─ vendor/upstream/        # byte-exact upstream snapshot (for diffing when tracking upstream)
└─ lib/                    # build output, committed on purpose (git installs do not build)
```

```sh
npm run build            # after editing src/, rebuild and commit lib/
npm test                 # build + unit tests + install self-check
npm run check:upstream   # is upstream ahead? prints a hunk-by-hunk porting guide
npm run rename           # idempotent rename (run after porting upstream code)
node scripts/render-audio.mjs   # re-render the built-in tones (needs ffmpeg; commit the output)
```

## Tracking upstream

Upstream's `lib/client.js` cannot be `git merge`d here (this repo splits it into `src/`). See [docs/UPSTREAM.md](docs/UPSTREAM.md) for the full procedure; `npm run check:upstream` tells you what changed and where it belongs.

> Known limitation (inherited from upstream): a session that was **already running when the page loaded** will not announce its completion (`seed()` only records a baseline, it doesn't arm the turn). A normal start→finish cycle always fires.

## Credits

- **Upstream of this fork**: [Machine-126/dsh-alert-sound](https://github.com/Machine-126/dsh-alert-sound) (MIT) — detection approach, tone design and the playback/voice fixes all come from it.
- Upstream's own credits are preserved: the **detection approach** follows [dsh-session-notification](https://github.com/dingyi222666/dsh-session-notification) (BSD-3-Clause); the “task-completion chime” concept follows [dsh-chime](https://github.com/HtO404/dsh-chime) (Apache-2.0); the **bundle/client-plugin structure** follows the official dsh docs (`docs/user/develop/basic/publish.md`) and the layouts of [dsh-plugin-tts](https://github.com/1624318455/dsh-plugin-tts), [dsh-status-rotator](https://github.com/01Virex/dsh-status-rotator) and [dsh-web-ui-notify](https://github.com/omdsh-dev/dsh-web-ui-notify).

## License

MIT. Original copyright Machine-126; fork changes copyright qgynisc. See [LICENSE](LICENSE).
