import { PASSAGE_FIELDS_KEY } from './search-doc-keys.ts';

export interface SearchDocPassage {
  fieldPath: string;
  ordinal: number;
  start: number | null;
  end: number | null;
  text: string;
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

// The passages a search doc carries: the items of each field its
// `_passages` key names (the card's PassageField lists), numbered by position.
// An item with no text is skipped, keeping its number, so `ordinal` is always
// the item's index in the card's list.
export function collectSearchDocPassages(
  searchDoc: unknown,
): SearchDocPassage[] {
  if (typeof searchDoc !== 'object' || searchDoc == null) {
    return [];
  }
  let doc = searchDoc as Record<string, unknown>;
  let fields = doc[PASSAGE_FIELDS_KEY];
  if (!Array.isArray(fields)) {
    return [];
  }
  let found: SearchDocPassage[] = [];
  for (let fieldPath of fields) {
    if (typeof fieldPath !== 'string') {
      continue;
    }
    let items = doc[fieldPath];
    if (!Array.isArray(items)) {
      continue;
    }
    items.forEach((item, ordinal) => {
      let text = (item as { text?: unknown } | null)?.text;
      if (typeof text !== 'string' || text.trim() === '') {
        return;
      }
      found.push({
        fieldPath,
        ordinal,
        start: finiteOrNull((item as { start?: unknown }).start),
        end: finiteOrNull((item as { end?: unknown }).end),
        text,
      });
    });
  }
  return found;
}
