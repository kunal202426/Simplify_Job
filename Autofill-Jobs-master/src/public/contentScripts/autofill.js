/*
  autofill.js — page-load entry point.

  Watches the page for a job-application-shaped form and hands it to the learning engine.
  There's no per-site field-name map anymore: Greenhouse, Lever, Dover, and any ATS this
  extension has never seen before all go through the same generic, label-reading engine in
  engine.js — proven across a wide range of real portals. Workday is the one exception: its
  multi-stage wizard and bespoke widgets (skills picker, repeatable work-experience sections)
  get a dedicated handler in workday.js, since the generic engine doesn't cover those widget
  types yet.
*/

let afjPageLoadedAt;

// Master on/off switch, toggled in the popup. Storing under sync (not local) so the choice
// follows the user across machines like the rest of their profile. Undefined (never touched
// the toggle) means enabled — the extension should work out of the box, not require an
// opt-in click first.
const AFJ_ENABLED_KEY = "afjEngineEnabled";
async function afjIsEngineEnabled() {
  const data = await getStorageDataSync(AFJ_ENABLED_KEY);
  return data[AFJ_ENABLED_KEY] !== false;
}

window.addEventListener("load", async () => {
  afjPageLoadedAt = Date.now();
  if (!(await afjIsEngineEnabled())) {
    console.log("Autofill Jobs: turned off in the popup — not scanning this page.");
    return;
  }
  afjWatchForApplicationForm();
  afjWatchForSpaNavigation();
});

function afjIsWorkdayTenant() {
  return window.location.hostname.includes("workday");
}

/** The likely application-form container, preferring an explicit application-form id over a
 * generic <form> or #mainContent — several ATSes render other, unrelated forms (search bars,
 * newsletter signups) elsewhere on the same page. */
function afjFindLikelyForm() {
  return (
    document.querySelector("#application-form, #application_form, #applicationform") ||
    document.querySelector("form, #mainContent")
  );
}

// Only one "am I watching for a form on this page" loop should ever run at a time — without
// this guard, a route change re-arming the watcher while an earlier one is still active
// (e.g. still debouncing) would stack up multiple independent MutationObservers all doing
// the same job.
let afjPageWatcherActive = false;

/**
 * Watches the page for something that looks like a job-application form. Debounced so this
 * doesn't re-scan the DOM on every single mutation of a busy, unrelated page — the extension
 * runs on every https page now, not a curated site list, so ordinary page churn (ads,
 * trackers, lazily-loaded content) fires this observer constantly on sites that were never
 * job boards at all.
 */
function afjWatchForApplicationForm() {
  if (afjPageWatcherActive) return;
  afjPageWatcherActive = true;

  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => afjCheckForApplicationForm(observer), 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Some SPAs render their form before the observer's first mutation would otherwise fire —
  // check once immediately too, rather than waiting on page churn that might never come.
  afjCheckForApplicationForm(observer);
}

function afjCheckForApplicationForm(observer) {
  if (afjIsWorkdayTenant()) {
    observer.disconnect();
    afjPageWatcherActive = false;
    afjRunOnWorkday();
    return;
  }

  const form = afjFindLikelyForm();
  if (!form) return;

  // On a host we don't otherwise recognize, only proceed if this genuinely looks like a job
  // application — the extension is injected on every https page, not a curated job-board
  // list, so this content-based gate is what keeps it from firing on unrelated forms
  // everywhere else on the web.
  if (!afjLooksLikeJobApplicationPage(form)) return;

  observer.disconnect();
  afjPageWatcherActive = false;
  afjRunFillPass(form);
}

async function afjLoadProfile() {
  const res = await getStorageDataSync();
  res["Current Date"] = curDateStr();
  return res;
}

async function afjRunOnWorkday() {
  const res = await afjLoadProfile();
  workDayAutofill(res);
}

async function afjRunFillPass(form) {
  const res = await afjLoadProfile();
  await sleep(delays.initial);
  await runLearningEngine(form, window.location.hostname, res);
  scrollToTop();
  console.log(`Autofill Jobs: fill pass complete in ${getTimeElapsed(afjPageLoadedAt)}s.`);
}

/**
 * Single-page apps change the URL via the History API without ever reloading the page, so
 * "page load" fires exactly once no matter how many different routes/screens the user visits
 * afterward. Without watching for that, an engine that correctly activated once on a route
 * that genuinely looked like a job application (or was manually filled once) just keeps
 * running — and its review panel keeps showing — on every later route the user navigates to
 * client-side, since nothing else would ever notice the page changed underneath it.
 */
function afjWatchForSpaNavigation() {
  let lastPath = location.pathname + location.search;
  const handleChange = () => {
    const path = location.pathname + location.search;
    if (path === lastPath) return;
    lastPath = path;
    afjReevaluateForCurrentPath();
  };

  const origPushState = history.pushState;
  const origReplaceState = history.replaceState;
  history.pushState = function (...args) {
    origPushState.apply(this, args);
    handleChange();
  };
  history.replaceState = function (...args) {
    origReplaceState.apply(this, args);
    handleChange();
  };
  window.addEventListener("popstate", handleChange);
  window.addEventListener("hashchange", handleChange);
}

async function afjReevaluateForCurrentPath() {
  if (!(await afjIsEngineEnabled())) return;
  if (afjIsWorkdayTenant()) return; // its own stage-driven flow manages its own lifecycle

  // Give the SPA a moment to actually render the new route's content before judging it —
  // right after a pushState the old route's DOM is often still what's on screen.
  await sleep(delays.short);

  if (!afjLooksLikeJobApplicationPage(document.body)) {
    if (typeof afjTeardownEngine === "function") afjTeardownEngine();
    return;
  }
  // The new route (still or newly) looks like a job application — make sure something is
  // watching for its form, same as a fresh page load would.
  afjWatchForApplicationForm();
}
