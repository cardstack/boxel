import type { LooseCardResource, Relationship } from './index.ts';
import { relationshipEntries } from './relationship-utils.ts';

// Each relationship the patch names replaces the stored one whole, so a link
// can be cleared, a list can shrink or empty, and a field that changed between
// linksTo and linksToMany takes its new shape. Relationships the patch leaves
// out are kept.
export function mergeRelationships(
  relData: LooseCardResource['relationships'],
  otherRelData: LooseCardResource['relationships'],
): LooseCardResource['relationships'] {
  return _revertMergeFormat({
    ..._formatForMerge(relData),
    ..._formatForMerge(normalizeEmptyLists(otherRelData)),
  });
}

// A patch can empty a linksToMany with `[]` or `{ data: [] }` as well as with
// `{ links: { self: null } }`, the form serialization writes, so the first two
// are rewritten to it. A `<field>.<n>` member and a query-backed relationship,
// which carries `links.search` or `meta` too, are left as they are.
function normalizeEmptyLists(
  relationships: LooseCardResource['relationships'],
): LooseCardResource['relationships'] {
  if (!relationships) {
    return relationships;
  }
  return Object.fromEntries(
    Object.entries(relationships).map(([key, value]) => [
      key,
      !INDEXED_KEY.test(key) && isEmptyList(value)
        ? { links: { self: null } }
        : value,
    ]),
  );
}

const INDEXED_KEY = /\.\d+$/;

function isEmptyList(value: Relationship | Relationship[]): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  let { data, links, meta } = value ?? {};
  return (
    Array.isArray(data) &&
    data.length === 0 &&
    meta === undefined &&
    (links === undefined ||
      (links.self == null && links.search == null && links.related == null))
  );
}

function _formatForMerge(
  resource: LooseCardResource['relationships'],
): Record<string, Relationship | Relationship[]> {
  let data: Record<string, Relationship | Relationship[]> = {};

  for (let entry of relationshipEntries(resource)) {
    if (entry.isPlural) {
      data[entry.fieldName] = Array.isArray(data[entry.fieldName])
        ? data[entry.fieldName]
        : [];
      (data[entry.fieldName] as Relationship[]).push(entry.relationship);
    } else {
      data[entry.fieldName] = entry.relationship;
    }
  }
  return data;
}

function _revertMergeFormat(
  data: Record<string, Relationship | Relationship[]>,
): LooseCardResource['relationships'] {
  let relationships: LooseCardResource['relationships'] = {};

  for (let [key, value] of Object.entries(data ?? {})) {
    if (Array.isArray(value)) {
      value.map((val, i) => {
        relationships![`${key}.${i}`] = val;
      });
    } else {
      relationships[key] = value;
    }
  }
  return relationships;
}
