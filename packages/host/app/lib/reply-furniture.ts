// The answer furniture the design board draws in a reply, read from plain
// markdown the model can write (raw HTML in a reply is escaped):
//
//   `$3.75 median` `6 shops` `checked Oct 20`   a paragraph of only code
//                                               spans: a row of stat chips
//   [3](https://…)                              a link whose text is a
//                                               number: a source ref chip
//   Sources: [lafarine](…), [macchiato](…)      a paragraph that starts
//                                               "Sources": a sources strip
//   **Method:** Shop-operated menus only…       a paragraph that starts
//                                               with a bold "Method": a
//                                               one-line disclosure
//
// It marks the blocks with data attributes and makes the disclosure a
// control; the styles live with the reply. It only reads and marks, so a
// renderer that redraws the markup simply gets marked again.

const SEPARATOR = /^[\s·,|/]*$/;

// The streaming renderer's caret sits inside the paragraph being written. It
// is not part of the reply: a row that is chips must read as chips while it
// streams too, or it regroups, and changes height, when the reply settles.
const isCaret = (node: Node) =>
  (node as HTMLElement).hasAttribute?.('data-markdown-caret') ?? false;

function isChipRow(p: HTMLElement): boolean {
  let codes = 0;
  for (let node of p.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      if (!SEPARATOR.test(node.textContent ?? '')) {
        return false;
      }
    } else if ((node as HTMLElement).tagName === 'CODE') {
      codes++;
    } else if (!isCaret(node)) {
      return false;
    }
  }
  return codes >= 2;
}

// A sources strip names each site, so a numbered ref there says where it
// points ("1 nyrr.org"), and the punctuation between its links, which
// the strip's gaps already do, is hidden.
function markSources(p: HTMLElement) {
  for (let a of p.querySelectorAll<HTMLAnchorElement>('a')) {
    let host = '';
    try {
      host = new URL(a.href).hostname.replace(/^www\./, '');
    } catch {
      continue;
    }
    if (/^\d{1,2}$/.test(a.textContent?.trim() ?? '') && host) {
      a.dataset.host = host;
    }
  }
  for (let node of [...p.childNodes]) {
    if (
      node.nodeType === Node.TEXT_NODE &&
      node.previousSibling?.nodeName === 'A' &&
      /^[\s·,;|/.]*$/.test(node.textContent ?? '')
    ) {
      let sep = document.createElement('span');
      sep.dataset.sep = 'true';
      sep.textContent = node.textContent;
      node.replaceWith(sep);
    }
  }
}

function toggleMethod(this: HTMLElement) {
  let open = this.dataset.open === 'true';
  this.dataset.open = open ? 'false' : 'true';
  this.setAttribute('aria-expanded', open ? 'false' : 'true');
}

function onMethodKey(this: HTMLElement, event: KeyboardEvent) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    toggleMethod.call(this);
  }
}

// A figure with its words after it, as models often write a stat row:
// `$15` race-day benchmark `$10–$11.60` Burpee Open. Each figure and the
// words up to the next one are one chip; a label is short.
// Every code span must be a figure: a sentence naming code (`relaunch.gts`
// exports the `PosterOption` and `RelaunchPlan` card classes) is prose, not
// a stat row.
const CHIP_LABEL_MAX = 48;
const FIGURE = /\d/;

function isLabeledChipRow(p: HTMLElement): boolean {
  let codes = 0;
  let previous: 'code' | 'label' | undefined;
  for (let node of p.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) {
      let text = node.textContent ?? '';
      if (SEPARATOR.test(text)) {
        continue;
      }
      if (previous !== 'code' || text.trim().length > CHIP_LABEL_MAX) {
        return false;
      }
      previous = 'label';
    } else if ((node as HTMLElement).tagName === 'CODE') {
      if (!FIGURE.test(node.textContent ?? '')) {
        return false;
      }
      codes++;
      previous = 'code';
    } else if (!isCaret(node)) {
      return false;
    }
  }
  return codes >= 2;
}

// Wraps each figure and its label in one chip. Only nodes inside the
// paragraph move, so a renderer that redraws it simply gets marked again.
function groupChips(p: HTMLElement) {
  let chip: HTMLElement | undefined;
  for (let node of Array.from(p.childNodes)) {
    if ((node as HTMLElement).tagName === 'CODE') {
      chip = document.createElement('span');
      chip.dataset.chip = 'true';
      p.insertBefore(chip, node);
      chip.append(node);
    } else if (chip && node.nodeType === Node.TEXT_NODE) {
      let label = node.textContent?.trim() ?? '';
      if (label && !SEPARATOR.test(label)) {
        let words = document.createElement('span');
        words.dataset.chipLabel = 'true';
        words.textContent = label;
        chip.append(words);
      }
      node.remove();
    }
  }
}

// Models escape a dollar sign against maths; inside a code span the
// backslash is kept, so a figure would read "\$15"
function unescapeFigures(p: HTMLElement) {
  for (let code of p.querySelectorAll('code')) {
    let text = code.textContent ?? '';
    if (text.includes('\\$')) {
      code.textContent = text.replace(/\\\$/g, '$');
    }
  }
}

export function markReplyFurniture(root: HTMLElement) {
  for (let p of root.querySelectorAll<HTMLElement>('p')) {
    if (!p.dataset.chips && isChipRow(p)) {
      p.dataset.chips = 'true';
      unescapeFigures(p);
    } else if (!p.dataset.chips && isLabeledChipRow(p)) {
      p.dataset.chips = 'labeled';
      unescapeFigures(p);
      groupChips(p);
    }
    let text = p.textContent?.trimStart() ?? '';
    if (
      !p.dataset.sources &&
      /^sources\b/i.test(text) &&
      p.querySelector('a')
    ) {
      p.dataset.sources = 'true';
      markSources(p);
    }
    let first = p.firstElementChild as HTMLElement | null;
    if (
      !p.dataset.method &&
      first?.tagName === 'STRONG' &&
      /^method:?$/i.test(first.textContent?.trim() ?? '') &&
      p.firstChild === first
    ) {
      p.dataset.method = 'true';
      p.dataset.open = 'false';
      p.setAttribute('role', 'button');
      p.setAttribute('tabindex', '0');
      p.setAttribute('aria-expanded', 'false');
      p.addEventListener('click', toggleMethod);
      p.addEventListener('keydown', onMethodKey);
    }
  }
  for (let a of root.querySelectorAll<HTMLAnchorElement>('a')) {
    if (!a.dataset.ref && /^\d{1,2}$/.test(a.textContent?.trim() ?? '')) {
      a.dataset.ref = 'true';
    }
    // a link out of Boxel opens in its own window, so the session stays
    // where it was; a card or a file opens in Quick Look instead
    if (
      !a.closest('[data-card-ref]') &&
      /^https?:/.test(a.getAttribute('href') ?? '') &&
      new URL(a.href, location.href).origin !== location.origin
    ) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  }
}

/**
 * What a card or file reference in a reply is called before its card loads:
 * the last part of its URL, as words ("ClubMember/lena-ruiz" → "Lena Ruiz",
 * "notes/plan.md" → "plan.md"). The streaming reply and the loading pill
 * both show it, so the line keeps its width until the card's own title
 * replaces it.
 */
const OPAQUE_ID =
  /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[0-9a-f]{12,})$/i;
const HASH_PREFIX = /^[0-9a-f]{6}-/i;

export function cardRefLabel(url: string | undefined): string {
  if (!url) {
    return '';
  }
  let segments = url.split(/[?#]/)[0]!.replace(/\/+$/, '').split('/');
  let last = segments.pop() ?? '';
  try {
    last = decodeURIComponent(last);
  } catch {
    // keep the raw segment
  }
  // an opaque id (a UUID, a hash) names nothing: the card is named by the
  // folder its type sits in (`41e20f-wedding-table/CardListing/<uuid>` is
  // "Wedding Table"), without the folder's own hash prefix
  if (OPAQUE_ID.test(last.replace(/\.json$/i, '')) && segments.length >= 2) {
    let folder = segments[segments.length - 2]!.replace(HASH_PREFIX, '');
    if (folder && !OPAQUE_ID.test(folder)) {
      last = folder;
    }
  }
  if (/\.[a-z0-9]{1,5}$/i.test(last) && !/\.json$/i.test(last)) {
    return last;
  }
  let words = last
    .replace(/\.json$/i, '')
    .split(/[-_\s]+/)
    .filter(Boolean);
  return words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(' ');
}
