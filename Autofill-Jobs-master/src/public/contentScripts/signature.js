/*
  signature.js — field signature generation.

  A "signature" is a stable, lookup-friendly fingerprint of a form field derived from its
  visible label + input type (+ option list for selects/radios). It is the key the learning
  store and matcher use to recognise the same question across different company portals.

  Design notes:
   - Exact-match key = FNV-1a hash of (sorted normalized label tokens + fieldType). Sorting
     tokens means word-order variations of the *same* wording still collide. Different
     wording produces different tokens -> handled by fuzzy matching (matcher.js), not here.
   - The option list is deliberately NOT part of the hash: the same question is worded with
     different enum values across ATSes (Yes/No vs Y/N vs Agree/Disagree), and we still want
     an exact label hit. Options are kept for the format-precision layer instead.
   - Pure string helpers (normalize/tokenize/hash/labelTokens) avoid the DOM and `chrome.*`
     so they can be unit-tested in Node; the DOM readers are only called in the browser.
*/

// Words that carry no discriminating meaning in a form label. Kept small on purpose — an
// over-aggressive stoplist collapses distinct questions together.
const SIG_STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "or", "is", "are", "be", "been",
  "was", "were", "do", "does", "did", "you", "your", "yours", "please", "if", "any", "at",
  "by", "with", "as", "this", "that", "these", "those", "we", "our", "us", "will", "would",
  "have", "has", "had", "select", "choose", "enter", "provide", "required", "optional",
]);

/**
 * Normalize a raw label into a clean lowercased string: strip accents, drop the trailing
 * required-marker, replace non-alphanumerics with spaces, collapse whitespace.
 */
function normalizeLabel(raw) {
  if (!raw) return "";
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")          // strip diacritics
    .toLowerCase()
    .replace(/\(\s*required\s*\)/g, " ")       // "(required)"
    .replace(/\*+/g, " ")                      // required asterisks
    .replace(/[^a-z0-9]+/g, " ")               // punctuation -> space
    .replace(/\s+/g, " ")
    .trim();
}

/** Tokenize a normalized label into a de-duplicated, stopword-stripped token list. */
function labelTokens(raw) {
  const norm = normalizeLabel(raw);
  if (!norm) return [];
  const seen = new Set();
  const out = [];
  for (const tok of norm.split(" ")) {
    if (!tok || SIG_STOPWORDS.has(tok)) continue;
    if (seen.has(tok)) continue;
    seen.add(tok);
    out.push(tok);
  }
  return out;
}

/** FNV-1a 32-bit hash -> 8-char hex. Deterministic, no crypto, offline. */
function hashSignature(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    // h *= 16777619, done with shifts to stay in 32-bit unsigned range
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return ("0000000" + h.toString(16)).slice(-8);
}

/**
 * Build the exact-match hash from a token list + field type. Tokens are sorted so word
 * order does not matter; field type is included so a value is never keyed to an
 * incompatible widget (a text answer vs a select answer of the same label stay distinct
 * for exact match, and are reconciled by fuzzy matching + type gating instead).
 */
function signatureHash(tokens, fieldType) {
  const key = tokens.slice().sort().join(" ") + "|" + (fieldType || "text");
  return hashSignature(key);
}

/* ------------------------------------------------------------------ */
/* DOM readers (browser-only)                                          */
/* ------------------------------------------------------------------ */

function sigTextContent(el) {
  return (el && (el.textContent || "")).replace(/\s+/g, " ").trim();
}

/** Resolve one or more ids (space-separated) to their combined text. */
function sigTextFromIds(ids) {
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => {
      const node = document.getElementById(id);
      return node ? sigTextContent(node) : "";
    })
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** True when el is a radio input (radios are always part of a named group). */
function sigIsRadio(el) {
  return (
    el.tagName &&
    el.tagName.toLowerCase() === "input" &&
    (el.getAttribute("type") || "").toLowerCase() === "radio"
  );
}

/**
 * The option label of a single radio/checkbox (e.g. "Yes") — its own wrapping label or
 * adjacent text. Distinct from the group question, which getFieldLabel() returns.
 */
function getOptionLabel(el) {
  if (!el) return "";
  const wrapping = el.closest("label");
  if (wrapping) {
    const clone = wrapping.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    const t = sigTextContent(clone);
    if (t) return t;
  }
  const aria = (el.getAttribute("aria-label") || "").trim();
  if (aria) return aria;
  // text immediately following the control
  const sib = el.nextSibling;
  if (sib && sib.nodeType === 3) {
    const t = sib.textContent.replace(/\s+/g, " ").trim();
    if (t) return t;
  }
  return (el.value || "").trim();
}

/**
 * The group-level question for a radio group (or role=group/radiogroup): the fieldset
 * legend, an aria label, or the nearest preceding heading — never the per-option text.
 */
function getGroupLabel(el) {
  const byId = sigTextFromIds(el.getAttribute("aria-labelledby"));
  if (byId) return byId;

  const fieldset = el.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend");
    const t = sigTextContent(legend);
    if (t) return t;
  }
  const group = el.closest('[role="radiogroup"], [role="group"]');
  if (group) {
    const al = (group.getAttribute("aria-label") || "").trim();
    if (al) return al;
    const lbl = sigTextFromIds(group.getAttribute("aria-labelledby"));
    if (lbl) return lbl;
  }
  // Walk up for a preceding heading/label near the group.
  let node = el.closest("fieldset") || el;
  for (let depth = 0; depth < 4 && node; depth++) {
    let s = node.previousElementSibling;
    while (s) {
      if (/^(label|legend|h1|h2|h3|h4|h5|h6|p|span|div)$/i.test(s.tagName)) {
        const t = sigTextContent(s);
        if (t && t.length <= 200) return t;
      }
      s = s.previousElementSibling;
    }
    node = node.parentElement;
  }
  return (el.getAttribute("name") || "").trim();
}

/**
 * Discover the human-visible label for a field, trying the most reliable sources first.
 * Returns "" if nothing usable is found.
 */
function getFieldLabel(el) {
  if (!el) return "";

  // Radios: the wrapping <label> is the option text, so key on the group question instead.
  if (sigIsRadio(el)) return getGroupLabel(el);

  // 1. aria-labelledby (resolve referenced nodes)
  const byId = sigTextFromIds(el.getAttribute("aria-labelledby"));
  if (byId) return byId;

  // 2. <label for="id">
  if (el.id) {
    try {
      const forLabel = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (forLabel) {
        const t = sigTextContent(forLabel);
        if (t) return t;
      }
    } catch (_) {
      /* invalid id for selector — ignore */
    }
  }

  // 3. wrapping <label>
  const wrapping = el.closest("label");
  if (wrapping) {
    // Clone and remove the control itself so we don't capture the input's own value/text.
    const clone = wrapping.cloneNode(true);
    clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
    const t = sigTextContent(clone);
    if (t) return t;
  }

  // 4. aria-label
  const ariaLabel = (el.getAttribute("aria-label") || "").trim();
  if (ariaLabel) return ariaLabel;

  // 5. fieldset > legend (covers radio/checkbox groups)
  const fieldset = el.closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend");
    const t = sigTextContent(legend);
    if (t) return t;
  }

  // 6. Workday / QA attributes
  const dataLabel =
    el.getAttribute("data-automation-label") ||
    el.getAttribute("data-qa") ||
    el.getAttribute("data-automation-id");
  if (dataLabel) return dataLabel;

  // 7. placeholder / name / title as weak fallbacks
  const placeholder = (el.getAttribute("placeholder") || "").trim();
  if (placeholder) return placeholder;

  // 8. Nearest preceding text: walk up, look at previous siblings for a label-ish node.
  let node = el;
  for (let depth = 0; depth < 4 && node; depth++) {
    let sib = node.previousElementSibling;
    while (sib) {
      if (/^(label|legend|h1|h2|h3|h4|h5|h6|p|span|div)$/i.test(sib.tagName)) {
        const t = sigTextContent(sib);
        if (t && t.length <= 200) return t;
      }
      sib = sib.previousElementSibling;
    }
    node = node.parentElement;
  }

  // 9. last resort: the control's own name/id
  return (el.getAttribute("name") || el.id || "").trim();
}

/** Classify a field element into one of our coarse types. */
function getFieldType(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") return "select";
  if (tag === "textarea") return "textarea";
  if (tag === "input") {
    const type = (el.getAttribute("type") || "text").toLowerCase();
    if (type === "file") return "file";
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "date" || type === "month" || type === "week") return "date";
    return "text";
  }
  // Custom widgets (combobox/listbox) surface as buttons/divs with roles.
  const role = (el.getAttribute("role") || "").toLowerCase();
  if (role === "combobox" || role === "listbox") return "select";
  return "text";
}

/** Extract the visible option list for a select or radio group; [] otherwise. */
function getFieldOptions(el) {
  const tag = el.tagName.toLowerCase();
  if (tag === "select") {
    return Array.from(el.options)
      .map((o) => (o.textContent || o.value || "").trim())
      .filter(Boolean);
  }
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (type === "radio" && el.name) {
    const group = document.querySelectorAll(
      `input[type="radio"][name="${CSS.escape(el.name)}"]`
    );
    return Array.from(group)
      .map((r) => getOptionLabel(r))
      .filter(Boolean);
  }
  return [];
}

/**
 * Generate the full signature object for a field element.
 * @returns {{rawLabel,normalized,tokens,fieldType,options,hash}}
 */
function generateSignature(el) {
  const rawLabel = getFieldLabel(el);
  const fieldType = getFieldType(el);
  const tokens = labelTokens(rawLabel);
  const options = getFieldOptions(el);
  return {
    rawLabel: rawLabel,
    normalized: normalizeLabel(rawLabel),
    tokens: tokens,
    fieldType: fieldType,
    options: options,
    hash: signatureHash(tokens, fieldType),
  };
}

// Expose pure helpers for Node unit tests without disturbing browser globals.
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    normalizeLabel,
    labelTokens,
    hashSignature,
    signatureHash,
    SIG_STOPWORDS,
  };
}
