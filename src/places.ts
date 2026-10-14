import { lang, type Lang } from './i18n';

/**
 * Places that go by another name in German than in English — the big
 * cities, mostly. family.md keeps whatever was typed; the app shows it in its
 * own language and finds it by either name. A place not in the list is shown
 * as written: most towns are called the same everywhere.
 *
 * Each row: German, English, then other spellings worth recognising — the
 * local name, an older one, one without its accents.
 */
const PLACES: Array<[de: string, en: string, ...others: string[]]> = [
  ['München', 'Munich', 'Muenchen'],
  ['Nürnberg', 'Nuremberg', 'Nuernberg'],
  ['Köln', 'Cologne', 'Koeln'],
  ['Hannover', 'Hanover'],
  ['Braunschweig', 'Brunswick'],
  ['Wien', 'Vienna'],
  ['Zürich', 'Zurich', 'Zuerich'],
  ['Genf', 'Geneva', 'Genève'],
  ['Luzern', 'Lucerne'],
  ['Prag', 'Prague', 'Praha'],
  ['Pressburg', 'Bratislava'],
  ['Warschau', 'Warsaw', 'Warszawa'],
  ['Krakau', 'Kraków', 'Krakow'],
  ['Danzig', 'Gdańsk', 'Gdansk'],
  ['Breslau', 'Wrocław', 'Wroclaw'],
  ['Posen', 'Poznań', 'Poznan'],
  ['Stettin', 'Szczecin'],
  ['Kattowitz', 'Katowice'],
  ['Kopenhagen', 'Copenhagen', 'København'],
  ['Göteborg', 'Gothenburg', 'Goeteborg'],
  ['Den Haag', 'The Hague', "'s-Gravenhage"],
  ['Brüssel', 'Brussels', 'Bruxelles', 'Brussel'],
  ['Antwerpen', 'Antwerp'],
  ['Lüttich', 'Liège', 'Liege'],
  ['Löwen', 'Leuven'],
  ['Rom', 'Rome', 'Roma'],
  ['Mailand', 'Milan', 'Milano'],
  ['Venedig', 'Venice', 'Venezia'],
  ['Neapel', 'Naples', 'Napoli'],
  ['Florenz', 'Florence', 'Firenze'],
  ['Genua', 'Genoa', 'Genova'],
  ['Turin', 'Turin', 'Torino'],
  ['Lissabon', 'Lisbon', 'Lisboa'],
  ['Sevilla', 'Seville'],
  ['Athen', 'Athens', 'Athína'],
  ['Moskau', 'Moscow', 'Moskva'],
  ['Sankt Petersburg', 'Saint Petersburg', 'St. Petersburg', 'Petersburg'],
  ['Kiew', 'Kyiv', 'Kiev', 'Kyjiw'],
  ['Belgrad', 'Belgrade', 'Beograd'],
  ['Bukarest', 'Bucharest', 'București', 'Bucuresti'],
  ['Kairo', 'Cairo'],
  ['Peking', 'Beijing'],
  ['Neu-Delhi', 'New Delhi'],
  ['Mexiko-Stadt', 'Mexico City'],
  ['Kapstadt', 'Cape Town'],
  ['Jerusalem', 'Jerusalem'],
];

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let byName: Map<string, (typeof PLACES)[number]> | undefined;
function lookup(): Map<string, (typeof PLACES)[number]> {
  if (!byName) {
    byName = new Map();
    for (const row of PLACES) for (const name of row) byName.set(fold(name), row);
  }
  return byName;
}

/** "Nuremberg" in German is "Nürnberg"; a place the list does not know stays as written. */
export function placeName(value: string, language: Lang = lang()): string {
  const row = lookup().get(fold(value));
  if (!row) return value;
  return language === 'de' ? row[0] : row[1];
}

/** Every name a place goes by, for search: "Nürnberg Nuremberg". */
export function placeNames(value: string): string[] {
  const row = lookup().get(fold(value));
  return row ? [...row] : [value];
}

/** The same place however it was written — so "Nürnberg" and "Nuremberg" count as one. */
export function placeKey(value: string): string {
  const row = lookup().get(fold(value));
  return row ? fold(row[0]) : fold(value);
}
