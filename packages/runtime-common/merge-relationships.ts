import type { LooseCardResource, Relationship } from './index.ts';
import { relationshipEntries } from './relationship-utils.ts';
import { mergeWith } from 'lodash-es';

export function mergeRelationships(
  relData: LooseCardResource['relationships'],
  otherRelData: LooseCardResource['relationships'],
): LooseCardResource['relationships'] {
  let merged = mergeWith(
    _formatForMerge(relData),
    _formatForMerge(otherRelData),
    (objectValue: any, sourceValue: any) => {
      // A list on either side is replaced by the patch's value, not merged
      // into: an emptied linksToMany arrives as `{ links: { self: null } }`,
      // and a field that changed between linksTo and linksToMany arrives in
      // its new shape.
      return Array.isArray(sourceValue) || Array.isArray(objectValue)
        ? sourceValue
        : undefined;
    },
  );

  return _revertMergeFormat(merged);
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
