import type { TitleMatchMode } from "@/models/automation.model";

const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/\s+/g, " ").trim();
const normalizeTitle = (value: string) => normalize(normalize(value).replace(/[\u2010-\u2015_-]+/g, " "));

function wholeTerm(text: string, term: string): boolean {
  // Han addresses often omit spaces between country and city names.
  if (/\p{Script=Han}/u.test(term)) return text.includes(term);
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp("(^|[^\\p{L}\\p{N}+#])" + escaped + "(?=$|[^\\p{L}\\p{N}+#])", "u").test(text);
}

export function titleMatches(title: string, fragments: string[], mode: TitleMatchMode = "contains"): boolean {
  const wanted = fragments.map(normalizeTitle).filter(Boolean);
  if (!wanted.length) return true;
  const text = normalizeTitle(title);
  return wanted.some((term) => mode === "words" ? wholeTerm(text, term) : text.includes(term));
}

// Explicit aliases only. In particular CA is not Canada, and city/state names
// are not inferred to belong to a country. Remote retains its literal meaning.
const COUNTRY_ALIASES = [
  ["united states", "united states of america", "us", "usa", "u.s.", "u.s", "u.s.a.", "u.s.a"],
  ["taiwan", "tw", "twn", "台灣", "臺灣", "台湾"],
  ["united kingdom", "uk", "u.k.", "u.k"],
];

export function locationMatches(jobLocation: string, wanted: string[]): boolean {
  const terms = wanted.map(normalize).filter(Boolean);
  if (!terms.length) return true;
  const text = normalize(jobLocation);
  return terms.some((term) => {
    const aliases = COUNTRY_ALIASES.find((group) => group.includes(term));
    return (aliases ?? [term]).some((alias) => wholeTerm(text, alias));
  });
}

export function isUnknownLocation(value: string): boolean {
  return !value.trim() || /^(multiple|various|unspecified|unknown)( locations?)?$/i.test(value.trim());
}
