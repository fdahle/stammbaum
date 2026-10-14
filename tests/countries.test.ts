import { describe, expect, it } from 'vitest';
import { countryCode, countryList, countryName } from '../src/countries';
import { Family } from '../src/family';
import { parseFamily } from '../src/parser/parse';
import { applyEdits } from '../src/parser/write';
import { familyStats } from '../src/stats';

describe('countries', () => {
  it('keeps codes in the file and names on screen, in either language', () => {
    expect(countryCode('Deutschland')).toBe('DE');
    expect(countryCode('germany')).toBe('DE');
    expect(countryCode('de')).toBe('DE');
    expect(countryCode('Norwegen')).toBe('NO');
    expect(countryCode('Niederlande')).toBe('NL');
    expect(countryCode('USA')).toBe('US');
    expect(countryName('NO', 'de')).toBe('Norwegen');
    expect(countryName('NO', 'en')).toBe('Norway');
  });

  it('keeps a country that is no longer one as written', () => {
    expect(countryCode('DDR')).toBe('DDR');
    expect(countryName('DDR', 'de')).toBe('DDR');
  });

  it('round-trips through the file, nationalities as a list', () => {
    const { markdown } = applyEdits('```family\nperson felix "Felix Dahle" birthplace=Nürnberg lives=Leiden job=Arzt\n```\n', [
      { kind: 'person', id: 'felix', set: { birthcountry: 'DE', country: 'NL', nationality: 'DE, NL' } },
    ]);
    // Each country next to its place, the nationality after the country.
    expect(markdown).toContain('person felix "Felix Dahle" birthplace=Nürnberg birthcountry=DE lives=Leiden country=NL nationality="DE, NL" job=Arzt');
    const felix = parseFamily(markdown).people.get('felix')!;
    expect(felix).toMatchObject({ birthcountry: 'DE', country: 'NL' });
    expect(countryList(felix.nationality)).toEqual(['DE', 'NL']);
  });

  it('are found by name and counted in the numbers', () => {
    const family = new Family(
      parseFamily('```family\nperson a "Anna" birthcountry=DE country=NO\nperson b "Ben" birthcountry=DE country=NL\nperson c "Cleo" birthcountry=NL\n```\n'),
    );
    expect(family.search('norway').map((p) => p.id)).toEqual(['a']);
    expect(family.search('Norwegen').map((p) => p.id)).toEqual(['a']);
    const stats = familyStats(family, { y: 2026, m: 10, d: 14 });
    expect(stats.birthCountries).toEqual(['DE', 'NL']);
    expect(stats.homeCountries?.sort()).toEqual(['NL', 'NO']);
  });
});
