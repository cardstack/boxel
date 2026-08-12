import { AuthorizationError } from './errors.js';
import {
  parseObjectReference,
  parseSubjectReference,
  type EntityReference,
  type SubjectReference,
} from './identifiers.js';
import type { CompiledAuthorizationGraph } from './ir.js';
import type { RelationshipTuple } from './graph-model.js';

export interface IndexedRelationshipTuple extends RelationshipTuple {
  parsedSubject: SubjectReference;
  parsedObject: EntityReference;
}

export interface AuthorizationTupleIndex {
  readonly tuples: readonly IndexedRelationshipTuple[];
  readonly objectsByType: ReadonlyMap<string, ReadonlySet<string>>;
  forObjectRelation(object: string, relation: string): readonly IndexedRelationshipTuple[];
}

export interface AuthorizationTupleIndexOptions {
  invalidTuplePolicy?: 'error' | 'ignore';
}

function objectRelationKey(object: string, relation: string): string {
  return `${object}\0${relation}`;
}

function subjectMatchesConstraint(
  subject: SubjectReference,
  tupleCondition: string | undefined,
  allowed: {
    type: string;
    relation?: string;
    wildcard: boolean;
    condition?: string;
  },
): boolean {
  return (
    subject.type === allowed.type &&
    subject.relation === allowed.relation &&
    subject.wildcard === allowed.wildcard &&
    tupleCondition === allowed.condition
  );
}

export function buildAuthorizationTupleIndex(
  model: CompiledAuthorizationGraph,
  tuples: readonly RelationshipTuple[],
  options: AuthorizationTupleIndexOptions = {},
): AuthorizationTupleIndex {
  const indexed: IndexedRelationshipTuple[] = [];
  const byObjectRelation = new Map<string, IndexedRelationshipTuple[]>();
  const objectsByType = new Map<string, Set<string>>();

  for (let index = 0; index < tuples.length; index++) {
    const tuple = tuples[index]!;
    const path = `tuples[${index}]`;
    let parsedObject: EntityReference;
    let parsedSubject: SubjectReference;
    try {
      parsedObject = parseObjectReference(tuple.object, `${path}.object`);
      parsedSubject = parseSubjectReference(tuple.subject, `${path}.subject`);
    } catch (error) {
      if (options.invalidTuplePolicy === 'ignore') continue;
      throw error;
    }
    const objectType = model.types.get(parsedObject.type);
    if (!objectType) {
      if (options.invalidTuplePolicy === 'ignore') continue;
      throw new AuthorizationError('unknown-type', `Unknown object type ${parsedObject.type}.`, {
        path: `${path}.object`,
      });
    }
    const relation = objectType.relations.get(tuple.relation);
    if (!relation || !relation.assignable) {
      if (options.invalidTuplePolicy === 'ignore') continue;
      throw new AuthorizationError(
        'unknown-relation',
        `Tuple relation ${parsedObject.type}#${tuple.relation} is not assignable.`,
        { path: `${path}.relation` },
      );
    }
    if (!model.types.has(parsedSubject.type)) {
      if (options.invalidTuplePolicy === 'ignore') continue;
      throw new AuthorizationError('unknown-type', `Unknown subject type ${parsedSubject.type}.`, {
        path: `${path}.subject`,
      });
    }
    if (
      !relation.allowedSubjects.some((allowed) =>
        subjectMatchesConstraint(parsedSubject, tuple.condition?.name, allowed),
      )
    ) {
      if (options.invalidTuplePolicy === 'ignore') continue;
      throw new AuthorizationError(
        'invalid-tuple',
        `Subject ${parsedSubject.canonical} is not allowed on ${parsedObject.type}#${tuple.relation}.`,
        { path: `${path}.subject` },
      );
    }

    const normalized: IndexedRelationshipTuple = {
      ...tuple,
      subject: parsedSubject.canonical,
      object: parsedObject.canonical,
      parsedSubject,
      parsedObject,
    };
    indexed.push(normalized);

    const key = objectRelationKey(parsedObject.canonical, tuple.relation);
    const bucket = byObjectRelation.get(key) ?? [];
    bucket.push(normalized);
    byObjectRelation.set(key, bucket);

    const objects = objectsByType.get(parsedObject.type) ?? new Set<string>();
    objects.add(parsedObject.canonical);
    objectsByType.set(parsedObject.type, objects);
  }

  return {
    tuples: indexed,
    objectsByType,
    forObjectRelation(object, relation) {
      return byObjectRelation.get(objectRelationKey(object, relation)) ?? [];
    },
  };
}
