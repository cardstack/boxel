import type { LooseCardResource, Relationship } from './index';
import { relationshipEntries } from './relationship-utils';
import mergeWith from 'lodash/mergeWith';

export function mergeRelationships(
  relData: LooseCardResource['relationships'],
  otherRelData: LooseCardResource['relationships'],
): LooseCardResource['relationships'] {
  let merged = mergeWith(
    _formatForMerge(relData),
    _formatForMerge(otherRelData),
    (_objectValue: any, sourceValue: any) => {
      return Array.isArray(sourceValue) ? sourceValue : undefined;
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
