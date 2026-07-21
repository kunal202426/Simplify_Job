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

window.addEventListener("load", () => {
  afjPageLoadedAt = Date.now();
  afjWatchForApplicationForm();
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

/**
 * Watches the page for something that looks like a job-application form. Debounced so this
 * doesn't re-scan the DOM on every single mutation of a busy, unrelated page — the extension
 * runs on every https page now, not a curated site list, so ordinary page churn (ads,
 * trackers, lazily-loaded content) fires this observer constantly on sites that were never
 * job boards at all.
 */
function afjWatchForApplicationForm() {
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
