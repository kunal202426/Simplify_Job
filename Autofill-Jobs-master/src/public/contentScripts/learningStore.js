/*
  learningStore.js — the answer bank.

  Persists what the user has manually filled, keyed by signature hash, in
  chrome.storage.local under a single object `learnedFields`. All access is async.

  Entry schema:
    learnedFields[hash] = {
      rawLabel:    string,       // the label as seen, for display in the review UI
      tokens:      string[],     // label tokens, used by the fuzzy matcher
      fieldType:   "text"|"select"|"radio"|"checkbox"|"date"|"file"|"textarea",
      value:       string,       // canonical value the user entered
      optionsSeen: string[],     // for selects/radios: the option list at learn time
      timesUsed:   number,
      lastUsed:    number,       // epoch ms
      source:      "manual"|"profile"|"fuzzy-matched"
    }

  Upsert rule (per brief): same hash + same value -> increment timesUsed; same hash +
  different value -> the user's latest entry wins (value replaced, counter reset).
*/

const LEARNED_KEY = "learnedFields";

// Serialize all read-modify-write mutations so two fields learned in quick succession don't
// both read the same snapshot and clobber each other (chrome.storage get/set are async).
let _opChain = Promise.resolve();
function _enqueue(fn) {
  const run = _opChain.then(fn, fn);
  _opChain = run.then(() => {}, () => {});
  return run;
}

function _hasChromeLocal() {
  return (
    typeof chrome !== "undefined" &&
    chrome.storage &&
    chrome.storage.local &&
    typeof chrome.storage.local.get === "function"
  );
}

/** Read the entire learned bank. Resolves to {} if unavailable/empty. */
function getAllLearned() {
  return new Promise((resolve) => {
    if (!_hasChromeLocal()) return resolve({});
    chrome.storage.local.get(LEARNED_KEY, (data) => {
      resolve((data && data[LEARNED_KEY]) || {});
    });
  });
}

/** Read a single learned entry by hash, or null. */
async function getLearnedField(hash) {
  const bank = await getAllLearned();
  return bank[hash] || null;
}

function _setAllLearned(bank) {
  return new Promise((resolve) => {
    if (!_hasChromeLocal()) return resolve();
    chrome.storage.local.set({ [LEARNED_KEY]: bank }, () => resolve());
  });
}

/**
 * Insert or update a learned answer.
 * @param {object} sig    signature object from generateSignature()
 * @param {string} value  value the user entered / that was filled
 * @param {string} source "manual" | "profile" | "fuzzy-matched"
 */
function upsertLearnedField(sig, value, source) {
  if (!sig || value == null || value === "") return Promise.resolve();
  return _enqueue(async () => {
    const bank = await getAllLearned();
    const now = Date.now();
    const existing = bank[sig.hash];

    if (existing && existing.value === value) {
      existing.timesUsed = (existing.timesUsed || 0) + 1;
      existing.lastUsed = now;
      // Refresh option list in case it grew.
      if (sig.options && sig.options.length) existing.optionsSeen = sig.options;
    } else {
      bank[sig.hash] = {
        rawLabel: sig.rawLabel || (existing && existing.rawLabel) || "",
        tokens: sig.tokens || [],
        fieldType: sig.fieldType || "text",
        value: value,
        optionsSeen: sig.options || [],
        timesUsed: 1,
        lastUsed: now,
        source: source || "manual",
      };
    }
    await _setAllLearned(bank);
    return bank[sig.hash];
  });
}

/** Remove one learned entry by hash. */
function deleteLearnedField(hash) {
  return _enqueue(async () => {
    const bank = await getAllLearned();
    if (bank[hash]) {
      delete bank[hash];
      await _setAllLearned(bank);
    }
  });
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { LEARNED_KEY, getAllLearned, getLearnedField, upsertLearnedField, deleteLearnedField };
}
