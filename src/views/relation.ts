import type { Family } from '../family';
import { lang, t } from '../i18n';
import { relation } from '../kinship';
import type { Person } from '../parser/types';
import { shortName } from '../ui/format';
import { icon } from '../ui/icons';
import { readStored, writeStored } from '../ui/storage';
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

  // Folded unless asked for: next to the words above it often says the same
  // again. Whether it was last left open is remembered.
  const section = document.createElement('details');
  section.className = 'relation-path-section';
  section.open = readStored('stammbaum-path') === 'open';
  section.addEventListener('toggle', () => writeStored('stammbaum-path', section.open ? 'open' : 'closed'));
  const label = document.createElement('summary');
  label.className = 'relation-path-toggle';
  const chevron = icon('next');
  chevron.classList.add('relation-path-chevron');
  const title = document.createElement('span');
  title.className = 'tier-label';
  title.textContent = t().path;
  const steps = document.createElement('span');
  steps.className = 'relation-path-steps';
  steps.textContent = t().steps(path.length - 1);
  label.append(chevron, title, steps);
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
  const body = document.createElement('div');
  body.className = 'relation-path-body';
  body.append(paragraph('relation-hint', t().pathHint), chain, show);
  section.append(label, body);
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
