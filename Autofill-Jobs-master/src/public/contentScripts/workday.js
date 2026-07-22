/*
  workday.js — Workday's multi-stage application wizard.

  Workday isn't a single form: it's a sequence of stages (My Information, My Experience,
  Voluntary Disclosures, Self Identify, ...), each swapped into the DOM in place as the
  candidate clicks through, and several of its widgets (the skills picker, the repeatable
  "Add Experience" section, its own dropdown/listbox pattern) are bespoke enough that the
  generic label-reading engine in engine.js doesn't cover them yet. This file watches for
  stage changes and drives those specific widgets directly; anything left over on each stage
  — plain text/textarea/radio fields — is handed to the generic engine, same as everywhere
  else.

  Field discovery here is entirely by data-automation-id, which Workday's own DOM defines and
  is fairly stable per stage — it's platform structure, not styling, so it's the most durable
  thing to key off in a wizard that otherwise reflows constantly between candidates and
  tenants.
*/

/** Per-stage map of data-automation-id fragments -> the profile key that should fill them.
 * A handful of entries map to a widget handler (Resume/Skills/Work Experience) instead of a
 * plain profile lookup — those get special-cased in afjWorkdayProcessField below. */
const AFJ_WORKDAY_STAGES = {
  "My Information": {
    country: "Location (Country)",
    firstName: "First Name",
    lastName: "Last Name",
    addressLine1: "Location (Street)",
    addressSection_countryRegion: "Location (State/Region)",
    city: "Location (City)",
    postal: "Postal/Zip Code",
    "phone-device-type": "Phone Type",
    phoneType: "Phone Type",
    "phone-number": "Phone",
    phoneNumber: "Phone",
  },
  "My Experience": {
    "add-button": "Work Experience",
    schoolName: "School",
    degree: "Degree",
    fieldOfStudy: "Discipline",
    gradeAverage: "GPA",
    selectedItemList: "Skills",
    "file-upload-input-ref": "Resume",
    linkedin: "LinkedIn",
  },
  "Voluntary Disclosures": {
    ethnicity: "Race",
    race: "Race",
    gender: "Gender",
    veteran: "Veteran Status",
    disability: "Disability Status",
  },
  "Self Identify": {
    name: "Full Name",
    "month-input": "Current Date",
    "day-input": "Current Date",
    "year-input": "Current Date",
  },
};

/** Find the single element in `scope` whose id/name/data-automation-id/data-automation-label
 * contains `needle` — Workday's own automation hooks are the most stable selector surface
 * across tenants, more so than class names or DOM position. Explicitly excludes anything
 * matching "phonecode", since the phone-number field's automation id is a substring of the
 * phone-country-code selector's id and would otherwise grab the wrong control. */
function afjWorkdayFind(scope, needle, tag) {
  const target = needle.toLowerCase();
  return Array.from(scope.querySelectorAll(tag)).find((el) => afjWorkdayElementMatches(el, target));
}

/** Same match, but every element in document order — for repeatable sections (Work
 * Experience entries) where each new "+ Add" click produces another instance of the same
 * automation ids. */
function afjWorkdayFindAll(needle, tag) {
  const target = needle.toLowerCase();
  return Array.from(document.querySelectorAll(tag)).filter((el) => afjWorkdayElementMatches(el, target));
}

function afjWorkdayElementMatches(el, target) {
  const candidates = [
    el.id, el.name,
    el.getAttribute("data-automation-id"),
    el.getAttribute("data-automation-label"),
  ];
  return candidates.some((c) => {
    if (!c) return false;
    const normalized = c.toLowerCase().trim();
    return normalized.includes(target) && !normalized.includes("phonecode");
  });
}

/** Reads which stage is currently active from Workday's own progress bar. Runs on every DOM
 * mutation while the wizard is open, including mid-render moments where React hasn't
 * finished laying out the progress bar yet, so this must degrade to null rather than throw
 * on a transient/unexpected shape instead of a stage name. */
function afjWorkdayCurrentStage() {
  const progressBar = document.querySelector('[data-automation-id="progressBar"]');
  if (!progressBar) return null;
  const activeStep = progressBar.querySelector('[data-automation-id="progressBarActiveStep"]');
  if (!activeStep || !activeStep.children || activeStep.children.length < 3) return null;
  return activeStep.children[2].textContent || null;
}

/** Attaches the stored resume to a file input on the current stage, if one matches. */
async function afjWorkdayUploadResume(fieldKey) {
  const input = afjWorkdayFind(document, fieldKey, "input");
  if (!input) return false;
  const localData = await getStorageDataLocal();
  if (!localData.Resume) return false;

  const buffer = base64ToArrayBuffer(localData.Resume);
  const transfer = new DataTransfer();
  transfer.items.add(new File([buffer], localData["Resume_name"] || "resume.pdf", { type: "application/pdf" }));
  input.files = transfer.files;
  input.dispatchEvent(changeEvent);
  await sleep(delays.long);
  return true;
}

/** Reads the parsed resume details out of storage, tolerating either the parsed object or
 * its JSON-string form depending on when it was written. */
async function afjWorkdayLoadResumeDetails() {
  const data = await getStorageDataLocal("Resume_details");
  const raw = data["Resume_details"];
  if (!raw) return null;
  return typeof raw === "string" ? JSON.parse(raw) : raw;
}

/** Picks the option whose visible text best matches `needle` out of Workday's
 * virtualized-list autocomplete popup (used by both the skills picker and the
 * discipline/field-of-study picker) — the popup renders as a react-window/react-virtualized
 * grid, not a plain list, so only the currently-rendered rows are queryable at all. Matching
 * goes through the same word-boundary-safe matchOption() the rest of the extension uses
 * (formatConvert.js) rather than a raw substring test — a raw test previously let a search
 * for "India" click "Indian Institute of Technology" or similar, since "india" really is a
 * substring of "indian". A "|"-separated label (skills sometimes render as "Python |
 * Programming Language") has its category suffix stripped before matching, so a plain
 * "Python" search still lines up with matchOption's exact-match step. Returns true only when
 * a row was actually clicked, so the caller can retry while the popup is still rendering. */
function afjWorkdayClickVirtualizedOption(needle) {
  const grid = document.querySelector(".ReactVirtualized__Grid__innerScrollContainer");
  if (!grid || !grid.children.length) return false;

  const rows = Array.from(grid.children);
  const plainLabels = rows.map((row) => (row.getAttribute("aria-label") || "").split("|")[0].trim());
  const best = matchOption(needle, plainLabels);
  if (!best) return false;

  const idx = plainLabels.indexOf(best);
  if (idx === -1) return false;
  rows[idx].children[0].click();
  return true;
}

/** Types into a virtualized-list autocomplete input and polls for its popup to render before
 * picking the matching option — shared by the skills picker and the discipline field. Polls
 * rather than a single fixed wait: a fixed wait short enough for the first search of a batch
 * (the grid may already be warm) was too short whenever a later search needed a fresh
 * server-side lookup, which silently dropped that entry — it never got clicked, and the loop
 * just moved on to the next one with no retry and no signal that anything had gone wrong.
 * Returns whether an option was actually picked. */
async function afjWorkdayTypeIntoAutocomplete(input, value) {
  input.focus();
  await sleep(200);
  input.value = value;
  input.setAttribute("value", value);
  input.dispatchEvent(inputEvent);
  input.dispatchEvent(changeEvent);
  await sleep(200);
  input.dispatchEvent(keyDownEvent);
  input.dispatchEvent(keyUpEvent);

  for (let waited = 0; waited < 3000; waited += 300) {
    await sleep(300);
    if (afjWorkdayClickVirtualizedOption(value)) return true;
  }
  return false;
}

/** Adds each parsed resume skill one at a time through Workday's multiselect chip input —
 * it only accepts one skill per open/type/select cycle, so there's no batch path here. */
async function afjWorkdaySelectSkills() {
  const details = await afjWorkdayLoadResumeDetails();
  if (!details || !details.skills || !details.skills.length) return false;

  const field = document.querySelector('[data-automation-id="formField-skills"]');
  const opener = field && field.querySelector('[data-automation-id="multiselectInputContainer"]');
  if (!opener) return false;

  for (const skill of details.skills) {
    opener.click();
    await sleep(500);
    let input = opener.children[1] && opener.children[1].children[0];
    if (!input || input.getAttribute("data-automation-id") !== "monikerSearchBox") {
      input = opener.children[0] && opener.children[0].children[0];
    }
    if (!input) continue;
    const added = await afjWorkdayTypeIntoAutocomplete(input, skill);
    if (!added) console.warn(`AutofillJobs (workday): couldn't find "${skill}" in the skills picker`);
  }
  await sleep(delays.short);
  return true;
}

function afjWorkdaySplitDuration(duration) {
  const [startPart, endPart] = String(duration || "").split("-");
  const parse = (part) => {
    const [monthName, year] = part.trim().split(" ");
    return { month: monthToNumber(monthName), year };
  };
  return { start: parse(startPart || ""), end: parse(endPart || "") };
}

/** Clicks "+ Add" once per parsed work-experience entry and fills the new repeated block
 * that appears — each click produces one more instance of the same set of automation ids, so
 * the Nth entry is always at index N in document order. */
async function afjWorkdayAddWorkExperience(fieldKey) {
  const details = await afjWorkdayLoadResumeDetails();
  if (!details || !details.experiences || !details.experiences.length) return false;

  const addButton = afjWorkdayFind(document, fieldKey, "button");
  if (!addButton) return false;

  let index = 0;
  for (const exp of details.experiences) {
    addButton.click();
    await sleep(1250);

    const nth = (needle, tag) => afjWorkdayFindAll(needle, tag)[index];
    const jobTitle = nth("jobTitle", "input");
    const company = nth("companyName", "input");
    const currentlyWorking = nth("currentlyWorkHere", "input");
    const description = nth("roleDescription", "textarea");
    const startMonth = nth("startDate-dateSectionMonth", "input");
    const startYear = nth("startDate-dateSectionYear", "input");
    const endMonth = nth("endDate-dateSectionMonth", "input");
    const endYear = nth("endDate-dateSectionYear", "input");

    setNativeValue(jobTitle, exp.jobTitle);
    await sleep(500);
    setNativeValue(company, exp.jobEmployer);
    await sleep(500);
    setNativeValue(currentlyWorking, exp.isCurrentEmployer);
    await sleep(500);

    const { start, end } = afjWorkdaySplitDuration(exp.jobDuration);
    startMonth.click();
    setNativeValue(startMonth, start.month);
    await sleep(600);
    startYear.click();
    setNativeValue(startYear, start.year);
    await sleep(600);
    endMonth.click();
    setNativeValue(endMonth, end.month);
    await sleep(600);
    endYear.click();
    setNativeValue(endYear, end.year);
    await sleep(600);
    setNativeValue(description, exp.roleBulletsString);

    index++;
  }
  await sleep(delays.short);
  return true;
}

/** The Self Identify stage's date-of-signature fields don't map to a stored profile value —
 * they mean "today," split across three separate month/day/year inputs. */
function afjWorkdayTodayComponent(fieldKey, res) {
  const [day, month, year] = (res["Current Date"] || "").split("/");
  if (fieldKey === "month-input") return month;
  if (fieldKey === "day-input") return day;
  if (fieldKey === "year-input") return year;
  return null;
}

/** The Discipline/field-of-study field is itself a virtualized-list autocomplete, not a
 * plain text input, despite Workday rendering it as one — same interaction pattern as the
 * skills picker, just a single value instead of a loop. */
async function afjWorkdayFillDiscipline(value) {
  const opener = document.querySelector('[data-automation-id="multiselectInputContainer"]');
  if (!opener) return false;
  opener.click();
  await sleep(1000);
  const input = document.querySelector("input[id='education-4--fieldOfStudy']");
  if (!input) return false;
  await afjWorkdayTypeIntoAutocomplete(input, value);
  return true;
}

/** Fills a plain text/date input, or defers to the discipline-specific autocomplete flow
 * when the field turns out to be that one despite matching a plain <input> query. */
async function afjWorkdayFillTextField(fieldKey, profileKey, value, res) {
  const input = afjWorkdayFind(document, fieldKey, "input");
  if (!input) return false;

  if (fieldKey === "month-input" || fieldKey === "day-input" || fieldKey === "year-input") {
    value = afjWorkdayTodayComponent(fieldKey, res);
  }
  if (profileKey === "Discipline") {
    return afjWorkdayFillDiscipline(value);
  }

  setNativeValue(input, value);
  return true;
}

/** Workday's own dropdown/listbox pattern: click to open, then click the option whose text
 * best matches. "Decline to..." style answers are normalized to Workday's own "Decline"/
 * "I don't wish to..." wording, which otherwise wouldn't substring-match the stored value. */
async function afjWorkdayPickDropdownOption(fieldKey, value) {
  const trigger = afjWorkdayFind(document, fieldKey, "button");
  if (!trigger) return false;

  trigger.click();
  await sleep(delays.long);
  const listbox = document.querySelector('ul[role="listbox"][tabindex="-1"]');
  if (!listbox) return false;

  const normalized = String(value).toLowerCase().trim();
  const wantsDecline = normalized.includes("decline");
  for (const option of listbox.querySelectorAll("li div")) {
    const text = option.textContent.toLowerCase();
    const matches =
      text.includes(normalized) ||
      normalized.includes(text) ||
      (wantsDecline && text.includes("self"));
    if (matches) option.click();
  }
  await sleep(delays.short);
  trigger.blur();
  return true;
}

/** Handles one stage field: the widget-backed ones (Resume/Skills/Work Experience) first,
 * then a plain text input, then Workday's own dropdown pattern. Returns true once the field
 * is considered handled (filled, or confidently nothing to fill), so the caller can drop it
 * from this stage's remaining work either way. */
async function afjWorkdayProcessField(fieldKey, profileKey, res) {
  if (profileKey === "Resume") return afjWorkdayUploadResume(fieldKey);
  if (profileKey === "Skills") return afjWorkdaySelectSkills();
  if (profileKey === "Work Experience") return afjWorkdayAddWorkExperience(fieldKey);

  const value = res[profileKey];
  const isTodayField = fieldKey === "month-input" || fieldKey === "day-input" || fieldKey === "year-input";
  if (!value && !isTodayField) return true; // nothing stored for this field — leave it for the generic engine

  if (await afjWorkdayFillTextField(fieldKey, profileKey, value, res)) return true;
  if (await afjWorkdayPickDropdownOption(fieldKey, value)) return true;
  return true; // no matching element on this render — don't keep retrying every mutation
}

/** Runs the generic engine over whatever this stage's mapped-field pass didn't handle
 * (plain text/textarea/radio fields the automation-id map above doesn't know about) — same
 * matching/learning pipeline used everywhere else in the extension. */
async function afjWorkdayRunGenericPass(res) {
  const scope =
    document.querySelector('[data-automation-id="applyFlowPage"]') ||
    document.querySelector("form") ||
    document.body;
  try {
    // Re-entrant and safe on every stage transition: runLearningEngine only touches elements
    // it hasn't already processed, and its own observer keeps watching this scope across
    // stages.
    await runLearningEngine(scope, window.location.hostname, res);
  } catch (e) {
    console.warn("AutofillJobs (workday): generic pass skipped", e);
  }
}

/**
 * Watches the wizard for stage changes and processes each stage's mapped fields once it
 * appears. `stageBusy` is the reentrancy guard: without it wrapped in try/finally around the
 * ENTIRE stage-processing block (mapped fields + the generic pass after them), any unhandled
 * error partway through would leave it stuck, silently blocking every later stage transition
 * for the rest of the session — not just failing the field that caused it.
 */
async function workDayAutofill(res) {
  await sleep(delays.initial);

  const remainingStages = JSON.parse(JSON.stringify(AFJ_WORKDAY_STAGES));
  let stageBusy = false;

  const observer = new MutationObserver(async () => {
    const stage = afjWorkdayCurrentStage();
    if (!stage || !remainingStages[stage] || stageBusy) return;

    stageBusy = true;
    try {
      await sleep(2000);
      for (const fieldKey of Object.keys(remainingStages[stage])) {
        const profileKey = remainingStages[stage][fieldKey];
        try {
          await afjWorkdayProcessField(fieldKey, profileKey, res);
        } catch (e) {
          console.warn("AutofillJobs (workday): skipped a field after an error", fieldKey, e);
        }
        delete remainingStages[stage][fieldKey];
      }
      await afjWorkdayRunGenericPass(res);
    } finally {
      stageBusy = false;
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });
}
