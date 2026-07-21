import { pipeline, env } from "./vendor/transformers.min.js";

// Opens the side panel (instead of an auto-closing popup) when the toolbar icon is clicked.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((err) => console.error(err));

/* ---------------- local embedding model (semantic fuzzy matching) ---------------- */
//
// Runs a small (~23MB quantized) sentence-embedding model — all-MiniLM-L6-v2 — entirely
// on-device via ONNX/WASM, to replace word-overlap similarity with real semantic
// similarity for the fuzzy-match fallback. Everything it needs (model weights, tokenizer,
// the ONNX runtime itself) is vendored under public/vendor/ and packaged with the
// extension; env.allowRemoteModels is explicitly disabled below so it can never fall back
// to fetching from Hugging Face's CDN — this stays offline the same way the rest of the
// extension does. Lives in the background service worker (not a content script) so its
// WASM execution isn't subject to an arbitrary host page's CSP.

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = chrome.runtime.getURL("vendor/");
env.backends.onnx.wasm.wasmPaths = chrome.runtime.getURL("vendor/");
env.backends.onnx.wasm.numThreads = 1; // service workers aren't cross-origin-isolated

let extractorPromise = null;
function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline("feature-extraction", "minilm", { quantized: true });
  }
  return extractorPromise;
}

async function embedTexts(texts) {
  const extractor = await getExtractor();
  const out = [];
  for (const text of texts) {
    const result = await extractor(text, { pooling: "mean", normalize: true });
    out.push(Array.from(result.data));
  }
  return out;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "AFJ_EMBED_QUERY") return false;
  embedTexts(msg.texts || [])
    .then((embeddings) => sendResponse({ ok: true, embeddings }))
    .catch((err) => sendResponse({ ok: false, error: String((err && err.message) || err) }));
  return true; // keep the message channel open for the async sendResponse
});

// Proxies the local-LLM fallback call to Ollama (http://localhost:11434) on behalf of
// content scripts. Routed through the background service worker rather than fetched
// directly from the content script: MV3 host_permissions grant privileged cross-origin
// fetch to extension contexts without needing the target server's CORS cooperation, and
// keeping it here means the timeout/error handling lives in one place. Never contacts
// anything other than the loopback address the user configured — this is the only network
// traffic in the extension, and it never leaves the user's own machine.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "AFJ_LLM_QUERY") return false;

  const baseUrl = (msg.baseUrl || "http://localhost:11434").replace(/\/+$/, "");
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), msg.timeoutMs || 10000);

  fetch(`${baseUrl}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: msg.model || "qwen2.5:3b",
      prompt: msg.prompt,
      stream: false,
      format: "json",
    }),
    signal: controller.signal,
  })
    .then((r) => {
      if (!r.ok) throw new Error(`Ollama responded ${r.status}`);
      return r.json();
    })
    .then((data) => sendResponse({ ok: true, text: data.response }))
    .catch((err) => sendResponse({ ok: false, error: String(err && err.message || err) }))
    .finally(() => clearTimeout(timeoutId));

  return true; // keep the message channel open for the async sendResponse
});
