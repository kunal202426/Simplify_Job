/*
  engine.js — the learning/fill orchestrator (site-agnostic).

  Runs after the existing profile pass. For every fillable field on the form it:
    1. builds a signature (signature.js)
    2. asks the matcher what to fill and from where (matcher.js)
    3. reshapes the value to the field's format (formatConvert.js) before inserting
    4. flags fuzzy fills amber and records everything to the review panel (reviewPanel.js)
    5. attaches a learn-listener to unfilled/uncertain fields so a manual answer is stored
       (learningStore.js) and auto-fills next time — no network calls anywhere in here.

  Consumes globals from utils.js: setNativeValue, sleep, delays, mouseUpEvent, keyDownEvent.
*/

let __afjKeySeq = 0;
function afjKeyFor(el) {
  if (!el.__afjKey) el.__afjKey = "f" + ++__afjKeySeq;
  return el.__afjKey;
}

// Inputs we never touch: structural, file (handled separately), and — for safety —
// passwords and consent checkboxes (accepting terms is the user's action, not ours).
const AFJ_SKIP_TYPES = new Set([
  "hidden", "submit", "button", "reset", "image", "file", "password",
]);

function afjIsFillable(el) {
  if (el.disabled || el.readOnly) return false;
  if (el.tagName.toLowerCase() === "input") {
    const t = (el.getAttribute("type") || "text").toLowerCase();
    if (AFJ_SKIP_TYPES.has(t)) return false;
  }
  // Skip invisible fields.
  const rects = el.getClientRects();
  if (!rects || rects.length === 0) return false;
  return true;
}

// Repeatable sections ("+ Add Employer", "+ Add Reference") on dynamic forms sometimes
// reuse the same radio `name` per repeated instance instead of uniquifying it — scoping the
// group query to the nearest structural container (instead of the whole document) keeps
// same-named radios in different repeated sections from bleeding into each other.
function afjRadioGroupScope(el) {
  return (el.closest && el.closest('form, fieldset, [role="group"], [role="radiogroup"]')) || document;
}

/** Read the current value of a field for "already filled?" checks and for learning. */
function afjReadValue(el, sig) {
  const type = sig.fieldType;
  if (type === "checkbox") return el.checked ? (el.value || "true") : "";
  if (type === "radio") {
    if (!el.name) return el.checked ? afjRadioLabel(el) : "";
    const group = afjRadioGroupScope(el).querySelectorAll(
      `input[type="radio"][name="${CSS.escape(el.name)}"]`
    );
    for (const r of group) if (r.checked) return afjRadioLabel(r);
    return "";
  }
  if (el.tagName.toLowerCase() === "select") {
    const opt = el.options[el.selectedIndex];
    // Treat placeholder first option as empty. A blank value ("") is itself a strong signal
    // regardless of wording — most placeholder options are <option value="">...</option> —
    // and the text check strips leading/trailing dashes/punctuation before testing, since
    // "-- Select --" / "- Choose One -" (dash-wrapped placeholders) are at least as common
    // as a bare "Select..." and the old check only matched text starting with the word
    // itself, silently treating a dash-wrapped placeholder as an already-answered value.
    if (!opt || el.selectedIndex <= 0) {
      const raw = opt ? (opt.textContent || "").trim() : "";
      const cleaned = raw.replace(/^[-–—\s]+|[-–—\s]+$/g, "");
      if (!opt || opt.value === "" || !cleaned || /^(select|choose|please|pick)\b/i.test(cleaned)) return "";
    }
    return (opt.textContent || opt.value || "").trim();
  }
  return (el.value || "").trim();
}

function afjRadioLabel(radio) {
  // The selected VALUE is the option's own text ("Yes"), not the group question.
  return getOptionLabel(radio) || radio.value || "";
}

/* ---------------- generic combobox / listbox widgets ---------------- */

// The WAI-ARIA combobox pattern (an <input role="combobox"> paired with a role="listbox"
// popup of role="option" items, often portaled elsewhere in the DOM rather than nested
// under the input) is the same accessibility standard underneath virtually every modern
// dropdown library — React-Select, Downshift, Radix, MUI Autocomplete, Oracle JET, and
// more. Detecting it by ARIA role means this isn't a per-vendor hack: it covers all of
// them, plus any future one, without needing a hardcoded list.

function afjIsComboboxInput(el) {
  if (!el || el.tagName.toLowerCase() !== "input") return false;
  if ((el.getAttribute("role") || "").toLowerCase() === "combobox") return true;
  const haspopup = (el.getAttribute("aria-haspopup") || "").toLowerCase();
  return haspopup === "listbox" || haspopup === "grid" || haspopup === "true";
}

/** Find the (possibly portaled elsewhere in the DOM) popup listbox for a combobox input. */
function afjComboboxListbox(el) {
  const ownerId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  if (ownerId) {
    const node = document.getElementById(ownerId);
    if (node) return node;
  }
  const visible = Array.from(document.querySelectorAll('[role="listbox"]')).filter(
    (lb) => lb.getClientRects().length > 0
  );
  if (!visible.length) return null;
  if (visible.length === 1) return visible[0];
  // Several custom dropdowns can have options rendered simultaneously on a busy page (a
  // nationality field, a location field, a skills field, each its own React-Select-style
  // widget) — with no aria-controls/aria-owns to go on, the only signal left for which
  // listbox belongs to THIS input is proximity: real dropdown popups render right next to
  // the control that opened them.
  const inputRect = el.getBoundingClientRect();
  let best = visible[0], bestDist = Infinity;
  for (const lb of visible) {
    const r = lb.getBoundingClientRect();
    const dist = Math.abs(r.top - inputRect.bottom) + Math.abs(r.left - inputRect.left);
    if (dist < bestDist) { bestDist = dist; best = lb; }
  }
  return best;
}

function afjComboboxOptionEls(listbox) {
  if (!listbox) return [];
  const withRole = Array.from(listbox.querySelectorAll('[role="option"]'));
  return withRole.length ? withRole : Array.from(listbox.querySelectorAll("li"));
}

/**
 * Fill a combobox: focus/click to open, type the value to filter (most implementations
 * narrow their option list on input), wait for the popup to render, then click the
 * best-matching visible option by text. Best-effort — real widget libraries vary in exact
 * timing/behavior, so this may need refinement against specific sites, but it's the
 * generic ARIA-standard interaction rather than a per-site special case.
 */
async function afjFillCombobox(el, value) {
  el.__afjProgrammatic = true;
  try {
    el.focus();
    el.click();
    await sleep(delays.short);
    setNativeValue(el, value);
    await sleep(delays.long);

    const options = afjComboboxOptionEls(afjComboboxListbox(el));
    if (!options.length) return false;

    const optionTexts = options.map((o) => (o.textContent || "").trim());
    const bestText = matchOption(value, optionTexts);
    if (!bestText) return false;

    options[optionTexts.indexOf(bestText)].click();
    await sleep(delays.short);
    return true;
  } finally {
    setTimeout(() => { el.__afjProgrammatic = false; }, 0);
  }
}

// Tracks the combobox input the user most recently interacted with, so a later click on an
// option — often rendered in a portal elsewhere in the DOM, not inside the original field's
// container — can be attributed back to the field it belongs to. React (and most similar
// libraries) update a controlled input's value via a direct DOM property write on
// selection, not a genuine user keystroke/click on the input itself, so it never fires a
// native 'change'/'input' event there — the only real, generic signal that a selection
// happened is the click on the rendered option, which is why this listens for that instead.
//
// Tracked via BOTH focusin and mousedown on the combobox itself, not focusin alone: every
// one of these widgets requires a click to open regardless of how it manages focus
// internally, so mousedown is the more universally reliable signal (focusin can be
// suppressed by the browser in some contexts — e.g. when the window itself lacks OS-level
// focus — while a dispatched click/mousedown still fires).
let AFJ_LAST_COMBOBOX = null;
let AFJ_COMBOBOX_LEARN_BOUND = false;

function afjEnsureComboboxLearning() {
  if (AFJ_COMBOBOX_LEARN_BOUND) return;
  AFJ_COMBOBOX_LEARN_BOUND = true;

  const trackCombobox = (ev) => {
    if (afjIsComboboxInput(ev.target)) AFJ_LAST_COMBOBOX = ev.target;
  };
  document.addEventListener("focusin", trackCombobox, true);
  document.addEventListener("mousedown", trackCombobox, true);

  document.addEventListener(
    "click",
    (ev) => {
      const optionEl = ev.target.closest && ev.target.closest('[role="option"]');
      if (!optionEl) return;
      const combo = AFJ_LAST_COMBOBOX;
      if (!combo || combo.__afjProgrammatic) return;
      // Let the widget's own state update land before reading the resulting display value.
      setTimeout(() => {
        const sig = generateSignature(combo);
        const val = (combo.value || "").trim();
        if (!val) return;
        upsertLearnedField(sig, val, "manual").then(() => {
          AFJ_PANEL.record({ key: afjKeyFor(combo), status: "filled", label: sig.rawLabel, value: val, source: "manual", el: combo });
        });
      }, 150);
    },
    true
  );
}

/* ---------------- filling ---------------- */

function afjSelectByText(selectEl, text) {
  const target = String(text);
  for (const o of selectEl.options) {
    if ((o.textContent || "").trim() === target || (o.value || "").trim() === target) {
      selectEl.value = o.value;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      selectEl.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
  }
  // fall back to case-insensitive option matching
  const nt = target.toLowerCase();
  for (const o of selectEl.options) {
    if ((o.textContent || "").trim().toLowerCase() === nt) {
      selectEl.value = o.value;
      selectEl.dispatchEvent(new Event("change", { bubbles: true }));
      selectEl.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    }
  }
  return false;
}

function afjClickRadio(el, value) {
  const group = el.name
    ? afjRadioGroupScope(el).querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)
    : [el];
  const labels = Array.from(group).map((r) => afjRadioLabel(r));
  const match = matchOption(value, labels);
  if (!match) return false;
  for (let i = 0; i < group.length; i++) {
    if (labels[i] === match) {
      group[i].click();
      return true;
    }
  }
  return false;
}

/** Insert a (pre-converted) value into a field. Returns true on success. */
async function afjFillField(el, finalValue, sig) {
  el.__afjProgrammatic = true;
  try {
    const type = sig.fieldType;
    if (type === "radio") return afjClickRadio(el, finalValue);
    if (type === "checkbox") return false; // never auto-check (see AFJ_SKIP rationale)

    if (el.tagName.toLowerCase() === "select") {
      return afjSelectByText(el, finalValue);
    }

    // Generic ARIA combobox (Oracle Cloud, React-Select-style widgets, ...): open, filter,
    // click the matching rendered option — see afjFillCombobox for why this can't just be
    // a value + change-event write like a native input.
    if (afjIsComboboxInput(el)) {
      return await afjFillCombobox(el, finalValue);
    }

    // Custom react-select combobox (Greenhouse): keep the proven mouseUp/keyDown dance.
    const combo = el.closest && el.closest(".select__control--outside-label");
    setNativeValue(el, finalValue);
    if (combo) {
      combo.dispatchEvent(mouseUpEvent);
      await sleep(delays.short);
      combo.dispatchEvent(keyDownEvent);
      await sleep(delays.short);
    }
    return true;
  } finally {
    // Clear the guard after the synchronous events have flushed.
    setTimeout(() => { el.__afjProgrammatic = false; }, 0);
  }
}

/**
 * Uniform descriptor for a "needs you" field, native or pill-group, so the embedding
 * fallback pass (see afjRunEmbeddingFallback) can treat both the same way without caring
 * which kind of widget it's dealing with.
 */
function afjMakeFieldCandidate(el, sig) {
  return {
    marker: el,
    sig,
    fill: (value) => afjFillField(el, value, sig),
    markCheck: (value) => {
      el.style.outline = "2px solid #7c3aed"; // violet: an AI-suggested guess, double-check
      el.style.outlineOffset = "1px";
      AFJ_PANEL.record({ key: afjKeyFor(el), status: "ai", label: sig.rawLabel, value, source: "embedding-matched", el });
    },
  };
}

/* ---------------- learning ---------------- */

function afjAttachLearnListener(el, sig) {
  // The representative element (el) owns the panel row + signature; but for a radio group
  // we must listen on every radio, since only the newly-checked one fires 'change'.
  const listenTargets =
    sig.fieldType === "radio" && el.name
      ? Array.from(afjRadioGroupScope(el).querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
      : [el];

  const handler = (ev) => {
    const src = (ev && ev.target) || el;
    if (src.__afjProgrammatic || el.__afjProgrammatic) return; // ignore our own writes
    const fresh = generateSignature(el); // signature always from the group representative
    const val = afjReadValue(el, fresh);
    if (val == null || val === "") return;
    upsertLearnedField(fresh, val, "manual").then(() => {
      AFJ_PANEL.record({
        key: afjKeyFor(el),
        status: "filled",
        label: fresh.rawLabel || sig.rawLabel,
        value: val,
        source: "manual",
        el: el,
      });
    });
  };

  for (const t of listenTargets) {
    if (t.__afjLearnBound) continue;
    t.__afjLearnBound = true;
    t.addEventListener("change", handler);
    t.addEventListener("blur", handler, true);
  }
}

/* ---------------- resume / attachment upload ---------------- */

// Positive/negative keyword lists for picking the right file input when a page has several
// (resume vs. cover letter vs. "miscellaneous attachments", as Oracle Cloud Recruiting does).
const RESUME_KEYWORDS = ["resume", "cv", "curriculum vitae"];
const RESUME_EXCLUDE_KEYWORDS = [
  "cover letter", "coverletter", "photo", "portfolio", "miscellaneous", "additional",
];

/** Pure predicate on a normalized label/attribute string — exported for Node unit testing. */
function afjLooksLikeResumeLabel(normalizedLabel) {
  const label = normalizedLabel || "";
  if (RESUME_EXCLUDE_KEYWORDS.some((k) => label.includes(k))) return false;
  return RESUME_KEYWORDS.some((k) => label.includes(k));
}

/**
 * Combine the resolved human label with structural attributes (id/name/class/
 * data-field-identifier/data-automation-id/data-automation-label/data-qa) into one
 * lowercased signal string. Some ATSes (e.g. Keka) wrap the file input's visible "Upload
 * Resume" text in an <a>, not a <label>, so no clean label ever resolves — but the input
 * itself carries clear semantic attributes like data-field-identifier="resume" that a
 * pure label-text check would miss entirely.
 */
function afjFileInputSignal(el) {
  const parts = [
    el.id,
    el.name,
    el.className,
    el.getAttribute("data-field-identifier"),
    el.getAttribute("data-automation-id"),
    el.getAttribute("data-automation-label"),
    el.getAttribute("data-qa"),
  ];
  return parts.filter(Boolean).join(" ").toLowerCase();
}

/**
 * Upload the stored resume to the best-matching file input in scope. Site-agnostic —
 * covers ATSes (Oracle Cloud Recruiting, iCIMS, Taleo, SuccessFactors, Keka, ...) that
 * have no dedicated per-site resume handler. Skips any file input that already has a file
 * assigned, so it never double-uploads on Greenhouse/Lever/Dover/Workday, whose own
 * dedicated resume handlers (in autofill.js / workday.js) run before this and already set
 * `.files`.
 */
async function afjUploadResume(scope) {
  const localData = await getStorageDataLocal();
  if (!localData.Resume) return;

  const fileInputs = Array.from(scope.querySelectorAll('input[type="file"]')).filter((el) => {
    if (el.disabled) return false;
    if (el.files && el.files.length) return false;
    const rects = el.getClientRects();
    return rects && rects.length > 0;
  });
  if (!fileInputs.length) return;

  let target = null;
  for (const el of fileInputs) {
    const signal = generateSignature(el).normalized + " " + afjFileInputSignal(el);
    if (afjLooksLikeResumeLabel(signal)) {
      target = el;
      break;
    }
  }
  // A single, unlabeled file input on the page is a reasonable bet even without a keyword hit.
  if (!target && fileInputs.length === 1) target = fileInputs[0];
  if (!target) return;

  const arrBfr = base64ToArrayBuffer(localData.Resume);
  const dt = new DataTransfer();
  dt.items.add(new File([arrBfr], `${localData["Resume_name"] || "resume.pdf"}`, { type: "application/pdf" }));
  target.files = dt.files;
  target.dispatchEvent(changeEvent);
  target.dispatchEvent(inputEvent);
  await sleep(delays.short);

  AFJ_PANEL.record({
    key: afjKeyFor(target),
    status: "filled",
    label: generateSignature(target).rawLabel || "Resume",
    value: localData["Resume_name"] || "resume.pdf",
    source: "resume",
    el: target,
  });
}

/* ---------------- job-application page detection ---------------- */

// Built once from matcher.js's curated identity/contact rules: a "probe" profile where every
// recognized key has a placeholder value, so matchProfile() can be reused purely to ask "does
// this field's label structurally look like a known identity/contact concept?" without needing
// the user's real stored data. Powers the content-based gate below.
const AFJ_PROBE_RES = (function () {
  const o = {};
  if (typeof PROFILE_MATCHERS !== "undefined") {
    for (const rule of PROFILE_MATCHERS) o[rule.key] = "x";
  }
  return o;
})();

const AFJ_JOB_URL_SIGNALS = ["apply", "career", "job", "candidate", "recruit", "vacanc", "position"];

// Path fragments that mark a page as some app's own account/settings/dashboard area rather
// than a job application — real-world collision found live: a job-hunting SaaS's own
// /settings page has a large form (name/phone/LinkedIn/portfolio, easily 8+ fields) AND its
// hostname literally contains "job", so both the field-count and URL fast-passes below would
// otherwise fire on the tool's own settings page. Any app whose own name/domain happens to
// contain a word like "job", "career", or "recruit" is structurally indistinguishable from a
// real ATS by those two signals alone, so a recognizable non-application path is checked
// first and — short of an actual resume upload, which stays trustworthy anywhere — blocks
// both of them.
const AFJ_NON_APPLICATION_PATH_HINTS = [
  "/settings", "/account", "/dashboard", "/profile", "/billing",
  "/login", "/signin", "/sign-in", "/signup", "/sign-up", "/checkout",
];

/**
 * Content-based gate for running the generic engine on a host we have no prior knowledge
 * of. Runs on every https page (see manifest), so this decides "is this actually a job
 * application" rather than a hostname allowlist.
 *
 * Deliberately permissive: any ONE of these is enough —
 *   - a resume/CV upload field (near-unique to job applications),
 *   - the page URL/title reads job-related at all, or
 *   - the form is simply large (many portals use unfamiliar label wording our identity
 *     rules don't recognize, or start a multi-step flow with only 1-2 fields visible — a
 *     strict AND-combination of signals silently means the engine never runs there at all,
 *     which is worse than an occasional harmless fill attempt on the wrong page).
 * False positives just mean a visible fill attempt on a form that wasn't a job application
 * (no auto-submit, no credential fields are ever touched — same fields a browser's own
 * autofill already targets); false negatives mean total silence on a real application,
 * which is the failure mode actually worth avoiding.
 */
function afjLooksLikeJobApplicationPage(scope) {
  const fileInputs = Array.from(scope.querySelectorAll('input[type="file"]')).filter(
    (el) => el.getClientRects().length > 0
  );
  const hasResumeUpload = fileInputs.some((el) => {
    const signal = generateSignature(el).normalized + " " + afjFileInputSignal(el);
    return afjLooksLikeResumeLabel(signal);
  });
  if (hasResumeUpload) return true;

  const path = (location.pathname || "").toLowerCase();
  if (AFJ_NON_APPLICATION_PATH_HINTS.some((p) => path.includes(p))) return false;

  // Field count first, before the URL check: a tiny form (login, newsletter signup) should
  // never fire just because it happens to sit on a page whose title/URL mentions "careers"
  // (e.g. a login box embedded near a careers nav link) — the URL signal is a reason to be
  // permissive about WORDING on an actual application form, not a license to fire on any
  // form anywhere on a job-adjacent site regardless of size.
  //
  // Visible fields only: some SPAs keep every tab/route's content mounted simultaneously and
  // just CSS-hide the inactive ones (to preserve scroll/filter state across tab switches),
  // rather than unmounting it — scanning the raw DOM would otherwise count fields from tabs
  // the user isn't even looking at right now toward "this looks like a big form."
  const fields = Array.from(scope.querySelectorAll("input, select, textarea")).filter(
    (el) => el.getClientRects().length > 0
  );
  if (fields.length < 3) return false;
  if (fields.length >= 8) return true; // a large form is unlikely to be a newsletter/contact form

  const urlText = (location.href + " " + (document.title || "")).toLowerCase();
  if (AFJ_JOB_URL_SIGNALS.some((k) => urlText.includes(k))) return true;

  const seenTokenSets = new Set();
  let identityHits = 0;
  for (const el of fields) {
    const sig = generateSignature(el);
    if (!sig.tokens.length) continue;
    const key = sig.tokens.join(" ");
    if (seenTokenSets.has(key)) continue;
    seenTokenSets.add(key);
    if (matchProfile(sig, AFJ_PROBE_RES)) identityHits++;
  }
  return identityHits >= 2;
}

/* ---------------- field enumeration ---------------- */

/** Collect fillable fields, collapsing radio groups to a single representative element. */
function afjCollectFields(form) {
  const scope = form || document;
  const out = [];
  // Keyed by (structural container, name) — not name alone. A repeatable section ("+ Add
  // Employer") that reuses the same radio `name` per instance is otherwise indistinguishable
  // from one big group spanning every instance: only the FIRST section's radios would ever
  // get collected, and every later section would be silently invisible to matching, filling,
  // and learning — not just misattributed, but never processed at all.
  const seenRadioGroups = new Map(); // container element -> Set of names seen in it
  scope.querySelectorAll("input, select, textarea").forEach((el) => {
    if (!afjIsFillable(el)) return;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "radio" && el.name) {
      const container = afjRadioGroupScope(el);
      let names = seenRadioGroups.get(container);
      if (!names) { names = new Set(); seenRadioGroups.set(container, names); }
      if (names.has(el.name)) return;
      names.add(el.name);
    }
    out.push(el);
  });
  return out;
}

/* ---------------- pill/button-group widgets ---------------- */

/** Click the pill button whose text best matches value. Returns true on success. */
function afjFillPillGroup(group, value) {
  const texts = group.buttons.map((b) => (b.textContent || "").replace(/\s+/g, " ").trim());
  const best = matchOption(value, texts);
  if (!best) return false;
  const btn = group.buttons[texts.indexOf(best)];
  btn.__afjProgrammatic = true;
  btn.click();
  setTimeout(() => { btn.__afjProgrammatic = false; }, 0);
  return true;
}

function afjAttachPillGroupLearnListener(group, sig) {
  for (const btn of group.buttons) {
    if (btn.__afjLearnBound) continue;
    btn.__afjLearnBound = true;
    btn.addEventListener("click", () => {
      if (btn.__afjProgrammatic) return; // ignore our own writes
      const val = (btn.textContent || "").replace(/\s+/g, " ").trim();
      if (!val) return;
      const fresh = generatePillGroupSignature(group);
      upsertLearnedField(fresh, val, "manual").then(() => {
        AFJ_PANEL.record({
          key: afjKeyFor(group.container),
          status: "filled",
          label: fresh.rawLabel || sig.rawLabel,
          value: val,
          source: "manual",
          el: group.container,
        });
      });
    });
  }
}

/**
 * Pill-group counterpart to afjProcessFields — same matching/learning pipeline, adapted
 * for a chooser built from buttons instead of a native select/radio group. Same
 * idempotency (__afjProcessed on the container) and per-item error isolation.
 */
async function afjProcessPillGroups(scope, res, bank) {
  const groups = findPillGroups(scope).filter((g) => !g.container.__afjProcessed);
  const needsList = [];

  const makeCandidate = (group, sig) => ({
    marker: group.container,
    sig,
    fill: (value) => Promise.resolve(afjFillPillGroup(group, value)),
    markCheck: (value) => {
      AFJ_PANEL.record({ key: afjKeyFor(group.container), status: "ai", label: sig.rawLabel, value, source: "embedding-matched", el: group.container });
    },
  });

  for (const group of groups) {
    group.container.__afjProcessed = true;
    try {
      const sig = generatePillGroupSignature(group);
      if (!sig.tokens.length && !sig.rawLabel) continue;

      const existing = getPillGroupValue(group);
      if (existing) {
        AFJ_PANEL.record({ key: afjKeyFor(group.container), status: "filled", label: sig.rawLabel, value: existing, source: "pre-filled", el: group.container });
        afjAttachPillGroupLearnListener(group, sig);
        continue;
      }

      const decision = matchField(sig, res, bank, matchOption);
      if (decision.source === "none") {
        AFJ_PANEL.record({ key: afjKeyFor(group.container), status: "needs", label: sig.rawLabel, value: "", el: group.container });
        afjAttachPillGroupLearnListener(group, sig);
        needsList.push(makeCandidate(group, sig));
        continue;
      }

      const conv = convertValue(group.container, decision.value, sig);
      if (!conv.ok || !conv.value) {
        AFJ_PANEL.record({ key: afjKeyFor(group.container), status: "needs", label: sig.rawLabel, value: "", el: group.container });
        afjAttachPillGroupLearnListener(group, sig);
        needsList.push(makeCandidate(group, sig));
        continue;
      }

      const ok = afjFillPillGroup(group, conv.value);
      if (!ok) {
        AFJ_PANEL.record({ key: afjKeyFor(group.container), status: "needs", label: sig.rawLabel, value: "", el: group.container });
        afjAttachPillGroupLearnListener(group, sig);
        needsList.push(makeCandidate(group, sig));
        continue;
      }

      const status = decision.source === "fuzzy-matched" ? "check" : "filled";
      AFJ_PANEL.record({ key: afjKeyFor(group.container), status, label: sig.rawLabel, value: conv.value, source: decision.source, el: group.container });
      afjAttachPillGroupLearnListener(group, sig);
    } catch (e) {
      console.warn("AutofillJobs: skipped a pill group after an error", group.container, e);
    }
    await sleep(delays.short / 2);
  }

  return needsList;
}

/* ---------------- main entry ---------------- */

/**
 * One pass over currently-present fillable fields in scope. Idempotent per element (marks
 * each element `__afjProcessed` so repeat passes only touch what's new) — this is what
 * makes it safe to call repeatedly as the DOM changes, and essential for correctness: a
 * naive re-scan could otherwise overwrite a field the user is mid-edit on, or one they
 * deliberately cleared.
 */
async function afjProcessFields(scope, res, bank) {
  afjEnsureComboboxLearning();
  const fields = afjCollectFields(scope);
  let filled = 0, checked = 0, needs = 0;
  const needsList = [];

  for (const el of fields) {
    if (el.__afjProcessed) continue;
    el.__afjProcessed = true;

    // A single unusual field (a widget type we don't fully understand, an unexpected DOM
    // shape) must never be able to abort every field after it in this pass — without this
    // boundary, one thrown error silently stops the whole rest of the form from being
    // scanned, which looks indistinguishable from the engine doing nothing at all.
    try {
      const sig = generateSignature(el);
      if (!sig.tokens.length && !sig.rawLabel) continue; // nothing to key on

      // Already has a value (e.g. filled by the profile pass or pre-populated).
      const existing = afjReadValue(el, sig);
      if (existing) {
        AFJ_PANEL.record({ key: afjKeyFor(el), status: "filled", label: sig.rawLabel, value: existing, source: "pre-filled", el });
        afjAttachLearnListener(el, sig); // learn user corrections
        filled++;
        continue;
      }

      const decision = matchField(sig, res, bank, matchOption);

      if (decision.source === "none") {
        AFJ_PANEL.record({ key: afjKeyFor(el), status: "needs", label: sig.rawLabel, value: "", el });
        afjAttachLearnListener(el, sig);
        needsList.push(afjMakeFieldCandidate(el, sig));
        needs++;
        continue;
      }

      // Reshape to the field's format before inserting.
      const conv = convertValue(el, decision.value, sig);
      if (!conv.ok || conv.value == null || conv.value === "") {
        AFJ_PANEL.record({ key: afjKeyFor(el), status: "needs", label: sig.rawLabel, value: "", el });
        afjAttachLearnListener(el, sig);
        needsList.push(afjMakeFieldCandidate(el, sig));
        needs++;
        continue;
      }

      const ok = await afjFillField(el, conv.value, sig);
      if (!ok) {
        AFJ_PANEL.record({ key: afjKeyFor(el), status: "needs", label: sig.rawLabel, value: "", el });
        afjAttachLearnListener(el, sig);
        needsList.push(afjMakeFieldCandidate(el, sig));
        needs++;
        continue;
      }

      if (decision.source === "fuzzy-matched") {
        el.style.outline = "2px solid #bf8700"; // amber: heuristic, double-check
        el.style.outlineOffset = "1px";
        AFJ_PANEL.record({ key: afjKeyFor(el), status: "check", label: sig.rawLabel, value: conv.value, source: decision.source, el });
        afjAttachLearnListener(el, sig); // a correction here overrides the fuzzy guess
        checked++;
      } else {
        AFJ_PANEL.record({ key: afjKeyFor(el), status: "filled", label: sig.rawLabel, value: conv.value, source: decision.source, el });
        afjAttachLearnListener(el, sig);
        filled++;
      }
    } catch (e) {
      console.warn("AutofillJobs: skipped a field after an error", el, e);
    }
    await sleep(delays.short / 2);
  }

  console.log(`AutofillJobs engine pass: ${filled} filled, ${checked} fuzzy, ${needs} manual.`);
  return needsList;
}

/**
 * Run the learning engine over a form, and keep watching it. Re-entrant and safe to invoke
 * repeatedly on the same scope (Workday's per-stage calls, or the debounced observer set up
 * below) — per-element idempotency in afjProcessFields means repeat calls only touch fields
 * that weren't there before.
 *
 * The observer exists because a single one-shot scan misses fields that appear later:
 * repeatable "Add Experience" / "Add Education" sections, accordion reveals, or an SPA
 * swapping content within the same container. Without it, those fields never get a fill
 * attempt AND never get a learn-listener attached — so manually filling them teaches the
 * extension nothing, which is the whole point of the tool.
 *
 * @param form scope element (or null for whole document)
 * @param host current hostname (unused for now; reserved for site quirks)
 * @param res  profile values (chrome.storage.sync)
 */
// Cosine similarity, on the local MiniLM embeddings, above which two differently-worded
// labels are treated as "the same question" — calibrated against the project's own hard
// case (a statutory-auditor question reworded as an external-auditor question) which
// scores well above this; unrelated questions score well below it.
const AFJ_EMBED_SIM_THRESHOLD = 0.6;

// Words that commonly differentiate two otherwise near-identical field labels (First/Last
// Name, Home/Work Phone, Current/Previous Employer, Address Line 1/2). Real-model
// calibration (test/embedding-quality-check.mjs) showed embeddings badly fail exactly
// these cases: "First Name" vs "Last Name" scores 0.76 and "Address Line 1" vs "Address
// Line 2" scores 0.93 — both well above the match threshold — because the model weights
// shared context so heavily that one distinguishing word doesn't pull the score down
// enough. This is a hard safety gate, not a scoring input: if two labels differ ONLY by a
// digit or a token in this set, they are never treated as the same field, no matter how
// high the embedding similarity scores.
const AFJ_DISTINGUISHING_QUALIFIERS = new Set([
  "first", "last", "middle", "preferred", "full", "primary", "secondary", "line",
  "home", "work", "mobile", "current", "previous", "permanent", "temporary",
  "new", "old", "initial", "final", "start", "end", "from", "to", "alternate",
]);

/**
 * True if the only tokens distinguishing labelA's tokens from labelB's are digits or
 * known differentiating qualifiers — i.e. these are almost certainly two DIFFERENT fields
 * despite whatever similarity score they got.
 */
function afjDiffersOnlyByQualifier(tokensA, tokensB) {
  const a = new Set(tokensA || []);
  const b = new Set(tokensB || []);
  const onlyInA = [...a].filter((t) => !b.has(t));
  const onlyInB = [...b].filter((t) => !a.has(t));
  const diffTokens = onlyInA.concat(onlyInB);
  if (!diffTokens.length) return false; // identical token sets — not "differing" at all
  if (diffTokens.length > 3) return false; // too different to be a near-duplicate pair
  return diffTokens.every((t) => /^\d+$/.test(t) || AFJ_DISTINGUISHING_QUALIFIERS.has(t));
}

let afjEmbedFallbackRunning = false;

/**
 * Second-chance matcher for fields the fast, synchronous, token-overlap pass found
 * nothing for. Runs asynchronously and is never awaited by the fast pass or the
 * observer loop — embedding inference takes real time (the first call loads the ~23MB
 * model), so this must never sit on the critical, instant-fill path. Compares each
 * unmatched field's label against every learned answer by semantic similarity instead of
 * shared words, catching rewordings the fast matcher misses. Fills are flagged (violet, a
 * distinct color from amber fuzzy-matches) since this is a probabilistic guess.
 */
async function afjRunEmbeddingFallback(needsList, bank) {
  if (typeof afjGetEmbeddings === "undefined") return; // embedding.js not loaded in this context
  if (afjEmbedFallbackRunning || !needsList.length) return;
  const candidates = needsList.filter((c) => !c.marker.__afjEmbedTried);
  if (!candidates.length) return;

  const bankEntries = Object.entries(bank || {}).filter(([, e]) => e && e.value && e.rawLabel);
  if (!bankEntries.length) {
    candidates.forEach((c) => { c.marker.__afjEmbedTried = true; });
    return;
  }

  afjEmbedFallbackRunning = true;
  try {
    const bankEmbeddings = await afjGetEmbeddings(bankEntries.map(([, e]) => e.rawLabel));
    if (!bankEmbeddings) return; // model unavailable right now — try again on a later pass

    for (const cand of candidates) {
      cand.marker.__afjEmbedTried = true;
      try {
        const label = cand.sig.rawLabel || cand.sig.tokens.join(" ");
        if (!label) continue;
        const vecs = await afjGetEmbeddings([label]);
        const vec = vecs && vecs[0];
        if (!vec) continue;

        let best = null, bestScore = 0;
        for (let i = 0; i < bankEntries.length; i++) {
          const entry = bankEntries[i][1];
          if (!fieldTypesCompatible(cand.sig.fieldType, entry.fieldType)) continue;
          if (afjDiffersOnlyByQualifier(cand.sig.tokens, entry.tokens)) continue; // e.g. Address Line 1 vs 2
          const score = afjCosineSimilarity(vec, bankEmbeddings[i]);
          if (score > bestScore) { bestScore = score; best = entry; }
        }
        if (!best || bestScore < AFJ_EMBED_SIM_THRESHOLD) continue;

        // Choice fields must still land on a live option — never force an unmappable value.
        if (CHOICELIKE.has(cand.sig.fieldType) && cand.sig.options && cand.sig.options.length) {
          if (!matchOption(best.value, cand.sig.options)) continue;
        }

        const conv = convertValue(cand.marker, best.value, cand.sig);
        if (!conv.ok || !conv.value) continue;

        const ok = await cand.fill(conv.value);
        if (!ok) continue;

        cand.markCheck(conv.value);
        await upsertLearnedField(cand.sig, conv.value, "embedding-matched");
      } catch (e) {
        console.warn("AutofillJobs: embedding fallback skipped a field after an error", e);
      }
    }
  } finally {
    afjEmbedFallbackRunning = false;
  }
}

async function afjRunAllPasses(scope, res) {
  await afjUploadResume(scope);
  const bank = await getAllLearned();
  const needsA = await afjProcessFields(scope, res, bank);
  const needsB = await afjProcessPillGroups(scope, res, bank);
  // Fire-and-forget: never block the fast pass or the observer's next tick on this.
  afjRunEmbeddingFallback(needsA.concat(needsB), bank);
}

// The one currently-active watch session (observer + interval + the scope they're bound
// to), if any. Content scripts have no idea when a single-page app navigates to a
// completely different route — there's no page reload to reset anything — so without this,
// an engine that activated once on a page that genuinely qualified stays running forever,
// including on every later route the user navigates to client-side. Tracked as a single
// slot (not a list) since only one page/scope is ever meaningfully "the current page" at a
// time in a single tab.
let AFJ_ACTIVE_SESSION = null;

/**
 * Stops watching, forgets the current session, and removes the review panel — called when
 * an SPA route change means the page the engine was watching isn't "the current page"
 * anymore, and the new one doesn't look like a job application either. Safe to call even
 * when nothing is active.
 */
function afjTeardownEngine() {
  if (AFJ_ACTIVE_SESSION) {
    const { scope, observer, intervalId } = AFJ_ACTIVE_SESSION;
    observer.disconnect();
    clearInterval(intervalId);
    if (scope) scope.__afjObserverBound = false;
    AFJ_ACTIVE_SESSION = null;
  }
  const host = document.getElementById("afj-review-host");
  if (host) host.remove();
  if (typeof AFJ_PANEL !== "undefined") AFJ_PANEL.reset();
}

async function runLearningEngine(form, host, res) {
  const scope = form || document.querySelector("form") || document.body;

  await afjRunAllPasses(scope, res);

  if (scope.__afjObserverBound) return;
  scope.__afjObserverBound = true;

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    // The extension may have been reloaded/updated since this script was injected — Chrome
    // doesn't tear down a content script already running in an open tab, it just makes its
    // chrome.* calls throw. Once that's true there's nothing more this instance can usefully
    // do, so stop watching instead of continuing to fire (harmlessly, but pointlessly) on
    // every future DOM mutation for the life of the tab.
    if (!afjExtensionContextValid()) { observer.disconnect(); return; }
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => afjRunAllPasses(scope, res), 400);
  });
  observer.observe(scope, { childList: true, subtree: true });

  // Safety net alongside the mutation observer, not a replacement for it: some SPA
  // rendering patterns (e.g. a framework replacing a subtree wholesale rather than
  // patching it, or attribute-only changes that don't trigger childList/subtree
  // callbacks) can leave new fields unnoticed by the observer alone. A cheap periodic
  // re-scan is idempotent (afjProcessFields/afjProcessPillGroups skip already-processed
  // elements), so this costs nothing when there's nothing new, and guarantees the page is
  // eventually fully scanned even if a mutation event was missed. Bounded, not forever.
  let ticks = 0;
  const intervalId = setInterval(() => {
    ticks++;
    if (ticks > 40 || !document.contains(scope) || !afjExtensionContextValid()) {
      clearInterval(intervalId);
      observer.disconnect();
      return;
    }
    afjRunAllPasses(scope, res);
  }, 3000);

  AFJ_ACTIVE_SESSION = { scope, observer, intervalId };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { afjLooksLikeResumeLabel, afjDiffersOnlyByQualifier };
}
