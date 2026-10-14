import { describe, expect, it } from 'vitest';
import { ageOf, hasBirthday, lifespan, parseDate, yearsBetween } from '../src/ui/format';

const on = (y: number, m: number, d: number) => ({ y, m, d });

describe('dates and ages', () => {
  it('reads year, month and day as far as they are given', () => {
    expect(parseDate('1956')).toEqual({ y: 1956 });
    expect(parseDate('1956-04')).toEqual({ y: 1956, m: 4 });
    expect(parseDate('1956-04-02')).toEqual({ y: 1956, m: 4, d: 2 });
    expect(parseDate('Frühjahr 1956')).toBeUndefined();
    expect(parseDate('?')).toBeUndefined();
  });

  it('counts whole years, the day before a birthday included', () => {
    expect(yearsBetween(on(1989, 5, 23), on(2026, 5, 22))).toEqual({ years: 36, approx: false });
    expect(yearsBetween(on(1989, 5, 23), on(2026, 5, 23))).toEqual({ years: 37, approx: false });
    expect(yearsBetween(on(1989, 5, 23), on(2026, 10, 7))).toEqual({ years: 37, approx: false });
  });

  it('marks an age as approximate when the birthday may not have passed yet', () => {
    expect(yearsBetween({ y: 1989 }, on(2026, 10, 7))).toEqual({ years: 37, approx: true });
    expect(yearsBetween({ y: 1989, m: 10 }, on(2026, 10, 7))).toEqual({ years: 37, approx: true });
    // A different month settles it even without a day.
    expect(yearsBetween({ y: 1989, m: 5 }, on(2026, 10, 7))).toEqual({ years: 37, approx: false });
  });

  it('gives the living their age and the dead the age they reached', () => {
    const now = on(2026, 10, 7);
    expect(ageOf({ id: 'a', name: 'A', born: '1989-05-23' }, now)).toEqual({ years: 37, approx: false, final: false });
    expect(ageOf({ id: 'b', name: 'B', born: '1931-04-02', died: '2011-08-17' }, now)).toEqual({
      years: 80,
      approx: false,
      final: true,
    });
  });

  it('gives no age where it would be a guess', () => {
    const now = on(2026, 10, 7);
    expect(ageOf({ id: 'a', name: 'A' }, now)).toBeUndefined();
    // Died, but nobody wrote down when.
    expect(ageOf({ id: 'b', name: 'B', born: '1931', died: '?' }, now)).toBeUndefined();
    // Far too old to still be alive — the death date is just missing.
    expect(ageOf({ id: 'c', name: 'C', born: '1880' }, now)).toBeUndefined();
  });

  it('knows whose birthday it is', () => {
    expect(hasBirthday({ id: 'a', name: 'A', born: '1989-10-07' }, on(2026, 10, 7))).toBe(true);
    expect(hasBirthday({ id: 'a', name: 'A', born: '1989-10' }, on(2026, 10, 7))).toBe(false);
    expect(hasBirthday({ id: 'a', name: 'A', born: '1931-10-07', died: '2011' }, on(2026, 10, 7))).toBe(false);
  });
});

describe('lifespan', () => {
  it('marks a death without a date with a cross rather than the word', () => {
    expect(lifespan({ id: 'a', name: 'A', born: '1920', died: 'true' })).toBe('1920 – †');
    expect(lifespan({ id: 'a', name: 'A', born: '1920', died: '?' })).toBe('1920 – †');
    expect(lifespan({ id: 'a', name: 'A', died: 'ja' })).toBe('†');
  });

  it('prints known years as before', () => {
    expect(lifespan({ id: 'a', name: 'A', born: '1920-03-01', died: '1990' })).toBe('1920 – 1990');
    expect(lifespan({ id: 'a', name: 'A', born: '1986' })).toBe('* 1986');
    expect(lifespan({ id: 'a', name: 'A', born: '?' })).toBe('');
  });
});
