/*
  formatConvert.js — the format-precision layer.

  Before any matched value is inserted, we reshape it to the target field's actual
  constraints instead of blindly writing the stored canonical string:
   - selects/radios: map the canonical value to one of the field's *live* options
     (Yes/No vs Y/N vs Agree/Disagree; "Decline to self identify" vs "Prefer not to say").
   - dates: detect the expected pattern (pattern attr / placeholder / hint text / native
     input type) and convert the stored date to match (Jun 2022 -> 06/2022 or 2022-06).
   - phone/text: apply separator hints.

  `convertValue()` returns { value, ok }. ok=false means we could not confidently map the
  value (e.g. no matching option) — the engine then leaves the field flagged for the user,
  exactly like an unmatched field, rather than forcing a wrong value.

  Pure cores (matchOption / formatDateToPattern / parseCanonicalDate / formatPhone) avoid
  the DOM so they can be unit-tested in Node.
*/

const MONTH_INDEX = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9,
  september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_SHORT = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_LONG = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function _norm(s) {
  return (s == null ? "" : String(s)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/* ---------------- option matching (selects / radios) ---------------- */

// Canonical intent buckets: if the value maps to a bucket, any option that also maps to the
// same bucket is an acceptable target even when the surface wording differs.
const OPTION_SYNONYMS = [
  { bucket: "yes", terms: ["yes", "y", "true", "agree", "i agree", "i consent", "consent"] },
  { bucket: "no", terms: ["no", "n", "false", "disagree", "i disagree", "i do not consent"] },
  {
    bucket: "decline",
    terms: [
      "decline", "decline to self identify", "prefer not to say", "prefer not to answer",
      "i don t wish to answer", "i do not want to answer", "i do not wish to answer",
      "not to answer", "choose not to disclose", "do not want to answer",
    ],
  },
];

// Whole-phrase (word-boundary) containment, so "disagree" is NOT treated as containing
// "agree" and "i agree to the terms" still matches "agree".
function _phraseMatch(normValue, term) {
  const nt = _norm(term);
  if (!nt) return false;
  if (normValue === nt) return true;
  return (" " + normValue + " ").includes(" " + nt + " ");
}

function _bucketOf(normValue) {
  for (const syn of OPTION_SYNONYMS) {
    for (const t of syn.terms) {
      if (_phraseMatch(normValue, t)) return syn.bucket;
    }
  }
  return null;
}

// Whole-word containment (space-padded, like _phraseMatch above) rather than a raw
// substring test — "india" is a raw substring of "british indian ocean territory" (it's the
// first five letters of "indian"), which would otherwise confidently select the wrong
// country/territory. Requiring a real word boundary rejects that while still matching
// genuine partial phrases like "bachelor" inside "bachelor s degree".
function _wordBoundaryContains(haystack, needle) {
  if (!haystack || !needle) return false;
  if (haystack === needle) return true;
  return (" " + haystack + " ").includes(" " + needle + " ");
}

function _tokenSet(s) {
  return new Set(_norm(s).split(" ").filter(Boolean));
}
function _jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

/**
 * Map a canonical value to the best option from `options`. Returns the exact option string,
 * or null if nothing clears the confidence bar.
 */
function matchOption(value, options) {
  if (!options || !options.length) return null;
  const nv = _norm(value);
  if (!nv) return null;

  // 1. exact normalized equality
  for (const opt of options) if (_norm(opt) === nv) return opt;

  // 2. synonym bucket agreement
  const vb = _bucketOf(nv);
  if (vb) {
    for (const opt of options) if (_bucketOf(_norm(opt)) === vb) return opt;
  }

  // 3. whole-word containment either direction. A raw substring test is dangerous for
  // enumerated proper nouns — "india" is literally the first five letters of "indian" (as in
  // "British Indian Ocean Territory"), and the same shape recurs constantly across real
  // country/territory lists (Niger/Nigeria, Congo/Republic of the Congo, Sudan/South Sudan,
  // Korea/North Korea, Guinea/Guinea-Bissau, Ireland/Northern Ireland). Requiring a real word
  // boundary on both sides rejects all of those while still matching genuine partial phrases
  // ("Bachelor" inside "Bachelor's Degree"). Both sides must also be reasonably specific — a
  // short, generic value like "no" is trivially a whole word inside far too many unrelated
  // options and would otherwise be confidently wrong instead of just unmatched; genuine
  // yes/no-shaped answers are already resolved by the bucket check above.
  if (nv.length >= 4) {
    for (const opt of options) {
      const no = _norm(opt);
      if (no.length >= 4 && (_wordBoundaryContains(no, nv) || _wordBoundaryContains(nv, no))) return opt;
    }
  }

  // 4. token-overlap fallback
  const vSet = _tokenSet(value);
  let best = null;
  let bestScore = 0;
  for (const opt of options) {
    const score = _jaccard(vSet, _tokenSet(opt));
    if (score > bestScore) {
      bestScore = score;
      best = opt;
    }
  }
  return bestScore >= 0.5 ? best : null;
}

/* ---------------- date conversion ---------------- */

/** Parse a stored canonical date into {year, month, day} (month/day may be null). */
function parseCanonicalDate(value) {
  if (!value) return null;
  const s = String(value).trim();
  let m;

  // ISO: 2022-06 or 2022-06-15
  if ((m = s.match(/^(\d{4})-(\d{1,2})(?:-(\d{1,2}))?$/))) {
    return { year: +m[1], month: +m[2], day: m[3] ? +m[3] : null };
  }
  // Month name + year: "Jun 2022", "June 2022"
  if ((m = s.match(/^([A-Za-z]{3,9})\.?\s+(\d{4})$/))) {
    const mo = MONTH_INDEX[m[1].toLowerCase()];
    if (mo) return { year: +m[2], month: mo, day: null };
  }
  // "15 June 2022" / "15 Jun 2022"
  if ((m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,9})\.?\s+(\d{4})$/))) {
    const mo = MONTH_INDEX[m[2].toLowerCase()];
    if (mo) return { year: +m[3], month: mo, day: +m[1] };
  }
  // Numeric MM/YYYY or MM-YYYY (2-part)
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{4})$/))) {
    return { year: +m[2], month: +m[1], day: null };
  }
  // Numeric 3-part. The app's own canonical (curDateStr) is en-GB dd/mm/yyyy, so treat
  // ambiguous d/m/y that way; fall back to m/d/y only when the first part can't be a day.
  if ((m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/))) {
    let a = +m[1], b = +m[2];
    let day, month;
    if (a > 12 && b <= 12) { day = a; month = b; }
    else if (b > 12 && a <= 12) { month = a; day = b; }
    else { day = a; month = b; } // default dd/mm/yyyy
    return { year: +m[3], month: month, day: day };
  }
  // Year only
  if ((m = s.match(/^(\d{4})$/))) return { year: +m[1], month: null, day: null };
  return null;
}

/**
 * Render date components into a pattern string (e.g. "mm/dd/yyyy", "MMM YYYY", "yyyy-mm").
 * Token runs are replaced longest-first; separators are preserved.
 */
function formatDateToPattern(parts, pattern) {
  if (!parts || !pattern) return null;
  const mm = parts.month != null ? String(parts.month).padStart(2, "0") : "";
  const dd = parts.day != null ? String(parts.day).padStart(2, "0") : "";
  const yyyy = parts.year != null ? String(parts.year) : "";
  const yy = yyyy ? yyyy.slice(-2) : "";
  const mLong = parts.month != null ? MONTH_LONG[parts.month] : "";
  const mShort = parts.month != null ? MONTH_SHORT[parts.month] : "";

  // Work on a lowercased copy for token detection; emit real values.
  return pattern.replace(/m{1,4}|d{1,2}|y{2,4}/gi, (tok) => {
    const t = tok.toLowerCase();
    switch (t) {
      case "yyyy": return yyyy;
      case "yy": return yy;
      case "mmmm": return mLong;
      case "mmm": return mShort;
      case "mm": return mm;
      case "m": return parts.month != null ? String(parts.month) : "";
      case "dd": return dd;
      case "d": return parts.day != null ? String(parts.day) : "";
      default: return tok;
    }
  });
}

/** Does a string look like a date-format hint? (contains y/m/d token runs + a separator) */
function looksLikeDatePattern(s) {
  if (!s) return false;
  const low = s.toLowerCase();
  return /(y{2,4}|m{1,4}|d{1,2})/.test(low) && /[\/\-.]/.test(low) === /[\/\-.]/.test(low) &&
    /(yy|mm|dd|yyyy|mmm)/.test(low);
}

/* ---------------- phone / text separators ---------------- */

/** Reformat a phone number's digits to a separator hint like "___-___-____". */
function formatPhone(value, hint) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (!hint || !digits) return value;
  // If the hint has grouping via non-digit separators, apply the grouping sizes.
  const groups = hint.split(/[^#0-9xX_]+/).filter(Boolean).map((g) => g.length);
  const seps = hint.match(/[^#0-9xX_]+/g) || [];
  if (!groups.length) return value;
  let out = "";
  let idx = 0;
  const bareDigits = digits.replace(/^\+/, "");
  for (let i = 0; i < groups.length && idx < bareDigits.length; i++) {
    out += bareDigits.slice(idx, idx + groups[i]);
    idx += groups[i];
    if (i < seps.length && idx < bareDigits.length) out += seps[i];
  }
  if (idx < bareDigits.length) out += bareDigits.slice(idx);
  return (digits[0] === "+" ? "+" : "") + out;
}

/* ---------------- DOM-facing entry point (browser only) ---------------- */

/** Collect format hints from a field's attributes and nearby text. */
function _collectHints(el) {
  const hints = [];
  const ph = el.getAttribute && el.getAttribute("placeholder");
  if (ph) hints.push(ph);
  const pat = el.getAttribute && el.getAttribute("pattern");
  if (pat) hints.push(pat);
  const title = el.getAttribute && el.getAttribute("title");
  if (title) hints.push(title);
  const describedby = el.getAttribute && el.getAttribute("aria-describedby");
  if (describedby && typeof document !== "undefined") {
    describedby.split(/\s+/).forEach((id) => {
      const n = document.getElementById(id);
      if (n && n.textContent) hints.push(n.textContent.trim());
    });
  }
  return hints;
}

function _detectDatePattern(el, sig) {
  for (const h of _collectHints(el)) {
    const cand = (h.match(/[ymd]{1,4}[\/\-.][ymd\/\-.]+/i) || [])[0] || h;
    if (looksLikeDatePattern(cand)) return cand.trim();
  }
  // The expected format is very often spelled out right in the visible label itself
  // ("Start Date (MM/YYYY)", "Graduation Date (mm/dd/yyyy)") rather than in an attribute —
  // sig was always passed in here but never actually read, so that common case was silently
  // skipped. Unlike the attribute hints above, this must NOT fall back to testing the WHOLE
  // label when no separator-containing match is found in it: ordinary English words
  // routinely contain incidental "mm"/"dd"-shaped substrings ("address", "middle",
  // "committee", even "email" itself contains a lone "m") that looksLikeDatePattern's loose
  // thresholds misread as a date format once given free rein over an entire label — only a
  // real slash/dash/dot-separated run extracted FROM the label is trustworthy here.
  if (sig && sig.rawLabel) {
    const m = sig.rawLabel.match(/[ymd]{1,4}[\/\-.][ymd\/\-.]+/i);
    if (m && looksLikeDatePattern(m[0])) return m[0].trim();
  }
  // native inputs
  const type = (el.getAttribute && (el.getAttribute("type") || "")).toLowerCase();
  if (type === "month") return "yyyy-mm";
  if (type === "date") return "yyyy-mm-dd";
  return null;
}

/**
 * Convert a canonical value for insertion into `el`.
 * @returns {{value: string|null, ok: boolean}}
 */
function convertValue(el, value, sig) {
  if (value == null || value === "") return { value: value, ok: false };
  const type = sig ? sig.fieldType : "text";

  // Selects / radios: must land on a live option.
  if (type === "select" || type === "radio" || (sig && sig.options && sig.options.length)) {
    const opt = matchOption(value, (sig && sig.options) || []);
    if (opt) return { value: opt, ok: true };
    // No option list available yet (custom combobox) — pass the raw value through and let
    // the engine's option-picking handle it at click time.
    if (!sig || !sig.options || !sig.options.length) return { value: value, ok: true };
    return { value: null, ok: false };
  }

  // Dates
  const datePattern = _detectDatePattern(el, sig);
  if (datePattern) {
    const parts = parseCanonicalDate(value);
    if (parts) {
      const formatted = formatDateToPattern(parts, datePattern);
      if (formatted) return { value: formatted, ok: true };
    }
    // Could not parse the stored date to the required shape — flag rather than force.
    return { value: null, ok: false };
  }

  // Phone
  const nameHint = _norm((el.getAttribute && (el.getAttribute("name") || el.id)) || "");
  const isPhone = /phone|tel|mobile/.test(nameHint) || (sig && /phone|tel|mobile/.test(sig.normalized || ""));
  if (isPhone) {
    for (const h of _collectHints(el)) {
      if (/[#_0-9][^0-9a-z]+[#_0-9]/i.test(h)) return { value: formatPhone(value, h), ok: true };
    }
    // No explicit separator hint. A phone field with no formatting cue is commonly paired
    // with a separate country-code selector and rejects anything but the bare local
    // number — a stored value like "+919876543210" fails that field's "digits only"
    // validation even though it works fine as a single combined phone box elsewhere. Default
    // to bare digits, and drop a leading country-code prefix by keeping just the last 10
    // (the standard local mobile/landline length in India, the US, the UK, and most others).
    const bareDigits = String(value).replace(/\D/g, "");
    if (bareDigits) return { value: bareDigits.length > 10 ? bareDigits.slice(-10) : bareDigits, ok: true };
  }

  return { value: value, ok: true };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    matchOption,
    parseCanonicalDate,
    formatDateToPattern,
    looksLikeDatePattern,
    formatPhone,
    convertValue,
  };
}
