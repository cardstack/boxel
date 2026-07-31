import { AuthorizationError } from './errors.js';
import type { SubjectTypeReference } from './graph-model.js';

const TYPE_OR_RELATION = /^[A-Za-z0-9_][A-Za-z0-9_-]*$/;

export interface EntityReference {
  type: string;
  id: string;
  canonical: string;
}

export interface SubjectReference extends EntityReference {
  relation?: string;
  wildcard: boolean;
}

export interface SubjectTypeConstraint {
  type: string;
  relation?: string;
  wildcard: boolean;
  condition?: string;
  canonical: string;
}

export function assertTypeOrRelationName(value: string, path: string): void {
  if (!TYPE_OR_RELATION.test(value)) {
    throw new AuthorizationError(
      'invalid-identifier',
      `Expected a non-empty type/relation name containing only letters, numbers, underscore, or hyphen; received ${JSON.stringify(value)}.`,
      { path },
    );
  }
}

function splitEntity(value: string, path: string): [string, string] {
  const separator = value.indexOf(':');
  if (separator <= 0 || separator === value.length - 1) {
    throw new AuthorizationError(
      'invalid-identifier',
      `Expected an identifier in type:id form; received ${JSON.stringify(value)}.`,
      { path },
    );
  }
  const type = value.slice(0, separator);
  const id = value.slice(separator + 1);
  assertTypeOrRelationName(type, `${path}.type`);
  return [type, id];
}

export function parseObjectReference(value: string, path = 'object'): EntityReference {
  if (value.includes('#')) {
    throw new AuthorizationError(
      'invalid-identifier',
      `Object identifiers cannot contain a userset relation: ${JSON.stringify(value)}.`,
      { path },
    );
  }
  const [type, id] = splitEntity(value, path);
  return { type, id, canonical: `${type}:${id}` };
}

export function parseSubjectReference(value: string, path = 'subject'): SubjectReference {
  const hash = value.lastIndexOf('#');
  const entity = hash === -1 ? value : value.slice(0, hash);
  const relation = hash === -1 ? undefined : value.slice(hash + 1);
  const [type, id] = splitEntity(entity, path);
  if (relation !== undefined) {
    assertTypeOrRelationName(relation, `${path}.relation`);
  }
  if (id === '*' && relation !== undefined) {
    throw new AuthorizationError(
      'invalid-identifier',
      'A typed wildcard cannot also be a userset subject.',
      { path },
    );
  }
  return {
    type,
    id,
    ...(relation === undefined ? {} : { relation }),
    wildcard: id === '*',
    canonical: `${type}:${id}${relation === undefined ? '' : `#${relation}`}`,
  };
}

export function parseSubjectTypeConstraint(
  value: SubjectTypeReference,
  path = 'subjectType',
): SubjectTypeConstraint {
  if (typeof value !== 'string') {
    assertTypeOrRelationName(value.type, `${path}.type`);
    if (value.relation !== undefined) {
      assertTypeOrRelationName(value.relation, `${path}.relation`);
    }
    if (value.condition !== undefined) {
      assertTypeOrRelationName(value.condition, `${path}.condition`);
    }
    if (value.wildcard && value.relation !== undefined) {
      throw new AuthorizationError(
        'invalid-identifier',
        'A subject type constraint cannot be both a wildcard and a userset.',
        { path },
      );
    }
    return {
      type: value.type,
      ...(value.relation === undefined ? {} : { relation: value.relation }),
      wildcard: value.wildcard ?? false,
      ...(value.condition === undefined ? {} : { condition: value.condition }),
      canonical: value.wildcard
        ? `${value.type}:*`
        : value.relation === undefined
          ? value.type
          : `${value.type}#${value.relation}`,
    };
  }

  const wildcard = value.endsWith(':*');
  const withoutWildcard = wildcard ? value.slice(0, -2) : value;
  const parts = withoutWildcard.split('#');
  if (parts.length > 2 || parts[0] === '' || (wildcard && parts.length > 1)) {
    throw new AuthorizationError(
      'invalid-identifier',
      `Expected a subject type in type or type#relation form; received ${JSON.stringify(value)}.`,
      { path },
    );
  }
  const type = parts[0]!;
  const relation = parts[1];
  assertTypeOrRelationName(type, `${path}.type`);
  if (relation !== undefined) assertTypeOrRelationName(relation, `${path}.relation`);
  return {
    type,
    ...(relation === undefined ? {} : { relation }),
    wildcard,
    canonical: wildcard
      ? `${type}:*`
      : relation === undefined
        ? type
        : `${type}#${relation}`,
  };
}
