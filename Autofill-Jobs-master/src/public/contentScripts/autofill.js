/*
import {
  keyDownEvent,
  keyUpEvent,
  mouseUpEvent,
  changeEvent,
  inputEvent,
  sleep,
  curDateStr,
  scrollToTop,
  base64ToArrayBuffer,
  monthToNumber,
  getTimeElapsed,
  delays,
  getStorageDataLocal,
  getStorageDataSync,
  setNativeValue,
  fields
} from "./utils";
import { workDayAutofill } from './workday';
*/

let initTime;
window.addEventListener("load", (_) => {
  console.log("AutofillJobs: found job page.");
  initTime = new Date().getTime();
  awaitForm();
});
const applicationFormQuery = "#application-form, #application_form, #applicationform";


function inputQuery(jobParam, form) {
  let normalizedParam = jobParam.toLowerCase();
  let inputElement = Array.from(form.querySelectorAll("input")).find(
    (input) => {
      const attributes = [
        input.id?.toLowerCase().trim(),
        input.name?.toLowerCase().trim(),
        input.placeholder?.toLowerCase().trim(),
        input.getAttribute("aria-label")?.toLowerCase().trim(),
        input.getAttribute("aria-labelledby")?.toLowerCase().trim(),
        input.getAttribute("aria-describedby")?.toLowerCase().trim(),
        input.getAttribute("data-qa")?.toLowerCase().trim(),
      ];

      for (let i = 0; i < attributes.length; i++) {
        if (
          attributes[i] != undefined &&
          attributes[i].includes(normalizedParam)
        ) {
          return true;
        }
      }
      return false;
    }
  );
  return inputElement;
}

function formatCityStateCountry(data, param) {
  let formattedStr = `${data[param] != undefined ? `${data[param]},` : ""} ${
    data["Location (State/Region)"] != undefined
      ? `${data["Location (State/Region)"]},`
      : ""
  }`;
  if (formattedStr[formattedStr.length - 1] == ",")
    formattedStr = formattedStr.slice(0, formattedStr.length - 1);
  return formattedStr;
}

async function awaitForm() {
  // Create a MutationObserver to detect changes in the DOM
  const observer = new MutationObserver((_, observer) => {
    for (let jobForm in fields) {
      if (!window.location.hostname.includes(jobForm)) continue;
      //workday
      if (jobForm == "workday") {
        autofill(null);
        observer.disconnect();
        return;
      }
      let form = document.querySelector(applicationFormQuery);
      if (form) {
        observer.disconnect();
        autofill(form);
        return;
      } else {
        form = document.querySelector("form, #mainContent");
        if (form) {
          observer.disconnect();
          autofill(form);
          return;
        }
      }
    }

    // Matched host with no per-site map (iCIMS/Taleo/SuccessFactors/...) — run the engine
    // generically on any detected application form.
    let genericForm =
      document.querySelector(applicationFormQuery) ||
      document.querySelector("form, #mainContent");
    if (genericForm && !genericForm.__afjEngineRan) {
      observer.disconnect();
      runGenericEngine(genericForm);
      return;
    }
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  if (window.location.hostname.includes("lever")) {
    let form = document.querySelector("#application-form, #application_form");
    if (form) autofill(form);
  }
}

// Runs the learning engine on hosts that have no per-site profile map (iCIMS, Taleo,
// SuccessFactors, or any future matched host). Profile fields are matched generically by
// the engine's matcher, so no hardcoded mapping is required.
async function runGenericEngine(form) {
  let res = await getStorageDataSync();
  res["Current Date"] = curDateStr();
  await sleep(delays.initial);
  await runLearningEngine(form, window.location.hostname, res);
  scrollToTop();
  console.log(`Autofill Jobs: Generic engine complete in ${getTimeElapsed(initTime)}s.`);
}

async function autofill(form) {
  console.log("Autofill Jobs: Starting autofill.");
  let res = await getStorageDataSync();
  res["Current Date"] = curDateStr();
  await sleep(delays.initial);
  for (let jobForm in fields) {
    if (!window.location.hostname.includes(jobForm)) continue;
    if (jobForm == "workday") {
      workDayAutofill(res);
      return;
    }

    for (let jobParam in fields[jobForm]) {
      if (jobParam.toLowerCase() == "resume") {
          let localData = await getStorageDataLocal();
          if (!localData.Resume) continue;

          let resumeDiv = {
            greenhouse: 'input[id="resume"]',
            lever: 'input[id="resume-upload-input"]',
            dover:
              'input[type="file"][accept=".pdf"], input[type="file"][accept="application/pdf"]',
          };
          let el = document.querySelector(resumeDiv[jobForm]);
          if (!el) {
            //old greenhouse forms
            el = document.querySelector('input[type="file"]');
          }
          el.addEventListener("submit", function (event) {
            event.preventDefault();
          });
          
          const dt = new DataTransfer();
          let arrBfr = base64ToArrayBuffer(localData.Resume);

          dt.items.add(
            new File([arrBfr], `${localData["Resume_name"]}`, {
              type: "application/pdf",
            })
          );
          el.files = dt.files;
          el.dispatchEvent(changeEvent);
          await sleep(delays.short);
          
        
        continue;
      }

      let useLongDelay = false;
      //gets param from user data
      const param = fields[jobForm][jobParam];
      let fillValue = res[param];
      if (!fillValue) continue;
      let inputElement = inputQuery(jobParam, form);
      if (!inputElement) continue;

      if (param === "Gender" || "Location (City)") useLongDelay = true;
      if (param === "Location (City)")  fillValue = formatCityStateCountry(res, param);

      setNativeValue(inputElement, fillValue);
      //for the dropdown elements
      let btn = inputElement.closest(".select__control--outside-label");
      if (!btn) continue;

      btn.dispatchEvent(mouseUpEvent);
      await sleep(useLongDelay ? delays.long : delays.short);
      btn.dispatchEvent(keyDownEvent);
      await sleep(delays.short);
    }
    // Learning/fill engine runs on everything the profile pass left empty, and learns
    // manual fills for next time.
    await runLearningEngine(form, window.location.hostname, res);
    scrollToTop();
    console.log(`Autofill Jobs: Complete in ${getTimeElapsed(initTime)}s.`);
    break; //found site
  }
  
}

