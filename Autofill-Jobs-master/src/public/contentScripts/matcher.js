/*
  matcher.js — the matching pipeline.

  Given a field signature, decide what (if anything) to fill and where the answer came
  from, in strict priority order:

    1. exact  — signature hash present in the learned bank (instant, no computation)
    2. profile— maps to a stored profile field (identity/contact/socials), site-agnostic
    3. fuzzy  — token-overlap (Jaccard) against the learned bank above a threshold, gated
                on field-type compatibility and, for choice fields, live-option availability
    4. none   — leave empty; the engine flags it for manual input and learns the answer

  Returns { value, source, confidence, entry }. `source` is one of
  "learned-exact" | "profile" | "fuzzy-matched" | "none".

  Pure — no DOM, no chrome.* — so it is unit-testable in Node.
*/

const FUZZY_AUTO_THRESHOLD = 0.6; // fill automatically at/above this Jaccard (flagged amber)
const PROFILE_THRESHOLD = 0.6;

function _tset(tokens) {
  return new Set((tokens || []).filter(Boolean));
}
function _interCount(a, b) {
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter;
}
function jaccardTokens(aTokens, bTokens) {
  const a = _tset(aTokens);
  const b = _tset(bTokens);
  if (!a.size || !b.size) return 0;
  const inter = _interCount(a, b);
  return inter / (a.size + b.size - inter);
}

/**
 * Similarity for reworded questions. Uses the overlap coefficient (|A∩B| / min(|A|,|B|))
 * rather than plain Jaccard, because the same question is often phrased more verbosely on
 * one portal than another (e.g. the statutory-vs-external auditor question) — Jaccard
 * punishes that length gap, overlap does not. Returns 0 unless the match clears a guard
 * that blocks a single generic shared token (like "name") from linking two long labels:
 * when both labels have >1 meaningful token, at least 2 must be shared.
 */
function labelSimilarity(aTokens, bTokens) {
  const a = _tset(aTokens);
  const b = _tset(bTokens);
  if (!a.size || !b.size) return 0;
  const inter = _interCount(a, b);
  if (inter === 0) return 0;
  const minSize = Math.min(a.size, b.size);
  const need = Math.min(2, minSize);
  if (inter < need) return 0;
  return inter / minSize;
}

// text-like widgets accept the same kinds of values; choice-like widgets are separate.
const TEXTLIKE = new Set(["text", "textarea", "date", "email", "tel", "number"]);
const CHOICELIKE = new Set(["select", "radio", "checkbox"]);

function fieldTypesCompatible(a, b) {
  if (a === b) return true;
  if (TEXTLIKE.has(a) && TEXTLIKE.has(b)) return true;
  if (CHOICELIKE.has(a) && CHOICELIKE.has(b)) return true;
  return false;
}

/* ---------------- profile matching ---------------- */

// Curated, high-precision rules mapping a field signature to a stored profile key. Each
// rule requires every token in `all` and at least one in `any` (when present) to appear in
// the signature tokens. Kept conservative so we never mis-route identity fields.
const PROFILE_MATCHERS = [
  { key: "Email", any: ["email", "mail"] },
  { key: "First Name", all: ["first"], any: ["name", "given"] },
  { key: "Last Name", all: ["last"], any: ["name", "surname", "family"] },
  { key: "Last Name", all: ["surname"] },
  { key: "Full Name", all: ["full"], any: ["name"] },
  { key: "Preferred Name", all: ["preferred"], any: ["name"] },
  { key: "Phone", any: ["phone", "mobile", "telephone", "cell"] },
  { key: "LinkedIn", any: ["linkedin"] },
  { key: "Github", any: ["github"] },
  { key: "Twitter/X", any: ["twitter"] },
  { key: "Website", any: ["website", "portfolio"] },
  { key: "Current Employer", all: ["current"], any: ["employer", "company"] },
  { key: "School", any: ["school", "university", "college"] },
  { key: "Degree", any: ["degree"] },
  { key: "Discipline", any: ["discipline", "major", "field", "study"] },
  { key: "GPA", any: ["gpa"] },
  { key: "Location (City)", all: ["city"] },
  { key: "Location (State/Region)", any: ["state", "province", "region"] },
  { key: "Location (Country)", all: ["country"] },
  { key: "Location (Street)", any: ["street", "address"] },
  { key: "Postal/Zip Code", any: ["postal", "zip", "postcode"] },
  { key: "Gender", any: ["gender"] },
  { key: "Race", any: ["race", "ethnicity"] },
  { key: "Veteran Status", any: ["veteran"] },
  { key: "Disability Status", any: ["disability"] },
];

function _ruleMatches(rule, tokenSet) {
  if (rule.all) {
    for (const t of rule.all) if (!tokenSet.has(t)) return false;
  }
  if (rule.any) {
    let hit = false;
    for (const t of rule.any) if (tokenSet.has(t)) { hit = true; break; }
    if (!hit) return false;
  }
  return true;
}

/**
 * Try to map a signature to a stored profile value.
 * @param res object of stored profile values keyed by human label (chrome.storage.sync)
 * @returns {value, key, confidence} | null
 */
function matchProfile(sig, res) {
  if (!sig || !res) return null;
  const tokenSet = _tset(sig.tokens);
  if (!tokenSet.size) return null;

  let best = null;
  for (const rule of PROFILE_MATCHERS) {
    const val = res[rule.key];
    if (val == null || val === "") continue;
    if (!_ruleMatches(rule, tokenSet)) continue;
    // Score by how specific the rule is relative to the label, so "first name" prefers the
    // First Name rule over a looser one.
    const ruleTokens = [].concat(rule.all || [], rule.any || []);
    const score = jaccardTokens(sig.tokens, ruleTokens) + (rule.all ? 0.15 : 0);
    if (!best || score > best.confidence) {
      best = { value: val, key: rule.key, confidence: score };
    }
  }
  if (best && best.confidence >= PROFILE_THRESHOLD * 0.5) return best; // rules are already precise
  return null;
}

/* ---------------- fuzzy learned matching ---------------- */

/**
 * Best fuzzy match from the learned bank.
 * @param bank object of learned entries keyed by hash
 * @param optionMatcher optional (value, options) -> option|null used to gate choice fields
 * @returns {value, confidence, entry, hash} | null
 */
function matchLearned(sig, bank, optionMatcher) {
  if (!sig || !bank) return null;
  let best = null;
  for (const hash in bank) {
    const entry = bank[hash];
    if (!entry || entry.value == null || entry.value === "") continue;
    if (!fieldTypesCompatible(sig.fieldType, entry.fieldType)) continue;

    const score = labelSimilarity(sig.tokens, entry.tokens);
    if (score < FUZZY_AUTO_THRESHOLD) continue;

    // For choice targets, the learned value must land on a live option.
    if (CHOICELIKE.has(sig.fieldType) && sig.options && sig.options.length && optionMatcher) {
      if (!optionMatcher(entry.value, sig.options)) continue;
    }
    if (!best || score > best.confidence) {
      best = { value: entry.value, confidence: score, entry: entry, hash: hash };
    }
  }
  return best;
}

/**
 * Full pipeline. Exact hash first, then profile, then fuzzy learned, else none.
 * @param optionMatcher optional gate for choice fields (formatConvert.matchOption)
 */
function matchField(sig, res, bank, optionMatcher) {
  // 1. exact learned
  if (bank && bank[sig.hash]) {
    const e = bank[sig.hash];
    return { value: e.value, source: "learned-exact", confidence: 1, entry: e };
  }
  // 2. profile
  const prof = matchProfile(sig, res);
  if (prof) {
    return { value: prof.value, source: "profile", confidence: prof.confidence, profileKey: prof.key };
  }
  // 3. fuzzy learned
  const fuzzy = matchLearned(sig, bank, optionMatcher);
  if (fuzzy) {
    return { value: fuzzy.value, source: "fuzzy-matched", confidence: fuzzy.confidence, entry: fuzzy.entry };
  }
  // 4. none
  return { value: null, source: "none", confidence: 0 };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    FUZZY_AUTO_THRESHOLD,
    PROFILE_THRESHOLD,
    jaccardTokens,
    labelSimilarity,
    fieldTypesCompatible,
    matchProfile,
    matchLearned,
    matchField,
    PROFILE_MATCHERS,
  };
}
