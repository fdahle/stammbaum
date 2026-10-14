import { countryName } from '../countries';
import { t } from '../i18n';
import type { Person } from '../parser/types';
import type { Stats } from '../stats';
import { shortName, year } from '../ui/format';

/** The family's records as tiles: how many, how old, how long. */
export function renderStats(stats: Stats): HTMLElement {
  const root = document.createElement('article');
  root.className = 'page-view';
  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = t().stats;
  const grid = document.createElement('div');
  grid.className = 'records';
  root.append(heading, grid);

  const add = (label: string, value: string, detail?: string, person?: Person) => {
    const element = document.createElement(person ? 'a' : 'div');
    element.className = 'record';
    if (element instanceof HTMLAnchorElement && person) element.href = `#/p/${encodeURIComponent(person.id)}`;
    const parts: Array<[string, string]> = [
      ['record-label', label],
      ['record-value', value],
    ];
    if (detail) parts.push(['record-detail', detail]);
    for (const [className, text] of parts) {
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      element.append(span);
    }
    grid.append(element);
  };
  const couple = (people: Person[]) => people.map(shortName).join(' & ');

  add(t().statPeople, String(stats.people), t().statPeopleDetail(stats.living, stats.deceased));
  add(t().statGenerations, String(stats.generations));
  add(t().statCouples, String(stats.couples));
  if (stats.oldestLiving) {
    const { person, years, approx } = stats.oldestLiving;
    add(t().statOldestLiving, t().years(years, approx), person.name, person);
  }
  if (stats.youngest) {
    add(t().statYoungest, shortName(stats.youngest), `* ${year(stats.youngest.born)}`, stats.youngest);
  }
  if (stats.oldestEver) {
    const { person, years, approx } = stats.oldestEver;
    add(t().statOldestEver, t().years(years, approx), person.name, person);
  }
  if (stats.longestMarriage) {
    const { people, years, lasting } = stats.longestMarriage;
    add(
      t().statLongestMarriage,
      t().years(years),
      [couple(people), lasting ? t().lasting : ''].filter(Boolean).join(' · '),
      people[0],
    );
  }
  if (stats.mostChildren) {
    const { couples, count } = stats.mostChildren;
    // One winner gets named; a tie only says how many share it.
    const [only] = couples;
    if (couples.length === 1 && only) add(t().statMostChildren, t().childCount(count), couple(only), only[0]);
    else add(t().statMostChildren, t().childCount(count), t().couplesTied(couples.length));
  }
  // A tie names every winner: "Bauer, Keller, Schmitt — 6-mal".
  if (stats.birthplace) add(t().statBirthplace, stats.birthplace.values.join(', '), t().times(stats.birthplace.count));
  if (stats.birthCountries) {
    add(t().statBirthCountries, String(stats.birthCountries.length), stats.birthCountries.map((c) => countryName(c)).join(', '));
  }
  if (stats.homeCountries) {
    add(t().statHomeCountries, String(stats.homeCountries.length), stats.homeCountries.map((c) => countryName(c)).join(', '));
  }
  if (stats.surname) add(t().statSurname, stats.surname.values.join(', '), t().times(stats.surname.count));
  if (stats.birthMonth) {
    const months = stats.birthMonth.values.map((m) => t().months[m - 1] ?? String(m));
    add(t().statBirthMonth, months.join(', '), t().times(stats.birthMonth.count));
  }
  return root;
}
