import type { LooseCardResource, Relationship } from './resource-types';

export type RelationshipEntry = {
  key: string;
  fieldName: string;
  index?: number;
  relationship: Relationship;
  isPlural: boolean;
};

export function getSingularRelationship(
  relationships: LooseCardResource['relationships'] | undefined,
  fieldName: string,
): Relationship | undefined {
  let relationship = relationships?.[fieldName];
  return Array.isArray(relationship) ? undefined : relationship;
}

export function relationshipEntries(
  relationships: LooseCardResource['relationships'] | undefined,
): RelationshipEntry[] {
  if (!relationships) {
    return [];
  }

  let entries: RelationshipEntry[] = [];
  for (let [key, value] of Object.entries(relationships)) {
    if (Array.isArray(value)) {
      value.forEach((relationship, index) => {
        entries.push({
          key: `${key}.${index}`,
          fieldName: key,
          index,
          relationship,
          isPlural: true,
        });
      });
      continue;
    }

    let { fieldName, index } = parseRelationshipKey(key);
    entries.push({
      key,
      fieldName,
      index,
      relationship: value,
      isPlural: index !== undefined,
    });
  }

  return entries;
}

export function normalizeRelationships(
  relationships: LooseCardResource['relationships'] | undefined,
): Record<string, Relationship> {
  let normalized: Record<string, Relationship> = {};
  for (let entry of relationshipEntries(relationships)) {
    normalized[entry.key] = entry.relationship;
  }
  return normalized;
}

function parseRelationshipKey(key: string): { fieldName: string; index?: number } {
  let parts = key.split('.');
  let last = parts[parts.length - 1];
  if (parts.length > 1 && /^\d+$/.test(last)) {
    return {
      fieldName: parts.slice(0, -1).join('.'),
      index: Number(last),
    };
  }
  return { fieldName: key };
}
