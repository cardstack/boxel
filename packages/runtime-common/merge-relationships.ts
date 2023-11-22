import { type LooseCardResource, type Relationship } from './index';
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

  for (let [key, value] of Object.entries(resource ?? {})) {
    let keys = key.split('.');
    if (keys.length > 1 && keys[keys.length - 1].match(/^\d+$/)) {
      keys.pop();
      let name = keys.join('.');
      data[name] = Array.isArray(data[name]) ? data[name] : [];
      (data[name] as Relationship[]).push(value);
    } else {
      data[key] = value;
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
