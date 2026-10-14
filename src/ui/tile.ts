import { photoUrl } from '../data';
import { isDeceased, type Person } from '../parser/types';
import { avatarHue, familyName, initials, lifespan, shortName } from './format';

/** The photo bubble on its own — shared by every HTML view. Size comes from CSS. */
export function bubble(person: Person): HTMLElement {
  const wrapper = document.createElement('span');
  wrapper.className = 'bubble-html';

  wrapper.style.setProperty('--avatar-h', String(avatarHue(person.id)));

  const url = photoUrl(person);
  if (url) {
    const image = document.createElement('img');
    image.src = url;
    image.alt = person.name;
    image.loading = 'lazy';
    wrapper.append(image);
  } else {
    const fallback = document.createElement('span');
    fallback.className = 'bubble-initials-html';
    fallback.textContent = initials(person);
    wrapper.append(fallback);
  }
  return wrapper;
}

/** A clickable person: bubble, name, years — and how they are related, if known. */
export function tile(person: Person, relation?: string): HTMLAnchorElement {
  const link = document.createElement('a');
  link.className = `tile${isDeceased(person) ? ' is-deceased' : ''}`;
  link.href = `#/p/${encodeURIComponent(person.id)}`;
  link.append(bubble(person));

  const name = document.createElement('span');
  name.className = 'tile-name';
  name.textContent = shortName(person);
  link.append(name);

  const surname = familyName(person);
  if (surname) {
    const element = document.createElement('span');
    element.className = 'tile-surname';
    element.textContent = surname;
    link.append(element);
  }

  const years = lifespan(person);
  if (years) {
    const element = document.createElement('span');
    element.className = 'tile-years';
    element.textContent = years;
    link.append(element);
  }

  if (relation) {
    const element = document.createElement('span');
    element.className = 'tile-relation';
    element.textContent = relation;
    link.append(element);
  }
  return link;
}
