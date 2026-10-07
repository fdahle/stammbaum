import type { Family } from '../family';
import { lang, t } from '../i18n';
import { relation } from '../kinship';
import type { Person } from '../parser/types';
import { shortName } from '../ui/format';
import { icon } from '../ui/icons';
import { tile } from '../ui/tile';

export interface RelationContext {
  /** Asks for someone else in place of `a` or `b`. */
  change(which: 'a' | 'b'): void;
}

/**
 * How two people are related: the word for it in both directions, and the
 * chain of parents, children and partners that connects them.
 */
export function renderRelation(family: Family, a: Person, b: Person, context: RelationContext): HTMLElement {
  const root = document.createElement('article');
  root.className = 'relation-view';

  const pair = document.createElement('section');
  pair.className = 'relation-pair';
  const swap = document.createElement('a');
  swap.className = 'btn btn-ghost btn-circle';
  swap.href = route(b, a);
  swap.title = t().swap;
  swap.setAttribute('aria-label', t().swap);
  swap.append(icon('swap'));
  pair.append(end(a, () => context.change('a')), swap, end(b, () => context.change('b')));
  root.append(pair);

  if (a.id === b.id) {
    root.append(paragraph('relation-note', t().samePerson));
    return root;
  }

  const terms = document.createElement('section');
  terms.className = 'relation-terms card bg-base-100 shadow-sm';
  for (const [from, to] of [[a, b], [b, a]] as const) {
    const word = relation(family, from.id, to.id, lang());
    terms.append(
      paragraph('relation-line', t().isTo(shortName(from), shortName(to))),
      paragraph(`relation-term${word ? '' : ' is-missing'}`, word ?? t().noTerm),
    );
  }
  root.append(terms);

  const path = family.path(a.id, b.id);
  if (!path) {
    root.append(paragraph('relation-note', t().notConnected));
    return root;
  }

  const section = document.createElement('section');
  section.className = 'relation-path-section';
  const label = document.createElement('h2');
  label.className = 'tier-label';
  label.textContent = t().path;
  const chain = document.createElement('ol');
  chain.className = 'relation-path';
  path.forEach((id, index) => {
    const person = family.person(id)!;
    const previous = index > 0 ? path[index - 1] : undefined;
    const item = document.createElement('li');
    if (previous) {
      const arrow = icon('arrow');
      arrow.classList.add('relation-arrow');
      item.append(arrow);
    }
    // Each step is captioned with what it is to the step before.
    item.append(tile(person, previous ? relation(family, previous, id, lang()) : undefined));
    chain.append(item);
  });
  const show = document.createElement('a');
  show.className = 'btn btn-primary btn-sm';
  show.href = `#/path/${encodeURIComponent(a.id)}/${encodeURIComponent(b.id)}`;
  show.append(icon('tree'), t().showInTree);
  section.append(label, paragraph('relation-hint', t().pathHint), chain, show);
  root.append(section);
  return root;
}

export function route(a: Person, b: Person): string {
  return `#/r/${encodeURIComponent(a.id)}/${encodeURIComponent(b.id)}`;
}

function end(person: Person, change: () => void): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.className = 'relation-end';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn btn-ghost btn-xs';
  button.textContent = t().change;
  button.addEventListener('click', change);
  wrapper.append(tile(person), button);
  return wrapper;
}

function paragraph(className: string, text: string): HTMLElement {
  const element = document.createElement('p');
  element.className = className;
  element.textContent = text;
  return element;
}
