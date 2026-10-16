import { t, warningText } from '../i18n';
import type { Gap } from '../missing';
import type { Diagnostic, Person } from '../parser/types';
import { displayName, lifespan } from '../ui/format';
import { bubble } from '../ui/tile';

/** Short lists stay open; the long ones — often everyone without a photo — start folded. */
const OPEN_UP_TO = 8;

/**
 * A checklist for whoever keeps family.md: the file's own warnings, then
 * everyone the file knows too little about, each with the line to edit.
 */
export function renderMissing(
  gaps: Gap[],
  warnings: Diagnostic[],
  doubles: Array<[Person, Person]> = [],
  merge?: (a: Person, b: Person) => void,
): HTMLElement {
  const root = document.createElement('article');
  root.className = 'page-view';
  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = t().missing;
  const intro = document.createElement('p');
  intro.className = 'page-hint';
  intro.textContent = gaps.length === 0 && warnings.length === 0 && doubles.length === 0 ? t().missingNone : t().missingIntro;
  root.append(heading, intro);

  // Most likely one person entered twice: both, side by side, and a way to make them one.
  if (doubles.length > 0) {
    const list = document.createElement('ul');
    list.className = 'gap-list';
    for (const pair of doubles) {
      const item = document.createElement('li');
      item.className = 'gap-double';
      for (const person of pair) {
        const link = document.createElement('a');
        link.className = 'gap-row';
        link.href = `#/p/${encodeURIComponent(person.id)}`;
        const name = document.createElement('span');
        name.className = 'gap-name';
        name.textContent = displayName(person);
        const where = document.createElement('span');
        where.className = 'gap-detail';
        where.textContent = [lifespan(person), person.line ? t().line(person.line) : undefined].filter(Boolean).join(' · ');
        link.append(bubble(person), name, where);
        item.append(link);
      }
      if (merge) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn btn-xs btn-soft btn-primary';
        button.textContent = t().merge;
        button.addEventListener('click', () => merge(pair[0], pair[1]));
        item.append(button);
      }
      list.append(item);
    }
    root.append(section(t().doubles, doubles.length, list));
  }

  if (warnings.length > 0) {
    const notes = document.createElement('ul');
    notes.className = 'gap-notes';
    for (const warning of warnings) {
      const item = document.createElement('li');
      item.textContent = warningText(warning);
      notes.append(item);
    }
    root.append(section(t().fileNotes, warnings.length, notes));
  }

  for (const gap of gaps) {
    const list = document.createElement('ul');
    list.className = 'gap-list';
    for (const { person, detail } of gap.people) {
      const item = document.createElement('li');
      const link = document.createElement('a');
      link.className = 'gap-row';
      link.href = `#/p/${encodeURIComponent(person.id)}`;
      const name = document.createElement('span');
      name.className = 'gap-name';
      name.textContent = person.name;
      const where = document.createElement('span');
      where.className = 'gap-detail';
      where.textContent = [detail, person.line ? t().line(person.line) : undefined].filter(Boolean).join(' · ');
      link.append(bubble(person), name, where);
      item.append(link);
      list.append(item);
    }
    root.append(section(t().gaps[gap.kind], gap.people.length, list));
  }
  return root;
}

function section(title: string, count: number, content: HTMLElement): HTMLElement {
  const details = document.createElement('details');
  details.className = 'gap';
  details.open = count <= OPEN_UP_TO;
  const summary = document.createElement('summary');
  const label = document.createElement('span');
  label.textContent = title;
  const badge = document.createElement('span');
  badge.className = 'badge badge-sm badge-soft badge-primary';
  badge.textContent = String(count);
  summary.append(label, badge);
  details.append(summary, content);
  return details;
}
