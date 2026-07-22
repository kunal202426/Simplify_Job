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
const embedding = load("embedding.js");
const engine = load("engine.js");

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

console.log("\n# malformed bank entry must not crash matching for the whole page (real production bug: jobs.sap.com)");
const corruptBank = {};
corruptBank["h1"] = { value: "No", fieldType: "text", tokens: auditorA, optionsSeen: [] };
corruptBank["corrupt"] = { value: "stale", fieldType: "text", tokens: "not an array", optionsSeen: [] };
let corruptThrew = false;
let corruptDecision;
try {
  corruptDecision = matcher.matchField(querySig, {}, corruptBank, fmt.matchOption);
} catch (e) {
  corruptThrew = true;
}
ok("matchField does not throw when a bank entry has non-array tokens", !corruptThrew);
ok("...and still resolves the good entry via fuzzy match", corruptDecision && corruptDecision.value === "No");

console.log("\n# profile freshness beats a stale learned entry (Workday address regression)");
const addr1Tokens = sig.labelTokens("Address Line 1");
const addr1Hash = sig.signatureHash(addr1Tokens, "text");
const staleBank = {};
staleBank[addr1Hash] = { value: "413 ZOY Prestige, Old Address", fieldType: "text", tokens: addr1Tokens, optionsSeen: [] };
const addr1Sig = { hash: addr1Hash, fieldType: "text", tokens: addr1Tokens, options: [] };
const profileRes = { "Location (Street)": "123 Example Street, Springfield" };
const addrDecision = matcher.matchField(addr1Sig, profileRes, staleBank, fmt.matchOption);
eq("fresh profile address wins over a stale learned address", addrDecision.value, "123 Example Street, Springfield");
eq("...source is profile, not the stale learned entry", addrDecision.source, "profile");

console.log("\n# fuzzy matcher does not confuse enumerated fields (the real cause of the Workday duplication)");
const line1Tokens = sig.labelTokens("Address Line 1");
const line2Tokens = sig.labelTokens("Address Line 2");
const line3Tokens = sig.labelTokens("Address Line 3");
eq("Address Line 1 vs Line 2 similarity is 0 despite sharing 'address'+'line'", matcher.labelSimilarity(line1Tokens, line2Tokens), 0);
eq("Address Line 1 vs Line 3 similarity is 0", matcher.labelSimilarity(line1Tokens, line3Tokens), 0);
const line2Bank = {};
line2Bank["l1"] = { value: "413 ZOY Prestige, Old Address", fieldType: "text", tokens: line1Tokens, optionsSeen: [] };
const line2Query = { hash: "l2", fieldType: "text", tokens: line2Tokens, options: [] };
eq("Line 2 no longer fuzzy-inherits Line 1's learned value", matcher.matchField(line2Query, {}, line2Bank, fmt.matchOption).source, "none");

console.log("\n# address overflow lines are not stuffed with the single street value (Workday duplication regression)");
const line2Sig = { tokens: sig.labelTokens("Address Line 2") };
const line3Sig = { tokens: sig.labelTokens("Address Line 3") };
const line1LocalSig = { tokens: sig.labelTokens("Address Line 1 - Local") };
eq("Address Line 2 gets no profile match", matcher.matchProfile(line2Sig, profileRes), null);
eq("Address Line 3 gets no profile match", matcher.matchProfile(line3Sig, profileRes), null);
ok("Address Line 1 - Local still gets a profile match", matcher.matchProfile(line1LocalSig, profileRes) !== null);

console.log("\n# compliance-question defaults (recurring 'previously employed by <Company>' questions)");
const wellsFargoSig = {
  hash: "wf1", fieldType: "radio",
  tokens: sig.labelTokens("Have you previously been employed by Wells Fargo or engaged as a contingent resource?"),
  options: ["Yes", "No"],
};
eq("Wells Fargo phrasing defaults to No with no learned data at all",
  matcher.matchField(wellsFargoSig, {}, {}, fmt.matchOption).value, "No");
eq("...source is compliance-default, not a lucky fuzzy guess",
  matcher.matchField(wellsFargoSig, {}, {}, fmt.matchOption).source, "compliance-default");

const citiSig = {
  hash: "citi1", fieldType: "radio",
  tokens: sig.labelTokens("Have you previously been employed by Citigroup or engaged as a contingent worker?"),
  options: ["Yes", "No"],
};
eq("the SAME rule fires for a different employer's name (Citigroup vs Wells Fargo)",
  matcher.matchField(citiSig, {}, {}, fmt.matchOption).value, "No");

const priorLearnedBank = {};
priorLearnedBank["wf1"] = { value: "Yes", fieldType: "radio", tokens: wellsFargoSig.tokens, optionsSeen: [] };
eq("an exact-hash learned correction (same employer, manually flipped to Yes) still wins",
  matcher.matchField(wellsFargoSig, {}, priorLearnedBank, fmt.matchOption).value, "Yes");

const unrelatedEmployedSig = {
  hash: "u1", fieldType: "text",
  tokens: sig.labelTokens("Current Employer"),
  options: [],
};
eq("an unrelated employment question is not swept up by the compliance default",
  matcher.matchComplianceDefault(unrelatedEmployedSig), null);

console.log("\n# profile matching");
const res = { "Email": "a@b.com", "First Name": "Ada", "Phone": "123", "LinkedIn": "u" };
eq("email field -> profile email",
  matcher.matchField({ hash: "x", fieldType: "text", tokens: sig.labelTokens("Email Address"), options: [] }, res, {}, fmt.matchOption).value,
  "a@b.com");
eq("first name field -> profile first name",
  matcher.matchProfile({ tokens: sig.labelTokens("First Name") }, res).key, "First Name");

const dobRes = { "Date of Birth": "26/04/2004" };
eq("'Date of Birth' field -> profile DOB",
  matcher.matchProfile({ tokens: sig.labelTokens("Date of Birth") }, dobRes).key, "Date of Birth");
eq("'DOB' field -> profile DOB",
  matcher.matchProfile({ tokens: sig.labelTokens("DOB") }, dobRes).key, "Date of Birth");
eq("DOB converts dd/mm/yyyy into a native date input's yyyy-mm-dd",
  fmt.convertValue({ getAttribute: (a) => (a === "type" ? "date" : null) }, "26/04/2004", { fieldType: "text" }).value,
  "2004-04-26");

console.log("\n# format: option mapping across enum wordings");
eq("Yes maps to Y", fmt.matchOption("Yes", ["Y", "N"]), "Y");
eq("No maps to Disagree bucket", fmt.matchOption("No", ["Agree", "Disagree"]), "Disagree");
eq("Decline maps to Prefer not to say",
  fmt.matchOption("Decline to self identify", ["Male", "Female", "Prefer not to say"]), "Prefer not to say");
eq("exact enum wording preserved",
  fmt.matchOption("Bachelor's Degree", ["High School", "Bachelor's Degree", "Master's Degree"]), "Bachelor's Degree");
eq("unmappable option returns null", fmt.matchOption("Purple", ["Yes", "No"]), null);
eq("'Bachelor' still matches 'Bachelor's Degree' via containment (both sides specific enough)",
  fmt.matchOption("Bachelor", ["High School", "Bachelor's Degree", "Master's Degree"]), "Bachelor's Degree");

console.log("\n# format: short generic values must not false-positive via substring containment");
eq("'No' does not match 'Norway' in a country dropdown (was a real false-positive risk)",
  fmt.matchOption("No", ["Norway", "South Africa", "Not Applicable"]), null);
eq("'No' does not match 'North Korea'",
  fmt.matchOption("No", ["North Korea", "South Korea"]), null);

console.log("\n# format: raw substring containment must respect word boundaries (real bug: India -> British Indian Ocean Territory)");
eq("'India' does not match 'British Indian Ocean Territory' (raw substring of 'Indian', not a whole word)",
  fmt.matchOption("India", ["India", "British Indian Ocean Territory", "Indonesia"]), "India");
eq("'India' resolves correctly even when the exact option is not first in the list",
  fmt.matchOption("India", ["British Indian Ocean Territory", "Indonesia", "India"]), "India");
eq("'Niger' does not match 'Nigeria' (whole-word boundary, not a same-country typo)",
  fmt.matchOption("Niger", ["Nigeria", "Chad", "Mali"]), null);

console.log("\n# format: date conversion");
eq("Jun 2022 -> 06/2022", fmt.formatDateToPattern(fmt.parseCanonicalDate("Jun 2022"), "MM/YYYY"), "06/2022");
eq("Jun 2022 -> 2022-06", fmt.formatDateToPattern(fmt.parseCanonicalDate("Jun 2022"), "yyyy-mm"), "2022-06");
eq("2022-06 -> June 2022", fmt.formatDateToPattern(fmt.parseCanonicalDate("2022-06"), "MMMM YYYY"), "June 2022");
eq("dd/mm/yyyy canonical -> mm/dd/yyyy", fmt.formatDateToPattern(fmt.parseCanonicalDate("06/07/2022"), "mm/dd/yyyy"), "07/06/2022");
eq("year only preserved", fmt.formatDateToPattern(fmt.parseCanonicalDate("2024"), "yyyy"), "2024");

console.log("\n# format: phone separators");
eq("digits grouped to hint", fmt.formatPhone("1234567890", "___-___-____"), "123-456-7890");
eq("strips existing separators first", fmt.formatPhone("(123) 456-7890", "###.###.####"), "123.456.7890");

console.log("\n# format: phone field paired with a country-code selector (British Council regression)");
const bareDigitPhoneEl = { getAttribute: () => null };
eq("stored '+91XXXXXXXXXX' becomes bare local digits when no separator hint exists",
  fmt.convertValue(bareDigitPhoneEl, "+919876543210", { fieldType: "text", normalized: "phone" }).value,
  "9876543210");
eq("already-bare 10-digit number passes through unchanged",
  fmt.convertValue(bareDigitPhoneEl, "9123456780", { fieldType: "text", normalized: "mobile phone" }).value,
  "9123456780");

console.log("\n# resume-field label matching (multi-file-input ATSes like Oracle Cloud)");
eq("'Upload Resume' matches", engine.afjLooksLikeResumeLabel(sig.normalizeLabel("Upload Resume")), true);
eq("'Resume/CV' matches", engine.afjLooksLikeResumeLabel(sig.normalizeLabel("Resume/CV")), true);
eq("'Upload Cover Letter' does not match", engine.afjLooksLikeResumeLabel(sig.normalizeLabel("Upload Cover Letter")), false);
eq("'Upload Attachment' does not match", engine.afjLooksLikeResumeLabel(sig.normalizeLabel("Upload Attachment")), false);
eq("'Portfolio Link' does not match", engine.afjLooksLikeResumeLabel(sig.normalizeLabel("Portfolio")), false);

console.log("\n# pill-group action-button safety gate");
eq("'Submit' is an action button", sig.sigLooksLikeActionButton("Submit"), true);
eq("'Next' is an action button", sig.sigLooksLikeActionButton("Next"), true);
eq("'Add Another Link' is an action button", sig.sigLooksLikeActionButton("Add Another Link"), true);
eq("'Remove' is an action button", sig.sigLooksLikeActionButton("Remove"), true);
eq("'Mr.' is NOT an action button (real option)", sig.sigLooksLikeActionButton("Mr."), false);
eq("'Full-time' is NOT an action button (real option)", sig.sigLooksLikeActionButton("Full-time"), false);
eq("empty text counts as an action/exclude (never a valid option)", sig.sigLooksLikeActionButton(""), true);

console.log("\n# embedding safety gate: qualifier/digit differences beat similarity score");
eq("'Address Line 1' vs 'Address Line 2' -> gated (digit differs)",
  engine.afjDiffersOnlyByQualifier(sig.labelTokens("Address Line 1"), sig.labelTokens("Address Line 2")), true);
eq("'First Name' vs 'Last Name' -> gated (qualifier differs)",
  engine.afjDiffersOnlyByQualifier(sig.labelTokens("First Name"), sig.labelTokens("Last Name")), true);
eq("'Home Phone' vs 'Work Phone' -> gated (qualifier differs)",
  engine.afjDiffersOnlyByQualifier(sig.labelTokens("Home Phone"), sig.labelTokens("Work Phone")), true);
eq("identical labels -> NOT gated", engine.afjDiffersOnlyByQualifier(sig.labelTokens("Email"), sig.labelTokens("Email")), false);
eq("genuinely different questions -> NOT gated (too many differing tokens)",
  engine.afjDiffersOnlyByQualifier(sig.labelTokens("Notice Period"), sig.labelTokens("Visa Sponsorship Required")), false);
eq("reworded auditor question -> NOT gated (differing tokens aren't qualifiers)",
  engine.afjDiffersOnlyByQualifier(
    sig.labelTokens("Have you been employed by our statutory auditor"),
    sig.labelTokens("Are you or have you been employed by the firm's external auditor")
  ), false);

console.log("\n# embedding cosine similarity (pure math, model-independent)");
eq("identical vectors -> similarity 1", embedding.afjCosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
eq("orthogonal vectors -> similarity 0", embedding.afjCosineSimilarity([1, 0], [0, 1]), 0);
eq("opposite vectors -> similarity -1", embedding.afjCosineSimilarity([1, 0], [-1, 0]), -1);
ok("scale-invariant (unnormalized input still gives correct cosine)",
  Math.abs(embedding.afjCosineSimilarity([2, 0], [3, 0]) - 1) < 1e-9);
eq("mismatched lengths -> 0 (never throws)", embedding.afjCosineSimilarity([1, 2], [1, 2, 3]), 0);
eq("null input -> 0 (never throws)", embedding.afjCosineSimilarity(null, [1]), 0);

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
