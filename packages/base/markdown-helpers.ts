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
