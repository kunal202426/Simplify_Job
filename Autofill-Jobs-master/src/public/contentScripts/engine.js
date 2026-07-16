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

/** Read the current value of a field for "already filled?" checks and for learning. */
function afjReadValue(el, sig) {
  const type = sig.fieldType;
  if (type === "checkbox") return el.checked ? (el.value || "true") : "";
  if (type === "radio") {
    if (!el.name) return el.checked ? afjRadioLabel(el) : "";
    const group = document.querySelectorAll(
      `input[type="radio"][name="${CSS.escape(el.name)}"]`
    );
    for (const r of group) if (r.checked) return afjRadioLabel(r);
    return "";
  }
  if (el.tagName.toLowerCase() === "select") {
    const opt = el.options[el.selectedIndex];
    // Treat placeholder first option ("", "Select...") as empty.
    if (!opt || el.selectedIndex <= 0) {
      const t = opt ? (opt.textContent || "").trim() : "";
      if (!t || /^(select|choose|please)/i.test(t)) return "";
    }
    return (opt.textContent || opt.value || "").trim();
  }
  return (el.value || "").trim();
}

function afjRadioLabel(radio) {
  // The selected VALUE is the option's own text ("Yes"), not the group question.
  return getOptionLabel(radio) || radio.value || "";
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
    ? document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`)
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

/* ---------------- learning ---------------- */

function afjAttachLearnListener(el, sig) {
  // The representative element (el) owns the panel row + signature; but for a radio group
  // we must listen on every radio, since only the newly-checked one fires 'change'.
  const listenTargets =
    sig.fieldType === "radio" && el.name
      ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(el.name)}"]`))
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

/* ---------------- field enumeration ---------------- */

/** Collect fillable fields, collapsing radio groups to a single representative element. */
function afjCollectFields(form) {
  const scope = form || document;
  const out = [];
  const seenRadioGroups = new Set();
  scope.querySelectorAll("input, select, textarea").forEach((el) => {
    if (!afjIsFillable(el)) return;
    const type = (el.getAttribute("type") || "").toLowerCase();
    if (type === "radio" && el.name) {
      if (seenRadioGroups.has(el.name)) return;
      seenRadioGroups.add(el.name);
    }
    out.push(el);
  });
  return out;
}

/* ---------------- main entry ---------------- */

/**
 * Run the learning engine over a form.
 * @param form scope element (or null for whole document)
 * @param host current hostname (unused for now; reserved for site quirks)
 * @param res  profile values (chrome.storage.sync)
 */
async function runLearningEngine(form, host, res) {
  const scope = form || document.querySelector("form") || document.body;
  if (scope.__afjEngineRan) return;
  scope.__afjEngineRan = true;

  const bank = await getAllLearned();
  const fields = afjCollectFields(scope);
  let filled = 0, checked = 0, needs = 0;

  for (const el of fields) {
    const sig = generateSignature(el);
    if (!sig.tokens.length && !sig.rawLabel) continue; // nothing to key on

    // Already has a value (e.g. filled by the profile pass or pre-populated).
    const existing = afjReadValue(el, sig);
    if (existing) {
      AFJ_PANEL.record({ key: afjKeyFor(el), status: "filled", label: sig.rawLabel, value: existing, el });
      afjAttachLearnListener(el, sig); // learn user corrections
      filled++;
      continue;
    }

    const decision = matchField(sig, res, bank, matchOption);

    if (decision.source === "none") {
      AFJ_PANEL.record({ key: afjKeyFor(el), status: "needs", label: sig.rawLabel, value: "", el });
      afjAttachLearnListener(el, sig);
      needs++;
      continue;
    }

    // Reshape to the field's format before inserting.
    const conv = convertValue(el, decision.value, sig);
    if (!conv.ok || conv.value == null || conv.value === "") {
      AFJ_PANEL.record({ key: afjKeyFor(el), status: "needs", label: sig.rawLabel, value: "", el });
      afjAttachLearnListener(el, sig);
      needs++;
      continue;
    }

    const ok = await afjFillField(el, conv.value, sig);
    if (!ok) {
      AFJ_PANEL.record({ key: afjKeyFor(el), status: "needs", label: sig.rawLabel, value: "", el });
      afjAttachLearnListener(el, sig);
      needs++;
      continue;
    }

    if (decision.source === "fuzzy-matched") {
      el.style.outline = "2px solid #bf8700"; // amber: heuristic, double-check
      el.style.outlineOffset = "1px";
      AFJ_PANEL.record({ key: afjKeyFor(el), status: "check", label: sig.rawLabel, value: conv.value, el });
      afjAttachLearnListener(el, sig); // a correction here overrides the fuzzy guess
      checked++;
    } else {
      AFJ_PANEL.record({ key: afjKeyFor(el), status: "filled", label: sig.rawLabel, value: conv.value, el });
      afjAttachLearnListener(el, sig);
      filled++;
    }
    await sleep(delays.short / 2);
  }

  AFJ_PANEL.note(`${filled} filled · ${checked} to check · ${needs} need you`);
  console.log(`AutofillJobs engine: ${filled} filled, ${checked} fuzzy, ${needs} manual.`);
}
