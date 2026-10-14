import type { Occasion } from '../calendar';
import { t } from '../i18n';
import type { Person } from '../parser/types';
import { shortName } from '../ui/format';
import { bubble } from '../ui/tile';

/**
 * Who has a birthday or an anniversary soon — the list to check before
 * walking into a family gathering.
 */
export function renderDates(
  occasions: Occasion[],
  span: number,
  caption: (person: Person) => string | undefined,
): HTMLElement {
  const root = document.createElement('article');
  root.className = 'page-view';

  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = t().datesTitle;
  const hint = document.createElement('p');
  hint.className = 'page-hint';
  hint.textContent = t().datesSpan(span);
  root.append(heading, hint);

  if (occasions.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'page-hint';
    empty.textContent = t().datesNone;
    root.append(empty);
    return root;
  }

  const list = document.createElement('ul');
  list.className = 'dates-list';
  const weekday = new Intl.DateTimeFormat(t().locale, { weekday: 'short', day: 'numeric', month: 'long', timeZone: 'UTC' });
  for (const occasion of occasions) {
    const [first] = occasion.people;
    if (!first) continue;
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = `dates-row${occasion.days === 0 ? ' is-today' : ''}`;
    link.href = `#/p/${encodeURIComponent(first.id)}`;

    const bubbles = document.createElement('span');
    bubbles.className = 'dates-bubbles';
    bubbles.append(...occasion.people.map(bubble));

    const text = document.createElement('span');
    text.className = 'dates-text';
    const name = document.createElement('span');
    name.className = 'dates-name';
    name.textContent = occasion.people.map(shortName).join(' & ');
    const what = document.createElement('span');
    what.className = 'dates-what';
    const relation = occasion.kind === 'birthday' ? caption(first) : undefined;
    what.textContent = [
      occasion.kind === 'birthday' ? t().turns(occasion.years) : t().anniversary(occasion.kind, occasion.years),
      relation,
    ]
      .filter(Boolean)
      .join(' · ');
    text.append(name, what);

    const when = document.createElement('span');
    when.className = 'dates-when';
    const day = document.createElement('strong');
    day.textContent = t().inDays(occasion.days);
    const date = document.createElement('small');
    date.textContent = weekday.format(new Date(Date.UTC(occasion.date.y, occasion.date.m - 1, occasion.date.d)));
    when.append(day, date);

    link.append(bubbles, text, when);
    item.append(link);
    list.append(item);
  }
  root.append(list);
  return root;
}
