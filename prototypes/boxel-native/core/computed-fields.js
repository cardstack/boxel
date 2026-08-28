// Lite stand-in for CardDef computeVia. The JSON:API instance on disk holds
// only stored attributes. These values are written into boxel_index.search_doc
// at index time — the same split the host indexer uses for cardTitle / _title.
// Search reads search_doc through SQLite json_extract and never greps files.

export const COMPUTED_KEYS = [
  '_title',
  '_cardType',
  'fullName',
  'initials',
  'sortName',
  'handle',
  'kindLabel',
];

export function computeSearchDoc({ attributes = {}, adoptsFrom = {}, fileAlias }) {
  const typeName = adoptsFrom.name || 'Card';
  const first = String(attributes.firstName ?? '').trim();
  const last = String(attributes.lastName ?? '').trim();
  const storedTitle = String(attributes.title ?? '').trim();
  const displayTitle =
    [first, last].filter(Boolean).join(' ') || storedTitle || fileAlias;

  const fullName = last && first ? `${last}, ${first}` : displayTitle;
  const initials = [first, last]
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase();
  const sortName = fullName.toUpperCase();
  const handleParts = [first, last].filter(Boolean).map((p) => p.toLowerCase());
  const handle = handleParts.length ? `@${handleParts.join('.')}` : `@${fileAlias}`;
  const kindLabel =
    typeName === 'Person'
      ? 'person'
      : typeName === 'Pet'
        ? 'pet'
        : typeName === 'Note'
          ? 'note'
          : 'card';

  return {
    ...attributes,
    title: displayTitle,
    _cardTitle: displayTitle,
    _title: displayTitle,
    _cardType: typeName,
    fullName,
    initials,
    sortName,
    handle,
    kindLabel,
  };
}

export function computedOnly(searchDoc) {
  const out = {};
  for (const key of COMPUTED_KEYS) {
    out[key] = searchDoc[key];
  }
  return out;
}
