/*
  utils.js — low-level DOM/storage/timing helpers shared by every other content script.

  Loaded first (see manifest.json); everything below is a plain global, not a module export —
  content scripts here share one JS scope by design, so every other file can just call these
  directly.
*/

const AFJ_KEY_ENTER = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true };
const keyDownEvent = new KeyboardEvent("keydown", AFJ_KEY_ENTER);
const keyUpEvent = new KeyboardEvent("keyup", AFJ_KEY_ENTER);
const mouseUpEvent = new MouseEvent("mouseup", { bubbles: true, cancelable: true });
const changeEvent = new Event("change", { bubbles: true });
const inputEvent = new Event("input", { bubbles: true });

const delays = {
  initial: 1000,
  short: 200,
  long: 600,
};

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Current date as dd/mm/yyyy — the canonical date format the rest of the extension parses
 * stored dates against. */
function curDateStr() {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date());
}

function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "instant" });
}

/** Decode a base64 string (no data-URI prefix) into an ArrayBuffer, for building a File from
 * a resume stored in chrome.storage.local. */
function base64ToArrayBuffer(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

const AFJ_MONTHS = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
function monthToNumber(month) {
  return AFJ_MONTHS[String(month || "").toLowerCase().trim()] || null;
}

function getTimeElapsed(startTime) {
  return ((Date.now() - startTime) / 1000).toFixed(3);
}

/**
 * True while this content script's extension context is still valid. Content scripts stay
 * alive in an already-open tab even after the extension is reloaded/updated/disabled — any
 * chrome.* call from that point on throws "Extension context invalidated" (a synchronous
 * throw, not a rejected promise), since Chrome only re-injects fresh content scripts on the
 * next page load. Checking chrome.runtime.id (which becomes undefined once invalidated) lets
 * a stale script degrade quietly instead of throwing into the extension's Errors panel on
 * every tick of a periodic re-scan.
 */
function afjExtensionContextValid() {
  try {
    return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
  } catch (_) {
    return false;
  }
}

function _afjStorageGet(areaName, key) {
  return new Promise((resolve) => {
    if (!afjExtensionContextValid()) return resolve({});
    try {
      const area = chrome.storage && chrome.storage[areaName];
      if (!area) return resolve({});
      area.get(key === undefined ? null : key, resolve);
    } catch (_) {
      resolve({});
    }
  });
}
const getStorageDataLocal = (key) => _afjStorageGet("local", key);
const getStorageDataSync = (key) => _afjStorageGet("sync", key);

/**
 * Write a value into a field the way a real user interaction would, so frameworks relying on
 * their own controlled-input tracking (React foremost) pick it up — a plain `el.value = x`
 * assignment is invisible to React's synthetic event system and gets silently reverted on
 * the next render. Uses the property descriptor from the element's prototype (not the
 * instance) to call the native setter directly, which is what actually notifies React's
 * internal value tracker; this is the standard, framework-version-agnostic way to do this
 * (React's own `_valueTracker` internal has changed shape across versions and isn't safe to
 * poke directly).
 */
function setNativeValue(el, value) {
  if (el.type === "checkbox" || el.type === "radio") {
    if (Boolean(value) !== el.checked) el.click();
    return;
  }
  if (el instanceof HTMLSelectElement) {
    for (const option of el.options) {
      if (option.value.toLowerCase().includes(String(value).toLowerCase())) {
        el.value = option.value;
        break;
      }
    }
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return;
  }

  const prototype = Object.getPrototypeOf(el);
  const nativeSetter = Object.getOwnPropertyDescriptor(prototype, "value") &&
    Object.getOwnPropertyDescriptor(prototype, "value").set;
  if (nativeSetter) {
    nativeSetter.call(el, value);
  } else {
    el.value = value;
  }
  el.setAttribute("value", value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}
