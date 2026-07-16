/*
    Utility variables / functions used by autofill.
*/

/**
 Fields per job board map to the stored params array in the extension
 */
 const fields = {
  greenhouse: {
    first_name: "First Name",
    last_name: "Last Name",
    "Preferred Name": "Full Name",
    email: "Email",
    phone: "Phone",
    LinkedIn: "LinkedIn",
    Github: "Github",
    Twitter: "Twitter/X",
    X: "Twitter/X",
    "candidate-location": "Location (City)",
    Website: "Website",
    Portfolio: "Website",
    Employer: "Current Employer",
    "Current Company": "Current Employer",
    resume: "Resume",
    school: "School",
    degree: "Degree",
    discipline: "Discipline",
    "start-month": "Start Date Month",
    "start-year": "Start Date Year",
    "end-month": "End Date Month",
    "end-year": "End Date Year",
    gender: "Gender",
    hispanic_ethnicity: "Hispanic/Latino",
    race: "Race",
    "react-select-race-placeholder race-error": "Race",
    veteran_status: "Veteran Status",
    disability: "Disability Status",
  },
  lever: {
    resume: "Resume",
    name: "Full Name",
    email: "Email",
    phone: "Phone",
    location: "Location (City)",
    org: "Current Employer",
    company: "Current Employer",
    employer: "Current Employer",
    "urls[LinkedIn]": "LinkedIn",
    "urls[GitHub]": "Github",
    "urls[Linkedin]": "LinkedIn",
    "urls[X]": "Twitter/X",
    "urls[Twitter]": "Twitter/X",
    "urls[Portfolio]": "Website",
    "urls[Link to portfolio]": "Website",
    website: "Website",
    portfolio: "Website",
    "eeo[gender]": "Gender",
    "eeo[race]": "Race",
    "eeo[veteran]": "Veteran Status",
    "eeo[disability]": "Disability Status",
    "eeo[disabilitySignature]": "Full Name",
    "eeo[disabilitySignatureDate]": "Current Date",
  },
  dover: {
    firstName: "First Name",
    lastName: "Last Name",
    email: "Email",
    phone: "Phone",
    linkedinUrl: "LinkedIn",
    github: "Github",
    phoneNumber: "Phone",
    resume: "Resume",
  },
  workday: {
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
  },
};

 const keyDownEvent = new KeyboardEvent("keydown", {
  key: "Enter",
  code: "Enter",
  keyCode: 13,
  which: 13,
  bubbles: true,
});
 const keyUpEvent = new KeyboardEvent("keyup", {
  key: "Enter",
  code: "Enter",
  keyCode: 13,
  which: 13,
  bubbles: true,
});
 const mouseUpEvent = new MouseEvent("mouseup", {
  bubbles: true,
  cancelable: true,
});
 const changeEvent = new Event("change", { bubbles: true });
 const inputEvent = new Event("input", { bubbles: true });

 function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
/** 
Get current date as string in day/month/year format.
*/
 function curDateStr() {
  return `${new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date())}`;
}
/**
Scroll to top of window. 
*/
 function scrollToTop() {
  window.scrollTo({ top: 0, behavior: "instant" });
}
/**
 Turns base64 string (w/o prefix) to array buffer.
*/
 function base64ToArrayBuffer(base64) {
  const binaryString = atob(base64);

  // Create a new ArrayBuffer and copy the binary string into it
  const arrayBuffer = new ArrayBuffer(binaryString.length);
  const view = new Uint8Array(arrayBuffer);

  // Convert binary string to an array of bytes
  for (let i = 0; i < binaryString.length; i++) {
    view[i] = binaryString.charCodeAt(i);
  }

  return arrayBuffer;
}
/**
 Turns month string into corresponding integer (ex: december -> 12).
 */
 function monthToNumber(month) {
  const months = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };
  const normalizedMonth = month.toLowerCase().trim();
  return months[normalizedMonth] || null;
}
/**
 Debug function to show runtime.
 */
 function getTimeElapsed(startTime) {
  let cur = new Date().getTime();
  return ((cur - startTime) / 1000).toFixed(3);
}
/**
 Data retreival for chrome local storage.
 */
 const getStorageDataLocal = (key) => {
  return new Promise((resolve) => {
    if (key === undefined) {
      // If no key is passed, fetch all data
      chrome.storage.local.get(null, resolve);
    } else {
      // If a key is passed, fetch only the value for that key
      chrome.storage.local.get(key, resolve);
    }
  });
};
/**
 Data retreival for chrome sync storage.
 */
 const getStorageDataSync = (key) => {
  return new Promise((resolve) => {
    if (key === undefined) {
      // If no key is passed, fetch all data
      chrome.storage.sync.get(null, resolve);
    } else {
      // If a key is passed, fetch only the value for that key
      chrome.storage.sync.get(key, resolve);
    }
  });
};
 function setNativeValue(el, value) {
  if (el.type === "checkbox" || el.type === "radio") {
    if ((!!value && !el.checked) || (!!!value && el.checked)) {
      el.click();
    }
  } else if (el instanceof HTMLSelectElement) {
    for (let o of el.children) {
      if (o.value.toLowerCase().includes(value.toLowerCase())) {
        el.value = o.value;
        break;
      }
    }
  } else el.value = value;
  const tracker = el._valueTracker;
  if (tracker) {
    tracker.setValue(previousValue);
  }
  // 'change' instead of 'input', see https://github.com/facebook/react/issues/11488#issuecomment-381590324
  el.setAttribute("value", value);
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
 const delays = {
  initial: 1000,
  short: 200,
  long: 600,
};
