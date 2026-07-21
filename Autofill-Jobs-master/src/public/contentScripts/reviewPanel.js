/*
  reviewPanel.js — injected per-page review UI.

  A small panel mounted in a shadow root (so the ATS page's CSS can't touch it, and ours
  can't touch the page). It shows three live lists as the engine works:
     ✔ Filled       — confident matches (profile / exact learned)
     ⚠ Check these  — fuzzy matches, amber, worth a glance before submitting
     🤖 AI suggested — local-LLM fallback guess (opt-in); always double-check these
     ✎ Needs you    — fields the engine couldn't fill; fill once and it's learned

  Clicking a row scrolls to and focuses the field. Never contains a submit control — the
  human always submits the form themselves.

  Exposes a single global `AFJ_PANEL` with { record, reset, note }.
*/

const AFJ_PANEL = (function () {
  let host = null;
  let shadow = null;
  const els = {}; // section list containers + counters
  const rows = new Map(); // key -> { li, status }

  const STATUS = {
    filled: { section: "filled", icon: "✔" },
    check: { section: "check", icon: "⚠" },
    ai: { section: "ai", icon: "🤖" },
    needs: { section: "needs", icon: "✎" },
  };
  const SECTIONS = ["filled", "check", "ai", "needs"];

  function ensure() {
    if (host && document.body.contains(host)) return;
    host = document.createElement("div");
    host.id = "afj-review-host";
    host.style.cssText =
      "position:fixed;bottom:16px;right:16px;z-index:2147483647;all:initial;";
    shadow = host.attachShadow({ mode: "open" });

    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        * { box-sizing: border-box; font-family: -apple-system, Segoe UI, Roboto, sans-serif; }
        .panel {
          width: 300px; max-height: 60vh; display: flex; flex-direction: column;
          background: #ffffff; color: #1f2328; border: 1px solid #d0d7de;
          border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,.18); overflow: hidden;
          font-size: 13px;
        }
        .head {
          display:flex; align-items:center; gap:8px; padding:10px 12px; cursor:pointer;
          background:#f6f8fa; border-bottom:1px solid #d0d7de; user-select:none;
        }
        .head .title { font-weight:600; flex:1; }
        .head .copy {
          font-size:11px; color:#57606a; background:#eaeef2; border:none; border-radius:6px;
          padding:2px 7px; cursor:pointer; font-family:inherit;
        }
        .head .copy:hover { background:#d0d7de; }
        .head .chev { transition: transform .15s; }
        .panel.collapsed .body { display:none; }
        .panel.collapsed .chev { transform: rotate(-90deg); }
        .body { overflow-y:auto; padding:6px 0; }
        .section { padding: 4px 0; }
        .section h4 {
          margin:0; padding:6px 12px 2px; font-size:11px; letter-spacing:.03em;
          text-transform:uppercase; color:#57606a; display:flex; gap:6px; align-items:center;
        }
        .count { background:#eaeef2; border-radius:10px; padding:0 6px; font-size:10px; }
        ul { list-style:none; margin:0; padding:0; }
        li {
          padding:5px 12px; display:flex; gap:8px; align-items:flex-start; cursor:pointer;
          border-left:3px solid transparent;
        }
        li:hover { background:#f6f8fa; }
        li .ic { flex:0 0 auto; }
        li .txt { flex:1; min-width:0; }
        li .lbl { display:block; font-weight:500; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
        li .val { display:block; color:#57606a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12px; }
        li .src {
          display:inline-block; margin-top:1px; font-size:9px; letter-spacing:.02em;
          text-transform:uppercase; color:#8c959f; background:#eaeef2; border-radius:5px;
          padding:0 4px;
        }
        .filled li { border-left-color:#1a7f37; }
        .check  li { border-left-color:#bf8700; background:#fff8e5; }
        .check  li:hover { background:#fff1c2; }
        .ai     li { border-left-color:#7c3aed; background:#f5f0ff; }
        .ai     li:hover { background:#ece1ff; }
        .needs  li { border-left-color:#0969da; }
        .empty { padding:4px 12px; color:#8c959f; font-style:italic; }
        .note { padding:6px 12px; color:#57606a; border-top:1px solid #eaeef2; }
        @media (prefers-color-scheme: dark) {
          .panel { background:#1c2128; color:#e6edf3; border-color:#30363d; }
          .head { background:#161b22; border-color:#30363d; }
          .head .copy { background:#30363d; color:#8b949e; }
          .head .copy:hover { background:#3a4048; }
          .count, li .src { background:#30363d; }
          li:hover, .filled li:hover { background:#161b22; }
          .check li { background:#2b2512; } .check li:hover { background:#3a3116; }
          .ai li { background:#241b38; } .ai li:hover { background:#302448; }
          .section h4 { color:#8b949e; } .note { border-color:#30363d; color:#8b949e; }
        }
      </style>
      <div class="panel" part="panel">
        <div class="head"><span class="title">Autofill Jobs</span>
          <span class="summary"></span>
          <button class="copy" type="button" title="Copy this page's full log as text">Copy log</button>
          <span class="chev">▾</span></div>
        <div class="body">
          <div class="section filled"><h4>Filled <span class="count" data-c="filled">0</span></h4><ul></ul><div class="empty">—</div></div>
          <div class="section check"><h4>Check these <span class="count" data-c="check">0</span></h4><ul></ul><div class="empty">—</div></div>
          <div class="section ai"><h4>AI suggested <span class="count" data-c="ai">0</span></h4><ul></ul><div class="empty">—</div></div>
          <div class="section needs"><h4>Needs you <span class="count" data-c="needs">0</span></h4><ul></ul><div class="empty">—</div></div>
          <div class="note" style="display:none"></div>
        </div>
      </div>`;

    const panel = shadow.querySelector(".panel");
    shadow.querySelector(".head").addEventListener("click", (ev) => {
      if (ev.target.closest && ev.target.closest(".copy")) return;
      panel.classList.toggle("collapsed");
    });
    shadow.querySelector(".head .copy").addEventListener("click", (ev) => {
      ev.stopPropagation();
      copyLogToClipboard();
    });
    SECTIONS.forEach((s) => {
      const sec = shadow.querySelector(`.section.${s}`);
      els[s] = { ul: sec.querySelector("ul"), empty: sec.querySelector(".empty"), count: shadow.querySelector(`.count[data-c="${s}"]`) };
    });
    els.summary = shadow.querySelector(".summary");
    els.note = shadow.querySelector(".note");
    document.body.appendChild(host);
  }

  /** Copy a plain-text summary of every recorded row — for pasting elsewhere, e.g. into a
   * bug report — grouped by section in the same order the panel shows them. */
  function copyLogToClipboard() {
    const bySection = { filled: [], check: [], ai: [], needs: [] };
    for (const [, entry] of rows) {
      const section = (STATUS[entry.status] || STATUS.needs).section;
      bySection[section].push(entry);
    }
    const titles = { filled: "FILLED", check: "CHECK THESE (fuzzy match)", ai: "AI SUGGESTED (embedding match)", needs: "NEEDS YOU" };
    const lines = [`Autofill Jobs — ${location.href}`, ""];
    SECTIONS.forEach((s) => {
      lines.push(`${titles[s]} (${bySection[s].length})`);
      if (!bySection[s].length) lines.push("  —");
      for (const e of bySection[s]) {
        const src = e.source ? ` [${e.source}]` : "";
        lines.push(`  - ${e.label || "(field)"}${src}: ${e.value || "(empty)"}`);
      }
      lines.push("");
    });
    const text = lines.join("\n");
    const btn = shadow.querySelector(".head .copy");
    const done = (ok) => { if (btn) { btn.textContent = ok ? "Copied!" : "Copy failed"; setTimeout(() => (btn.textContent = "Copy log"), 1500); } };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => done(true)).catch(() => done(false));
    } else {
      done(false);
    }
  }

  function refreshCounts() {
    let counts = { filled: 0, check: 0, ai: 0, needs: 0 };
    rows.forEach((r) => { counts[r.status]++; });
    SECTIONS.forEach((s) => {
      els[s].count.textContent = counts[s];
      els[s].empty.style.display = counts[s] ? "none" : "block";
    });
    els.summary.textContent = `${counts.filled}✔ ${counts.check}⚠ ${counts.ai}🤖 ${counts.needs}✎`;
    els.summary.style.cssText = "font-size:11px;color:#8c959f;";
  }

  /**
   * Record / update a field's result row.
   * @param {object} r { key, status:"filled"|"check"|"ai"|"needs", label, value, source,
   *   onClick } — `source` (e.g. "profile", "learned-exact", "fuzzy-matched",
   *   "embedding-matched", "manual") is optional context shown as a small tag, and included
   *   in the "Copy log" export, so it's clear WHY a field ended up in a given section without
   *   having to guess.
   */
  function record(r) {
    if (typeof document === "undefined") return;
    ensure();
    const meta = STATUS[r.status] || STATUS.needs;
    let entry = rows.get(r.key);
    if (!entry) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="ic"></span><span class="txt"><span class="lbl"></span><span class="val"></span><span class="src"></span></span>`;
      entry = { li, status: r.status };
      rows.set(r.key, entry);
    }
    // Move to the correct section if status changed.
    els[meta.section].ul.appendChild(entry.li);
    entry.status = r.status;
    entry.label = r.label;
    entry.value = r.value;
    entry.source = r.source || "";
    entry.li.querySelector(".ic").textContent = meta.icon;
    entry.li.querySelector(".lbl").textContent = r.label || "(field)";
    const valEl = entry.li.querySelector(".val");
    valEl.textContent = r.value != null && r.value !== "" ? String(r.value) : (r.status === "needs" ? "" : "");
    const srcEl = entry.li.querySelector(".src");
    if (srcEl) {
      srcEl.textContent = r.source || "";
      srcEl.style.display = r.source ? "inline-block" : "none";
    }
    entry.li.onclick = () => {
      if (r.onClick) return r.onClick();
      const el = r.el;
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        try { el.focus({ preventScroll: true }); } catch (_) {}
      }
    };
    refreshCounts();
  }

  function note(text) {
    ensure();
    els.note.textContent = text;
    els.note.style.display = text ? "block" : "none";
  }

  function reset() {
    rows.clear();
    if (shadow) SECTIONS.forEach((s) => (els[s].ul.innerHTML = ""));
    refreshCounts();
  }

  return { record, reset, note };
})();
