// CS-10786: Shared helpers for `static markdown` templates on specialized
// fields. Centralized here so all fields agree on date formatting and link
// construction, and so future adjustments happen in one place.

import { markdownEscape } from '@cardstack/boxel-ui/helpers';
import { isValidDate } from '@cardstack/runtime-common';

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
