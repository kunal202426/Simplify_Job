# Simplify_Job

A local-first, self-learning job-application autofill Chrome extension. Originally inspired
by [Autofill-Jobs](https://github.com/andrewmillercode/Autofill-Jobs) (MIT); the fill/learn
engine, format-conversion layer, embedding fallback, and per-site handling (Workday
especially) are an independent rewrite.

It fills what it can from a profile you set up once — name, contact info, education, resume,
socials — and for anything it can't, it **learns from the answer you type in manually**, so
the same question (or a reworded version of it) fills itself next time. Matching runs in
priority order: your current profile first, then an exact recall of a question seen before,
then a small set of curated defaults for recurring compliance questions that vary by company
name (e.g. "have you previously been employed by \<Company\>?"), then fuzzy token-overlap
against everything you've answered before, then — if nothing else matches — a local embedding
model compares the question's *meaning* against your answer history, entirely offline.
Whatever gets filled is reshaped to the field's actual format (date patterns, dropdown
wording, phone separators) before insertion. **Nothing here auto-submits, auto-accepts a
consent checkbox, or handles login credentials** — you always review and submit yourself.

The whole fill/learn/match pipeline makes **zero network calls**, always.

## Layout

- `Autofill-Jobs-master/src/public/contentScripts/` — content scripts
  - `signature.js` — field signature generation (label discovery + hashing)
  - `learningStore.js` — the learned answer bank (`chrome.storage.local`)
  - `formatConvert.js` — per-field format conversion (enums / dates / phone)
  - `matcher.js` — match pipeline (profile → exact recall → compliance defaults → fuzzy → none)
  - `embedding.js` + `background.js` — local MiniLM embedding model (offline semantic fallback)
  - `reviewPanel.js` — on-page review panel (filled / check / needs)
  - `engine.js` — orchestrates the fill + learn loop; also handles ARIA comboboxes and
    pill/button-group widgets
  - `utils.js`, `autofill.js` — shared helpers + the generic-ATS page-load entry point
  - `workday.js` — Workday's multi-stage wizard and its bespoke widgets (skills picker,
    repeatable work-experience sections) that the generic engine doesn't cover
- `Autofill-Jobs-master/src/vue_src/` — Vue 3 popup (profile + answer-bank editor)
- `Autofill-Jobs-master/test/` — unit tests and browser fixtures

## Tested against

Greenhouse, Lever, Dover, Workday, SAP SuccessFactors, Oracle Cloud Recruiting, Keka, and a
growing list of custom ATS builds — detection is content-based (label reading + ARIA
patterns), not a hardcoded site list, so it's built to handle portals it's never seen before
too.

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
