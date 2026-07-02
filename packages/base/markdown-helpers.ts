// CS-10786: Shared helpers for `static markdown` templates on specialized
// fields. Centralized here so all fields agree on date formatting and link
// construction, and so future adjustments happen in one place.

import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import { isValidDate, serializeBfmRef } from '@cardstack/runtime-common';

// Date formatting shared by DateField, DateTimeField, and DateRangeField so
// their markdown output is consistent. Matches the existing `en-US` `{year:
// numeric, month: short, day: numeric}` pattern already used by each field's
// HTML view; DateTime appends hour/minute.
const MARKDOWN_DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
});

const MARKDOWN_DATETIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour12: true,
  hour: 'numeric',
  minute: '2-digit',
});

// Markdown strings returned from these helpers are always pre-escaped: any
// metacharacters in the formatted output (e.g. commas in dates are fine, but
// `*`/`_`/`#` could appear in locale-specific variants) are run through
// `markdownEscape`. Callers can interpolate the result directly into a
// surrounding markdown document.

export function formatDateForMarkdown(value: Date | null | undefined): string {
  if (value == null || !isValidDate(value)) {
    return '';
  }
  return markdownEscape(MARKDOWN_DATE_FORMAT.format(value));
}

export function formatDateTimeForMarkdown(
  value: Date | null | undefined,
): string {
  if (value == null || !isValidDate(value)) {
    return '';
  }
  return markdownEscape(MARKDOWN_DATETIME_FORMAT.format(value));
}

export function formatDateRangeForMarkdown(
  start: Date | null | undefined,
  end: Date | null | undefined,
): string {
  let startText = formatDateForMarkdown(start);
  let endText = formatDateForMarkdown(end);
  if (!startText && !endText) {
    return '';
  }
  // `–` (en-dash) would be nicer typography, but keep it ASCII-friendly so
  // downstream markdown tooling doesn't have to normalize. The `-` below is
  // literal; it's not at line start, so `markdownEscape`'s bullet-marker rule
  // does not apply.
  return `${startText} - ${endText}`;
}

// Build a markdown inline link: `[escaped text](encoded href)`. The text is
// run through `markdownEscape` so any metacharacters in the visible text
// don't break formatting; the href is passed through `encodeURI` to quote
// whitespace and other unsafe characters without over-encoding already-
// percent-encoded URLs.
export function markdownLink(
  text: string | null | undefined,
  href: string | null | undefined,
): string {
  let safeText = markdownEscape(text ?? '');
  let rawHref = href ?? '';
  let encodedHref: string;
  try {
    encodedHref = encodeURI(rawHref);
  } catch {
    encodedHref = rawHref;
  }
  // Parentheses inside a URL break the markdown link syntax; escape them.
  encodedHref = encodedHref.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `[${safeText}](${encodedHref})`;
}

// CS-10797: Convenience helpers for rendering linksTo / linksToMany
// relationships as markdown links. Template authors call these explicitly;
// they are not wired into default markdown rendering.

// Minimal shape expected from a linked card — keeps this module free of
// heavyweight card-api imports.
interface CardLike {
  id?: string;
  cardTitle?: string;
}

// Returns `[text](card.id)` for a single linked card. Falls back to
// `card.cardTitle` when `text` is omitted. Returns `''` for null/undefined
// cards so callers can handle placeholders themselves.
export function markdownLinkForCard(
  card: CardLike | null | undefined,
  text?: string,
): string {
  if (!card) {
    return '';
  }
  let linkText = text ?? card.cardTitle ?? '';
  return markdownLink(linkText, card.id);
}

interface MarkdownLinksForCardsOptions {
  style?: 'list' | 'inline';
  text?: (card: CardLike) => string;
}

// Renders an array of linked cards as markdown links.
// `style: 'list'` (default) emits `- [Title](id)` per line.
// `style: 'inline'` emits comma-separated `[A](idA), [B](idB)`.
// Null entries in the array are skipped. Empty / all-null arrays return `''`.
export function markdownLinksForCards(
  cards: (CardLike | null | undefined)[] | null | undefined,
  options?: MarkdownLinksForCardsOptions,
): string {
  if (!cards) {
    return '';
  }
  let style = options?.style ?? 'list';
  let textFn = options?.text;
  let links: string[] = [];
  for (let card of cards) {
    if (!card) continue;
    let linkText = textFn ? textFn(card) : undefined;
    let link = markdownLinkForCard(card, linkText);
    if (link) {
      links.push(link);
    }
  }
  if (links.length === 0) {
    return '';
  }
  if (style === 'inline') {
    return links.join(', ');
  }
  return links.map((l) => `- ${l}`).join('\n');
}

// CS-10797: Convenience helpers for embedding cards using BFM (Boxel File
// Model) syntax. Inline embeds render the card inline (`:card[URL]`), block
// embeds render on their own line (`::card[URL]` or `::card[URL | spec]`).

interface MarkdownEmbedOptions {
  // 'inline' produces `:card[URL]`, 'block' produces `::card[URL]`.
  // Default: 'block'.
  kind?: 'inline' | 'block';
  // Size specifier appended after `|` (e.g. 'fitted 250x40', 'isolated',
  // 'embedded', 'atom', 'strip'). Honored for both inline and block embeds.
  size?: string;
}

// Returns a BFM reference directive (`:card`/`::card`, `:file`/`::file`, …)
// for a single reference by keyword + id. Returns `''` for a missing id.
// Thin wrapper over the shared `serializeBfmRef` builder so base-realm and
// host code emit identical BFM syntax.
export function markdownEmbedForRef(
  refType: string,
  id: string | null | undefined,
  options?: MarkdownEmbedOptions,
): string {
  return serializeBfmRef(refType, id, options);
}

// Returns a BFM card-reference directive for a single card.
// Returns `''` for null/undefined cards.
export function markdownEmbedForCard(
  card: CardLike | null | undefined,
  options?: MarkdownEmbedOptions,
): string {
  return serializeBfmRef('card', card?.id, options);
}

interface MarkdownEmbedsOptions extends MarkdownEmbedOptions {
  // Separator between embeds. Defaults to '\n\n' for block, ', ' for inline.
  separator?: string;
}

// Renders an array of cards as BFM card-reference directives.
// Null entries are skipped. Empty / all-null arrays return `''`.
export function markdownEmbedsForCards(
  cards: (CardLike | null | undefined)[] | null | undefined,
  options?: MarkdownEmbedsOptions,
): string {
  if (!cards) {
    return '';
  }
  let embeds: string[] = [];
  for (let card of cards) {
    let embed = markdownEmbedForCard(card, options);
    if (embed) {
      embeds.push(embed);
    }
  }
  if (embeds.length === 0) {
    return '';
  }
  let kind = options?.kind ?? 'block';
  let separator = options?.separator ?? (kind === 'inline' ? ' ' : '\n\n');
  return embeds.join(separator);
}

// CS-10787: Build a fenced code block. The fence is made of at least three
// backticks, expanded to be longer than any run of backticks in the content
// so the fence isn't prematurely closed. An optional language identifier
// labels the block for syntax highlighting consumers.
export function fencedCodeBlock(
  content: string | null | undefined,
  language?: string,
): string {
  let body = content ?? '';
  let longestRun = 0;
  let match = body.match(/`+/g);
  if (match) {
    for (let run of match) {
      if (run.length > longestRun) longestRun = run.length;
    }
  }
  let fence = '`'.repeat(Math.max(3, longestRun + 1));
  let lang = language ? language : '';
  // Ensure the body ends with a newline so the closing fence sits on its own
  // line. CommonMark allows omission, but normalizing avoids surprises.
  let normalized = body.endsWith('\n') ? body : `${body}\n`;
  return `${fence}${lang}\n${normalized}${fence}`;
}

// CS-10787: Build a markdown image reference `![alt](url)` with proper
// escaping/encoding. If url is missing, fall back to a plain placeholder so
// downstream consumers still get something meaningful.
export function markdownImage(
  alt: string | null | undefined,
  url: string | null | undefined,
): string {
  if (!url) {
    let safeAlt = markdownEscape(alt ?? '');
    return safeAlt ? `[binary image: ${safeAlt}]` : '[binary image]';
  }
  let safeAlt = markdownEscape(alt ?? '');
  let encodedHref: string;
  try {
    encodedHref = encodeURI(url);
  } catch {
    encodedHref = url;
  }
  encodedHref = encodedHref.replace(/\(/g, '%28').replace(/\)/g, '%29');
  return `![${safeAlt}](${encodedHref})`;
}

// Build a markdown reference for an audio file. Markdown has no native audio
// syntax, but CommonMark passes raw HTML through, so we emit a real
// `<audio controls>` so renderers (Spec preview, docs, AI consumers) see a
// player rather than a bare link. Missing URL falls back to a placeholder
// that still names the file.
export function markdownAudio(
  name: string | null | undefined,
  url: string | null | undefined,
): string {
  let safeName = markdownEscape(name ?? '');
  if (!url) {
    return safeName ? `[binary audio: ${safeName}]` : '[binary audio]';
  }
  let encodedHref: string;
  try {
    encodedHref = encodeURI(url);
  } catch {
    encodedHref = url;
  }
  let attrSafeHref = encodedHref.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  let attrSafeName = (name ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
  let ariaLabel = attrSafeName ? ` aria-label="${attrSafeName}"` : '';
  return `<audio src="${attrSafeHref}" controls preload="metadata"${ariaLabel}></audio>`;
}
