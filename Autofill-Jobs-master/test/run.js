/*
  Headless unit tests for the pure (DOM-free) cores of the learning engine.
  Run: node test/run.js
*/
const path = require("path");
const fs = require("fs");
const CS = path.join(__dirname, "..", "src", "public", "contentScripts");

// The content scripts live under src/, whose package.json sets "type":"module", so a plain
// require() would treat them as ESM and skip their CommonJS export guard. Load them as
// classic scripts instead — their DOM/chrome references are all inside functions, so
// evaluating the top level is safe here.
function load(file) {
  const code = fs.readFileSync(path.join(CS, file), "utf8");
  const m = { exports: {} };
  new Function("module", "exports", code)(m, m.exports);
  return m.exports;
}
const sig = load("signature.js");
const matcher = load("matcher.js");
const fmt = load("formatConvert.js");

let pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("FAIL  " + name); }
}
function eq(name, a, b) { ok(name + ` (got ${JSON.stringify(a)})`, a === b); }

console.log("\n# signature");
eq("word order doesn't change hash",
  sig.signatureHash(sig.labelTokens("statutory auditor employed"), "text"),
  sig.signatureHash(sig.labelTokens("employed auditor statutory"), "text"));
ok("field type changes hash",
  sig.signatureHash(sig.labelTokens("gender"), "text") !==
  sig.signatureHash(sig.labelTokens("gender"), "select"));
ok("required marker stripped",
  sig.normalizeLabel("First Name *") === "first name" &&
  sig.normalizeLabel("First Name (required)") === "first name");
ok("stopwords removed", !sig.labelTokens("Do you have a LinkedIn").includes("you"));

console.log("\n# fuzzy label similarity (the hard part)");
const auditorA = sig.labelTokens("Have you been employed by our statutory auditor");
const auditorB = sig.labelTokens("Are you or have you been employed by the firm's external auditor");
const simAuditor = matcher.labelSimilarity(auditorA, auditorB);
ok(`reworded auditor question matches (sim=${simAuditor.toFixed(2)} >= ${matcher.FUZZY_AUTO_THRESHOLD})`,
  simAuditor >= matcher.FUZZY_AUTO_THRESHOLD);

const sponsorA = sig.labelTokens("Will you now or in the future require visa sponsorship");
const sponsorB = sig.labelTokens("Do you require sponsorship for an employment visa");
ok(`reworded sponsorship question matches (sim=${matcher.labelSimilarity(sponsorA, sponsorB).toFixed(2)})`,
  matcher.labelSimilarity(sponsorA, sponsorB) >= matcher.FUZZY_AUTO_THRESHOLD);

// Negative: different questions sharing only a generic token must NOT match.
const firstName = sig.labelTokens("First Name");
const lastName = sig.labelTokens("Last Name");
eq("first vs last name do not fuzzy-match", matcher.labelSimilarity(firstName, lastName), 0);

const felony = sig.labelTokens("Have you ever been convicted of a felony");
const auth = sig.labelTokens("Are you legally authorized to work in the United States");
eq("unrelated compliance questions do not match", matcher.labelSimilarity(felony, auth), 0);

console.log("\n# matchLearned end-to-end via bank");
const bank = {};
const learnedSig = { hash: "h1", fieldType: "text", tokens: auditorA, options: [] };
bank[learnedSig.hash] = { value: "No", fieldType: "text", tokens: auditorA, optionsSeen: [] };
const querySig = { hash: "h2", fieldType: "text", tokens: auditorB, options: [] };
const decision = matcher.matchField(querySig, {}, bank, fmt.matchOption);
eq("reworded question resolves to learned value", decision.value, "No");
eq("...flagged as fuzzy", decision.source, "fuzzy-matched");

const exactSig = { hash: "h1", fieldType: "text", tokens: auditorA, options: [] };
eq("exact hash beats fuzzy", matcher.matchField(exactSig, {}, bank, fmt.matchOption).source, "learned-exact");

console.log("\n# profile matching");
const res = { "Email": "a@b.com", "First Name": "Ada", "Phone": "123", "LinkedIn": "u" };
eq("email field -> profile email",
  matcher.matchField({ hash: "x", fieldType: "text", tokens: sig.labelTokens("Email Address"), options: [] }, res, {}, fmt.matchOption).value,
  "a@b.com");
eq("first name field -> profile first name",
  matcher.matchProfile({ tokens: sig.labelTokens("First Name") }, res).key, "First Name");

console.log("\n# format: option mapping across enum wordings");
eq("Yes maps to Y", fmt.matchOption("Yes", ["Y", "N"]), "Y");
eq("No maps to Disagree bucket", fmt.matchOption("No", ["Agree", "Disagree"]), "Disagree");
eq("Decline maps to Prefer not to say",
  fmt.matchOption("Decline to self identify", ["Male", "Female", "Prefer not to say"]), "Prefer not to say");
eq("exact enum wording preserved",
  fmt.matchOption("Bachelor's Degree", ["High School", "Bachelor's Degree", "Master's Degree"]), "Bachelor's Degree");
eq("unmappable option returns null", fmt.matchOption("Purple", ["Yes", "No"]), null);

console.log("\n# format: date conversion");
eq("Jun 2022 -> 06/2022", fmt.formatDateToPattern(fmt.parseCanonicalDate("Jun 2022"), "MM/YYYY"), "06/2022");
eq("Jun 2022 -> 2022-06", fmt.formatDateToPattern(fmt.parseCanonicalDate("Jun 2022"), "yyyy-mm"), "2022-06");
eq("2022-06 -> June 2022", fmt.formatDateToPattern(fmt.parseCanonicalDate("2022-06"), "MMMM YYYY"), "June 2022");
eq("dd/mm/yyyy canonical -> mm/dd/yyyy", fmt.formatDateToPattern(fmt.parseCanonicalDate("06/07/2022"), "mm/dd/yyyy"), "07/06/2022");
eq("year only preserved", fmt.formatDateToPattern(fmt.parseCanonicalDate("2024"), "yyyy"), "2024");

console.log("\n# format: phone separators");
eq("digits grouped to hint", fmt.formatPhone("1234567890", "___-___-____"), "123-456-7890");
eq("strips existing separators first", fmt.formatPhone("(123) 456-7890", "###.###.####"), "123.456.7890");

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
