// Pretui — plain-text views of a sticky note's markdown, shared by the note
// card and the Spec page's notes rail (which can't import the note card: the
// note links to the Spec, so the import would be a cycle).

// a line's leading markdown furniture: quote, heading and list markers
const LINE_PREFIX = /^[\s>#*\-+]+/;
// inline emphasis and code marks
const INLINE_MARKS = /[`*_]/g;

function plainLines(note: string | undefined): string[] {
  return (note ?? '')
    .split('\n')
    .map((line) =>
      line.replace(LINE_PREFIX, '').replace(INLINE_MARKS, '').trim(),
    )
    .filter((line) => line.length > 0);
}

/**
 * First line of a note, flattened to plain text and shortened — the note's
 * title in card lists, search results, and the assistant's card picker.
 */
export function noteSummary(note: string | undefined): string {
  let first = plainLines(note)[0];
  if (!first) return 'Sticky note';
  return first.length > 72 ? `${first.slice(0, 71)}…` : first;
}

/** Everything after the first line, as one run of plain text ('' if none). */
export function noteExcerpt(note: string | undefined): string {
  return plainLines(note).slice(1).join(' ');
}
