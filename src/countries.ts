import { LANGS, lang, type Lang } from './i18n';

/**
 * Countries are written into family.md as their two-letter ISO code — `DE`,
 * `NL`, `NO` — and shown by name in whichever language the app speaks. A
 * country that is no longer one, such as the DDR or Prussia, stays as it was
 * written and is shown that way.
 */
const CODES = (
  'AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ ' +
  'CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR ' +
  'GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP ' +
  'KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT ' +
  'MU MV MW MX MY MZ NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY QA RE RO RS RU RW ' +
  'SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG ' +
  'UM US UY UZ VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW'
).split(' ');
const KNOWN = new Set(CODES);

/** What people type that the names alone would miss. */
const ALIASES: Record<string, string> = {
  usa: 'US',
  'u.s.a.': 'US',
  'u.s.': 'US',
  amerika: 'US',
  america: 'US',
  uk: 'GB',
  'great britain': 'GB',
  grossbritannien: 'GB',
  holland: 'NL',
  'the netherlands': 'NL',
  turkei: 'TR',
  turkiye: 'TR',
  tschechien: 'CZ',
  czechia: 'CZ',
};

const displays = new Map<Lang, Intl.DisplayNames>();
function display(language: Lang): Intl.DisplayNames {
  let names = displays.get(language);
  if (!names) {
    names = new Intl.DisplayNames([language], { type: 'region' });
    displays.set(language, names);
  }
  return names;
}

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim();
}

/** Every name a country goes by in either language, folded, to its code. */
let byName: Map<string, string> | undefined;
function lookup(): Map<string, string> {
  if (!byName) {
    byName = new Map(Object.entries(ALIASES));
    for (const { id } of LANGS) {
      for (const code of CODES) {
        const name = display(id).of(code);
        if (name && name !== code) byName.set(fold(name), code);
      }
    }
  }
  return byName;
}

/** `DE` → "Deutschland" (or "Germany"); anything else as it was written. */
export function countryName(value: string, language: Lang = lang()): string {
  return KNOWN.has(value) ? (display(language).of(value) ?? value) : value;
}

/** "Deutschland", "germany", "de" → `DE`; a country it does not know stays as typed. */
export function countryCode(input: string): string {
  const text = input.trim();
  if (KNOWN.has(text.toUpperCase()) && text.length === 2) return text.toUpperCase();
  return lookup().get(fold(text)) ?? text;
}

/** A list of countries as written in the file — `DE, NL` — one by one. */
export function countryList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Every country by name in the current language, for suggestions while typing. */
export function countryNames(language: Lang = lang()): string[] {
  return CODES.map((code) => countryName(code, language)).filter((name) => name.length > 2).sort((a, b) => a.localeCompare(b, language));
}

/**
 * `DE` → 🇩🇪: two regional-indicator letters. Windows draws none of them in
 * Chrome or Edge, so main.ts loads a small font with just the flags there.
 */
export function countryFlag(value: string): string {
  if (!__FLAGS__ || !KNOWN.has(value)) return '';
  return String.fromCodePoint(...[...value].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65));
}

/** "🇩🇪 Deutschland" — the flag to spot it, the name to be sure; as written for a former country. */
export function countryLabel(value: string, language: Lang = lang()): string {
  const flag = countryFlag(value);
  return flag ? `${flag} ${countryName(value, language)}` : countryName(value, language);
}
