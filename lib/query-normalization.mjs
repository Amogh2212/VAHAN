const UNICODE_DASHES = /[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]/g;
const CURLY_APOSTROPHES = /[\u2018\u2019\u02BC\uFF07]/g;

const RTO_PREFIX_STATES = Object.freeze({
  AN: "Andaman and Nicobar Islands",
  AP: "Andhra Pradesh",
  AR: "Arunachal Pradesh",
  AS: "Assam",
  BR: "Bihar",
  CG: "Chhattisgarh",
  CH: "Chandigarh",
  DD: "Daman and Diu",
  DL: "Delhi",
  DN: "Dadra and Nagar Haveli",
  GA: "Goa",
  GJ: "Gujarat",
  HP: "Himachal Pradesh",
  HR: "Haryana",
  JH: "Jharkhand",
  JK: "Jammu & Kashmir",
  KA: "Karnataka",
  KL: "Kerala",
  LA: "Ladakh",
  LD: "Lakshadweep",
  MH: "Maharashtra",
  ML: "Meghalaya",
  MN: "Manipur",
  MP: "Madhya Pradesh",
  MZ: "Mizoram",
  NL: "Nagaland",
  OD: "Odisha",
  OR: "Odisha",
  PB: "Punjab",
  PY: "Puducherry",
  RJ: "Rajasthan",
  SK: "Sikkim",
  TN: "Tamil Nadu",
  TR: "Tripura",
  TS: "Telangana",
  UA: "Uttarakhand",
  UK: "Uttarakhand",
  UP: "Uttar Pradesh",
  WB: "West Bengal",
});

const MONTH_REWRITES = [
  [/\bjan(?:uary)?\b/g, "january"],
  [/\bfeb(?:ruary)?\b/g, "february"],
  [/\bmar(?:ch)?\b/g, "march"],
  [/\bapr(?:il)?\b/g, "april"],
  [/\bmay\b/g, "may"],
  [/\bjun(?:e)?\b/g, "june"],
  [/\bjul(?:y)?\b/g, "july"],
  [/\baug(?:ust)?\b/g, "august"],
  [/\bsep(?:t|tember)?\b/g, "september"],
  [/\boct(?:ober)?\b/g, "october"],
  [/\bnov(?:ember)?\b/g, "november"],
  [/\bdec(?:ember)?\b/g, "december"],
];

const BS_REWRITES = [
  [/\bbs\s*(?:1|i)\b/g, "bs i"],
  [/\bbs\s*(?:2|ii)\b/g, "bs ii"],
  [/\bbs\s*(?:3|iii)\b/g, "bs iii"],
  [/\bbs\s*(?:4|iv)\b/g, "bs iv"],
  [/\bbs\s*(?:6|vi)\b/g, "bs vi"],
  [/\bbharat\s+stage\s*(?:1|i)\b/g, "bharat stage i"],
  [/\bbharat\s+stage\s*(?:2|ii)\b/g, "bharat stage ii"],
  [/\bbharat\s+stage\s*(?:3|iii)\b/g, "bharat stage iii"],
  [/\bbharat\s+stage\s*(?:4|iv)\b/g, "bharat stage iv"],
  [/\bbharat\s+stage\s*(?:6|vi)\b/g, "bharat stage vi"],
];

const PHRASE_REWRITES = [
  [/\bbattery\s+operated\s+vehicles?\b/g, "bov"],
  [/\bbattery\s+electric\s+vehicles?\b/g, "ev"],
  [/\belectric\s+vehicles?\b/g, "ev"],
  [/\bpassenger\s+cars?\b/g, "passenger car"],
  [/\btwo\s+wheelers?\b/g, "two wheeler"],
  [/\bthree\s+wheelers?\b/g, "three wheeler"],
  [/\bfour\s+wheelers?\b/g, "four wheeler"],
  [/\blight\s+motor\s+vehicles?\b/g, "light motor vehicle"],
  [/\bheavy\s+motor\s+vehicles?\b/g, "heavy motor vehicle"],
  [/\bregistration\s+counts?\b/g, "registrations"],
  [/\bregistrations?\s+counts?\b/g, "registrations"],
  [/\bregistered\b/g, "registrations"],
  [/\bregistrations?\b/g, "registrations"],
  [/\bvehicles\b/g, "vehicle"],
  [/\bcars\b/g, "car"],
  [/\bbuses\b/g, "bus"],
  [/\bmotorcycles\b/g, "motorcycle"],
  [/\bscooters\b/g, "scooter"],
  [/\bmopeds\b/g, "moped"],
  [/\btractors\b/g, "tractor"],
  [/\btaxis\b/g, "taxi"],
  [/\bambulances\b/g, "ambulance"],
  [/\btrucks\b/g, "truck"],
  [/\brickshaws\b/g, "rickshaw"],
];

export function normalizeDashboardStructuralText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(UNICODE_DASHES, "-")
    .replace(CURLY_APOSTROPHES, "'")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function rtoStateForCode(value) {
  const prefix = String(value ?? "").trim().slice(0, 2).toUpperCase();
  return RTO_PREFIX_STATES[prefix] ?? null;
}

export function normalizeDashboardQueryText(value) {
  let text = normalizeDashboardStructuralText(value)
    .replace(/\b(?:[a-z]\.){2,}[a-z]?\.?/g, (acronym) => acronym.replaceAll(".", ""))
    .replace(/\b([a-z0-9]+)'s\b/g, "$1")
    .replace(/'/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [pattern, replacement] of BS_REWRITES) text = text.replace(pattern, replacement);

  text = text
    .replace(/\b2\s*w\b/g, "two wheeler")
    .replace(/\b3\s*w\b/g, "three wheeler")
    .replace(/\b4\s*w\b/g, "four wheeler")
    .replace(/\bl\s*m\s*v\b/g, "light motor vehicle")
    .replace(/\bh\s*m\s*v\b/g, "heavy motor vehicle");

  for (const [pattern, replacement] of PHRASE_REWRITES) text = text.replace(pattern, replacement);
  for (const [pattern, replacement] of MONTH_REWRITES) text = text.replace(pattern, replacement);

  text = text.replace(/\b([a-z]{2})\s*0*(\d{1,2})\b/g, (match, prefix, number) => {
    if (!RTO_PREFIX_STATES[prefix.toUpperCase()]) return match;
    return `${prefix.toLowerCase()}-${String(Number(number)).padStart(2, "0")}`;
  });

  return text
    .replace(/\bregistrations(?:\s+registrations)+\b/g, "registrations")
    .replace(/\s+/g, " ")
    .trim();
}
