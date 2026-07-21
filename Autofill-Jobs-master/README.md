<div align="center">

<h1 align="center">
  Simplify Job — Self-Learning Autofill
</h1>
<p>
  A Chrome extension that fills out job applications for you — and actually gets better the
  more you use it. Built with <a href="https://vuejs.org/">Vue</a>, forked from
  <a href="https://github.com/andrewmillercode/Autofill-Jobs">andrewmillercode/Autofill-Jobs</a>.
</p>
</div>

## Why this exists

Job applications, especially on ATS platforms like Workday and SuccessFactors, take way too
long to fill out — repeating the same name/email/address across dozens of portals, and
answering the same compliance questions ("Have you ever been employed by our auditor?",
"Are you legally eligible to work in this country?") over and over, just worded slightly
differently every time.

This extension fills what it can from a profile you set up once, and — the actual point of
this fork — **learns from every question you answer manually**, so the second time it sees
that question (even reworded) it fills it for you. All of that learning happens **entirely on
your machine**. Nothing about your answers, profile, or the pages you apply to is ever sent
anywhere.

## How it works

1. **Profile fill.** Fields matched against your stored profile (name, email, phone, address,
   education, socials, ...) fill instantly.
2. **Exact recall.** A question you've answered before, worded exactly the same way, fills
   instantly from what it learned last time.
3. **Fuzzy match.** A reworded version of a question you've answered before ("Have you been
   employed by our statutory auditor?" vs. "Are you or have you ever been employed by the
   firm's external auditor?") is matched by token overlap and filled, flagged amber for a
   quick glance before you submit.
4. **Local semantic fallback.** If token overlap finds nothing, a small embedding model
   (~23MB, downloaded once, runs fully offline via WASM/ONNX in the background) compares the
   question's *meaning* against everything you've answered before. Matches are flagged violet
   — these are guesses, always worth checking.
5. **Format conversion.** Whatever gets filled is reshaped to match the target field: dates
   converted to the field's actual pattern, Yes/No mapped to whatever enum wording that
   specific dropdown uses, phone numbers reformatted (or stripped to bare digits if the field
   is paired with its own country-code selector).
6. **Learn.** Anything the extension couldn't fill gets flagged and left for you — fill it
   once, and a listener quietly learns it for next time, no different from you just answering
   the question normally.

A floating panel (bottom-right of every page) shows exactly what happened as it happens:
what got filled, what's a fuzzy/AI guess worth double-checking, and what still needs you —
each with a small tag showing *why* (profile match, learned recall, fuzzy match, AI guess,
or manual). A "Copy log" button in the panel exports that as plain text. The extension popup
also has a "Learned Answers" section listing everything it's ever learned, editable and
deletable.

**Nothing here ever auto-submits an application, auto-accepts a consent checkbox, or handles
login credentials.** You always review and hit submit yourself.

## What's local vs. what isn't

- The fill/learn/match/embedding pipeline: **100% local, zero network calls**, always.
- The popup's GitHub star count: one harmless `fetch` to the public GitHub API.
- Resume parsing into structured skills/work-experience: **fully opt-in** — only runs if you
  paste your own Gemini API key into the popup. Skip it and this extension never talks to the
  network at all beyond the star count.

## Tested against

Greenhouse, Lever, Dover, Workday, SAP SuccessFactors, Oracle Cloud Recruiting, Keka,
Workable, and a growing list of custom/unrecognized ATS builds — detection is
content-based (label reading + ARIA patterns), not a hardcoded site list, so it's designed to
work on portals it's never seen before too. It's still actively being hardened against new
ones; if you hit a page it handles badly, that's expected at this stage — see
[Contributing](#contributing).

## Getting started

```bash
# Clone the repository
git clone https://github.com/kunal202426/Simplify_Job.git
cd Simplify_Job/Autofill-Jobs-master/src

# Install dependencies
npm install

# Build the extension
npm run build

# Then: chrome://extensions -> enable Developer mode -> Load unpacked -> select the `dist/` folder
```

Open the extension popup and fill in your profile (name, contact info, education, resume,
etc. — stored locally in `chrome.storage`, never uploaded anywhere). Then just go apply to
jobs; the extension runs automatically on any page it recognizes as a job application.

## Running the tests

```bash
# Pure-function unit tests (matching, formatting, signatures) — no browser needed
node test/run.js

# Browser fixtures (end-to-end DOM tests) — serve them locally and open in any browser
node test/server.cjs
# then visit http://localhost:8123/test/fixtures/<name>.html
```

Every fix in this project ships with a regression test — that's not a suggestion, it's how
the codebase actually got this far without silently breaking earlier ATS support every time a
new one gets added.

## Architecture

Content scripts (loaded as plain classic scripts sharing globals, not ES modules — see
`manifest.json`) under `src/public/contentScripts/`:

| File | Responsibility |
|---|---|
| `signature.js` | Reads a field's label + type + options into a stable fingerprint, using every label-discovery strategy a real ATS throws at you (`<label for>`, wrapping labels, `aria-labelledby`, `data-automation-*`, nearest heading, placeholder, ...) |
| `learningStore.js` | The answer bank — reads/writes `chrome.storage.local`, serialized so concurrent learns can't clobber each other |
| `formatConvert.js` | Reshapes a matched value to a field's actual format: dates, enum wording, phone digits |
| `matcher.js` | The matching pipeline — profile → exact recall → fuzzy → none |
| `embedding.js` + `background.js` | Client/host for the local MiniLM embedding model (semantic fallback matching) |
| `reviewPanel.js` | The floating on-page status panel |
| `engine.js` | The orchestrator — ties everything together, handles native fields, ARIA comboboxes, and pill/button-group widgets alike |
| `workday.js` | Workday-specific stage-driven flow (older, more fragile — least covered by automated tests) |

Popup UI is Vue 3 + Vite, under `src/vue_src/`.

## Contributing

Found a portal where autofill misbehaves? Open an issue with:
- the site (or a sanitized HTML snippet of the field that misbehaved — **please strip any
  personal data first**),
- the browser console output,
- and ideally the panel's "Copy log" output from that page.

If you're fixing something yourself: add a regression test (`test/run.js` for pure logic,
a `test/fixtures/*.html` page for anything DOM-dependent) before calling it done, and run
`npm run build` + confirm `dist/` matches `src/` before committing — the loaded extension only
ever reflects what's actually in `dist/`.

## License

MIT — see [LICENSE](LICENSE). Original project © 2025 Andrew Miller
([andrewmillercode/Autofill-Jobs](https://github.com/andrewmillercode/Autofill-Jobs)); this
fork's additions are also MIT.
