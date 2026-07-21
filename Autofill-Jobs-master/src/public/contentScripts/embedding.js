/*
  embedding.js — client for the local embedding model running in the background service
  worker (see background.js). Content scripts can't reliably run WASM/ONNX themselves
  against an arbitrary host page's CSP, so this just message-passes text to the background
  worker and gets back normalized embedding vectors — entirely local, no network.

  This is a fallback layer, not the primary matcher: token-overlap matching in matcher.js
  stays instant and synchronous for the common case; embeddings are only consulted
  afterward, asynchronously, for fields the fast pass couldn't resolve at all.
*/

/**
 * Request embeddings for a batch of strings from the background worker.
 * @returns {Promise<number[][]|null>} one vector per input text, or null on any failure
 *          (model not ready, background unreachable, timeout) — callers should treat that
 *          as "no smarter answer available" and leave the field as-is, never throw.
 */
function afjGetEmbeddings(texts) {
  return new Promise((resolve) => {
    if (!texts || !texts.length) return resolve([]);
    if (typeof afjExtensionContextValid === "function" && !afjExtensionContextValid()) {
      return resolve(null);
    }
    if (typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage) {
      return resolve(null);
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve(null); }
    }, 20000); // first call loads the model (~tens of MB); allow real time for that

    try {
      chrome.runtime.sendMessage({ type: "AFJ_EMBED_QUERY", texts }, (response) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (chrome.runtime.lastError || !response || !response.ok) {
          resolve(null);
          return;
        }
        resolve(response.embeddings);
      });
    } catch (_) {
      if (!settled) { settled = true; clearTimeout(timer); resolve(null); }
    }
  });
}

/** Cosine similarity. Assumes both vectors are already normalized (the model output is),
 * in which case this is just the dot product — kept generic (dividing by norms) so it's
 * still correct if that assumption is ever violated. */
function afjCosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { afjCosineSimilarity };
}
