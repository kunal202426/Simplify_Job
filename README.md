# Simplify_Job

A local-first, self-learning job-application autofill Chrome extension, built on top of a
fork of [Autofill-Jobs](https://github.com/andrewmillercode/Autofill-Jobs) (MIT).

It fills what it can from a stored profile, and for anything it can't, it **learns from the
answer you type in manually** so the same — or a reworded — question fills itself next time,
with no network calls. Values are converted to each form's format (date patterns, dropdown
option lists, phone separators) before being inserted.

## Layout

- `Autofill-Jobs-master/src/public/contentScripts/` — content scripts
  - `signature.js` — field signature generation (label discovery + hashing)
  - `learningStore.js` — the learned answer bank (`chrome.storage.local`)
  - `formatConvert.js` — per-field format conversion (enums / dates / phone)
  - `matcher.js` — match pipeline (exact hash → profile → fuzzy)
  - `reviewPanel.js` — on-page review panel (filled / check / needs)
  - `engine.js` — orchestrates the fill + learn loop
  - `utils.js`, `autofill.js`, `workday.js` — base + per-site handlers
- `Autofill-Jobs-master/src/vue_src/` — Vue 3 popup (profile + answer-bank editor)
- `Autofill-Jobs-master/test/` — unit tests and browser fixtures

## Build & install

```bash
cd Autofill-Jobs-master/src
npm install
npm run build
```

Then open `chrome://extensions`, enable Developer mode, and **Load unpacked** →
`Autofill-Jobs-master/dist`.

## Test

```bash
cd Autofill-Jobs-master
node test/run.js          # pure-function unit tests
node test/server.cjs      # serve browser fixtures on http://localhost:8123
```

## Constraints

No auto-submit, no login/credential handling, no bulk-apply. The core fill/learn loop makes
zero network calls.
