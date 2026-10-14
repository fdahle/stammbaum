import { t } from '../i18n';
import { icon } from '../ui/icons';

/**
 * family.md as it is, to read along — numbered, so the line a warning names
 * is easy to find — and to take away as a file.
 */
export function renderSource(markdown: string): HTMLElement {
  const root = document.createElement('article');
  root.className = 'page-view source-view';
  const heading = document.createElement('h1');
  heading.className = 'page-title';
  heading.textContent = 'family.md';
  const intro = document.createElement('p');
  intro.className = 'page-hint';
  intro.textContent = markdown.trim() === '' ? t().fileEmpty : t().fileHint;

  const actions = document.createElement('div');
  actions.className = 'focus-actions';
  const download = document.createElement('a');
  download.className = 'btn btn-sm btn-soft btn-primary';
  download.download = 'family.md';
  download.href = '#';
  download.append(icon('download'), t().download);
  // Made on the click, and let go of again soon after.
  download.addEventListener('click', () => {
    download.href = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
    setTimeout(() => URL.revokeObjectURL(download.href), 10_000);
  });
  actions.append(download);
  // The clipboard is only there on https and localhost.
  if (navigator.clipboard) {
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-sm btn-soft btn-primary';
    copy.append(icon('copy'), t().copy);
    copy.addEventListener('click', () => {
      navigator.clipboard.writeText(markdown).then(
        () => copy.replaceChildren(icon('copy'), t().copied),
        () => undefined,
      );
    });
    actions.append(copy);
  }
  root.append(heading, intro, actions);

  if (markdown.trim() !== '') {
    const code = document.createElement('pre');
    code.className = 'source-code';
    const lines = markdown.replace(/\r?\n$/, '').split(/\r?\n/);
    for (const text of lines) {
      const line = document.createElement('span');
      line.className = 'source-line';
      line.textContent = text;
      code.append(line);
    }
    root.append(code);
  }
  return root;
}
