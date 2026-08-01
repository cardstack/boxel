import { AuthorizationError, type AuthorizationSafeResult } from './errors.js';
import {
  parseObjectReference,
  parseSubjectReference,
  parseSubjectTypeConstraint,
  type EntityReference,
} from './identifiers.js';
import type {
  AuthorizationRelationExpression,
  CompiledAuthorizationGraph,
} from './ir.js';
import type { RelationshipTuple } from './graph-model.js';
import {
  checkAuthorization,
  type AuthorizationCheckMetrics,
  type AuthorizationRuntimeLimits,
} from './resolver.js';
import {
  buildAuthorizationTupleIndex,
  type AuthorizationTupleIndex,
} from './tuple-index.js';

interface EnumerationRequest {
  context?: Readonly<Record<string, unknown>>;
  contextualTuples?: readonly RelationshipTuple[];
  limits?: AuthorizationRuntimeLimits;
}

export interface AuthorizationListObjectsRequest extends EnumerationRequest {
  subject: string;
  type: string;
  relation: string;
}

export interface AuthorizationListObjectsResult {
  objects: readonly string[];
  metrics: AuthorizationCheckMetrics;
}

export interface AuthorizationListUsersRequest extends EnumerationRequest {
  object: string;
  relation: string;
  filters: readonly string[];
}

export interface AuthorizationListUsersResult {
  users: readonly string[];
  metrics: AuthorizationCheckMetrics;
}

function emptyMetrics(): AuthorizationCheckMetrics {
  return { steps: 0, tupleReads: 0, maxDepth: 0 };
}

function addMetrics(
  target: AuthorizationCheckMetrics,
  source: AuthorizationCheckMetrics,
): void {
  target.steps += source.steps;
  target.tupleReads += source.tupleReads;
  target.maxDepth = Math.max(target.maxDepth, source.maxDepth);
}

function sorted(values: Iterable<string>): string[] {
  return [...values].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  );
}

function contextualIndex(
  model: CompiledAuthorizationGraph,
  tuples: readonly RelationshipTuple[] | undefined,
): AuthorizationTupleIndex | undefined {
  return tuples && tuples.length > 0
    ? buildAuthorizationTupleIndex(model, tuples)
    : undefined;
}

function assertKnownSubject(
  model: CompiledAuthorizationGraph,
  value: string,
): void {
  const subject = parseSubjectReference(value, 'request.subject');
  const type = model.types.get(subject.type);
  if (!type) {
    throw new AuthorizationError('unknown-type', `Unknown subject type ${subject.type}.`, {
      path: 'request.subject',
    });
  }
  if (subject.relation !== undefined && !type.relations.has(subject.relation)) {
    throw new AuthorizationError(
      'unknown-relation',
      `Unknown userset relation ${subject.type}#${subject.relation}.`,
      { path: 'request.subject' },
    );
  }
}

function tuplesFor(
  stored: AuthorizationTupleIndex,
  contextual: AuthorizationTupleIndex | undefined,
  object: string,
  relation: string,
): readonly import('./tuple-index.js').IndexedRelationshipTuple[] {
  const base = stored.forObjectRelation(object, relation);
  const extra = contextual?.forObjectRelation(object, relation) ?? [];
  return extra.length === 0 ? base : [...base, ...extra];
}

function tupleConditionAllows(
  model: CompiledAuthorizationGraph,
  tuple: import('./tuple-index.js').IndexedRelationshipTuple,
  context: Readonly<Record<string, unknown>>,
): boolean {
  if (!tuple.condition) return true;
  const condition = model.conditions.get(tuple.condition.name);
  if (!condition) {
    throw new AuthorizationError(
      'invalid-model',
      `Tuple condition ${tuple.condition.name} does not exist in the active model.`,
    );
  }
  return condition.evaluate(context, tuple.condition.context);
}

interface UsersetExpansionState {
  model: CompiledAuthorizationGraph;
  stored: AuthorizationTupleIndex;
  contextual?: AuthorizationTupleIndex;
  context: Readonly<Record<string, unknown>>;
  visited: ReadonlySet<string>;
  metrics: AuthorizationCheckMetrics;
  depth: number;
  maxDepth: number;
  maxSteps: number;
  maxTupleReads: number;
  candidateSubjects: ReadonlySet<string>;
}

function positiveLimit(
  value: number | undefined,
  fallback: number,
  path: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new AuthorizationError(
      'invalid-model',
      `Authorization runtime limit ${path} must be a positive safe integer.`,
      { path: `limits.${path}` },
    );
  }
  return resolved;
}

function tickExpansion(state: UsersetExpansionState): void {
  state.metrics.steps++;
  if (state.metrics.steps > state.maxSteps) {
    throw new AuthorizationError(
      'evaluation-limit-exceeded',
      `Authorization enumeration exceeded maximum steps ${state.maxSteps}.`,
    );
  }
}

function readExpansionTuple(state: UsersetExpansionState): void {
  state.metrics.tupleReads++;
  if (state.metrics.tupleReads > state.maxTupleReads) {
    throw new AuthorizationError(
      'evaluation-limit-exceeded',
      `Authorization enumeration exceeded maximum tuple reads ${state.maxTupleReads}.`,
    );
  }
}

interface ExpandedSubjects {
  values: Set<string>;
  wildcardExclusions: Map<string, Set<string>>;
}

function emptySubjects(values: Iterable<string> = []): ExpandedSubjects {
  return { values: new Set(values), wildcardExclusions: new Map() };
}

function wildcardTypes(subjects: ExpandedSubjects): Set<string> {
  return new Set(
    [...subjects.values]
      .map((value) => parseSubjectReference(value))
      .filter((subject) => subject.wildcard)
      .map((subject) => subject.type),
  );
}

function unionSubjects(children: readonly ExpandedSubjects[]): ExpandedSubjects {
  const result = emptySubjects();
  for (const child of children) {
    for (const subject of child.values) result.values.add(subject);
  }
  for (const type of wildcardTypes(result)) {
    const providers = children.filter((child) => child.values.has(`${type}:*`));
    let excluded = new Set(providers[0]?.wildcardExclusions.get(type) ?? []);
    for (const provider of providers.slice(1)) {
      const candidate = provider.wildcardExclusions.get(type) ?? new Set();
      excluded = new Set([...excluded].filter((value) => candidate.has(value)));
    }
    for (const child of children) {
      for (const value of child.values) {
        const subject = parseSubjectReference(value);
        if (
          subject.type === type &&
          !subject.wildcard &&
          subject.relation === undefined
        ) {
          excluded.delete(value);
        }
      }
    }
    if (excluded.size > 0) result.wildcardExclusions.set(type, excluded);
  }
  return result;
}

function intersectSubject(left: string, right: string): string | undefined {
  if (left === right) return left;
  const leftSubject = parseSubjectReference(left);
  const rightSubject = parseSubjectReference(right);
  if (
    leftSubject.relation !== undefined ||
    rightSubject.relation !== undefined ||
    leftSubject.type !== rightSubject.type
  ) {
    return undefined;
  }
  if (leftSubject.wildcard) return right;
  if (rightSubject.wildcard) return left;
  return undefined;
}

function intersectSubjects(
  children: readonly ExpandedSubjects[],
): ExpandedSubjects {
  if (children.length === 0) return emptySubjects();
  let result: ExpandedSubjects = {
    values: new Set(children[0]!.values),
    wildcardExclusions: new Map(
      [...children[0]!.wildcardExclusions].map(([type, values]) => [
        type,
        new Set(values),
      ]),
    ),
  };
  for (const child of children.slice(1)) {
    const intersection = new Set<string>();
    for (const left of result.values) {
      for (const right of child.values) {
        const subject = intersectSubject(left, right);
        if (subject === undefined) continue;
        const parsed = parseSubjectReference(subject);
        if (
          !result.wildcardExclusions.get(parsed.type)?.has(subject) &&
          !child.wildcardExclusions.get(parsed.type)?.has(subject)
        ) {
          intersection.add(subject);
        }
      }
    }
    const wildcardExclusions = new Map<string, Set<string>>();
    for (const type of wildcardTypes(emptySubjects(intersection))) {
      wildcardExclusions.set(
        type,
        new Set([
          ...(result.wildcardExclusions.get(type) ?? []),
          ...(child.wildcardExclusions.get(type) ?? []),
        ]),
      );
    }
    result = { values: intersection, wildcardExclusions };
  }
  return result;
}

function subtractSubjects(
  base: ExpandedSubjects,
  subtract: ExpandedSubjects,
): ExpandedSubjects {
  const result: ExpandedSubjects = {
    values: new Set(),
    wildcardExclusions: new Map(
      [...base.wildcardExclusions].map(([type, values]) => [type, new Set(values)]),
    ),
  };
  for (const value of base.values) {
    const subject = parseSubjectReference(value);
    if (subject.wildcard) {
      if (subtract.values.has(value)) continue;
      result.values.add(value);
      const excluded = result.wildcardExclusions.get(subject.type) ?? new Set<string>();
      for (const candidate of subtract.values) {
        const other = parseSubjectReference(candidate);
        if (
          other.type === subject.type &&
          !other.wildcard &&
          other.relation === undefined
        ) {
          excluded.add(candidate);
        }
      }
      if (excluded.size > 0) result.wildcardExclusions.set(subject.type, excluded);
      continue;
    }
    const removed = [...subtract.values].some((candidate) => {
      const other = parseSubjectReference(candidate);
      return (
        other.canonical === subject.canonical ||
        (other.wildcard &&
          subject.relation === undefined &&
          other.type === subject.type &&
          !subtract.wildcardExclusions
            .get(other.type)
            ?.has(subject.canonical))
      );
    });
    if (!removed) result.values.add(value);
  }
  return result;
}

function expandConcreteExpression(
  expression: AuthorizationRelationExpression,
  object: EntityReference,
  relation: string,
  state: UsersetExpansionState,
): ExpandedSubjects {
  tickExpansion(state);
  switch (expression.kind) {
    case 'direct': {
      let result = emptySubjects();
      for (const tuple of tuplesFor(
        state.stored,
        state.contextual,
        object.canonical,
        relation,
      )) {
        readExpansionTuple(state);
        if (!tupleConditionAllows(state.model, tuple, state.context)) continue;
        if (tuple.parsedSubject.relation === undefined) {
          result.values.add(tuple.subject);
        } else {
          const usersetObject = parseObjectReference(
            `${tuple.parsedSubject.type}:${tuple.parsedSubject.id}`,
          );
          result = unionSubjects([
            result,
            expandConcreteRelation(
              usersetObject,
              tuple.parsedSubject.relation,
              state,
            ),
          ]);
        }
      }
      return result;
    }
    case 'computed':
      return expandConcreteRelation(object, expression.relation, state);
    case 'tupleToUserset': {
      const children: ExpandedSubjects[] = [];
      for (const tuple of tuplesFor(
        state.stored,
        state.contextual,
        object.canonical,
        expression.tupleset,
      )) {
        readExpansionTuple(state);
        if (
          tuple.parsedSubject.wildcard ||
          tuple.parsedSubject.relation !== undefined ||
          !tupleConditionAllows(state.model, tuple, state.context)
        ) {
          continue;
        }
        const target = parseObjectReference(
          `${tuple.parsedSubject.type}:${tuple.parsedSubject.id}`,
        );
        if (!state.model.types.get(target.type)?.relations.has(expression.computed)) continue;
        children.push(expandConcreteRelation(target, expression.computed, state));
      }
      return unionSubjects(children);
    }
    case 'union':
      return unionSubjects(
        expression.children.map((child) =>
          expandConcreteExpression(child, object, relation, state),
        ),
      );
    case 'intersection':
      return intersectSubjects(
        expression.children.map((child) =>
          expandConcreteExpression(child, object, relation, state),
        ),
      );
    case 'difference':
      return subtractSubjects(
        expandConcreteExpression(expression.base, object, relation, state),
        expandConcreteExpression(expression.subtract, object, relation, state),
      );
    case 'predicate':
      return emptySubjects(
        [...state.candidateSubjects].filter((candidate) => {
          const subject = parseSubjectReference(candidate);
          return expression.evaluate({
            context: state.context,
            subject,
            object,
            relation,
          });
        }),
      );
  }
}

function expandConcreteRelation(
  object: EntityReference,
  relation: string,
  state: UsersetExpansionState,
): ExpandedSubjects {
  const key = `${object.canonical}\0${relation}`;
  if (state.depth > state.maxDepth) {
    throw new AuthorizationError(
      'resolution-depth-exceeded',
      `Authorization resolution exceeded maximum depth ${state.maxDepth}.`,
    );
  }
  state.metrics.maxDepth = Math.max(state.metrics.maxDepth, state.depth);
  if (state.visited.has(key)) return emptySubjects();
  const compiledRelation = state.model.types.get(object.type)?.relations.get(relation);
  if (!compiledRelation) return emptySubjects();
  const previousVisited = state.visited;
  const previousDepth = state.depth;
  state.visited = new Set(previousVisited).add(key);
  state.depth++;
  try {
    return expandConcreteExpression(
      compiledRelation.expression,
      object,
      relation,
      state,
    );
  } finally {
    state.visited = previousVisited;
    state.depth = previousDepth;
  }
}

function expandUsersetExpression(
  expression: AuthorizationRelationExpression,
  object: EntityReference,
  relation: string,
  state: UsersetExpansionState,
  output: Set<string>,
): void {
  tickExpansion(state);
  switch (expression.kind) {
    case 'direct':
      for (const tuple of tuplesFor(
        state.stored,
        state.contextual,
        object.canonical,
        relation,
      )) {
        readExpansionTuple(state);
        if (
          tuple.parsedSubject.relation === undefined ||
          !tupleConditionAllows(state.model, tuple, state.context)
        ) {
          continue;
        }
        expandUsersetRelation(
          parseObjectReference(`${tuple.parsedSubject.type}:${tuple.parsedSubject.id}`),
          tuple.parsedSubject.relation,
          state,
          output,
        );
      }
      return;
    case 'computed':
      expandUsersetRelation(object, expression.relation, state, output);
      return;
    case 'tupleToUserset':
      for (const tuple of tuplesFor(
        state.stored,
        state.contextual,
        object.canonical,
        expression.tupleset,
      )) {
        readExpansionTuple(state);
        if (
          tuple.parsedSubject.wildcard ||
          tuple.parsedSubject.relation !== undefined ||
          !tupleConditionAllows(state.model, tuple, state.context)
        ) {
          continue;
        }
        const target = parseObjectReference(
          `${tuple.parsedSubject.type}:${tuple.parsedSubject.id}`,
        );
        if (!state.model.types.get(target.type)?.relations.has(expression.computed)) continue;
        expandUsersetRelation(target, expression.computed, state, output);
      }
      return;
    case 'union':
      for (const child of expression.children) {
        expandUsersetExpression(child, object, relation, state, output);
      }
      return;
    case 'intersection':
      // A child userset alone cannot represent an intersection. The enclosing
      // relation's userset is still emitted by expandUsersetRelation.
      return;
    case 'difference':
      // The subtract branch removes members; it never contributes a userset.
      expandUsersetExpression(expression.base, object, relation, state, output);
      return;
    case 'predicate':
      throw new AuthorizationError(
        'unsupported-expression',
        'BXL predicate leaves are not executable during userset expansion yet.',
      );
  }
}

function expandUsersetRelation(
  object: EntityReference,
  relation: string,
  state: UsersetExpansionState,
  output: Set<string>,
): void {
  const key = `${object.canonical}\0${relation}`;
  output.add(`${object.canonical}#${relation}`);
  if (state.depth > state.maxDepth) {
    throw new AuthorizationError(
      'resolution-depth-exceeded',
      `Authorization resolution exceeded maximum depth ${state.maxDepth}.`,
    );
  }
  state.metrics.maxDepth = Math.max(state.metrics.maxDepth, state.depth);
  if (state.visited.has(key)) return;
  const compiledRelation = state.model.types.get(object.type)?.relations.get(relation);
  if (!compiledRelation) return;
  const previousVisited = state.visited;
  const previousDepth = state.depth;
  state.visited = new Set(previousVisited).add(key);
  state.depth++;
  try {
    expandUsersetExpression(
      compiledRelation.expression,
      object,
      relation,
      state,
      output,
    );
  } finally {
    state.visited = previousVisited;
    state.depth = previousDepth;
  }
}

export function listAuthorizationObjects(
  model: CompiledAuthorizationGraph,
  stored: AuthorizationTupleIndex,
  request: AuthorizationListObjectsRequest,
): AuthorizationSafeResult<AuthorizationListObjectsResult> {
  try {
    assertKnownSubject(model, request.subject);
    const objectType = model.types.get(request.type);
    if (!objectType) {
      throw new AuthorizationError('unknown-type', `Unknown object type ${request.type}.`, {
        path: 'request.type',
      });
    }
    if (!objectType.relations.has(request.relation)) {
      throw new AuthorizationError(
        'unknown-relation',
        `Unknown relation ${request.type}#${request.relation}.`,
        { path: 'request.relation' },
      );
    }

    const contextual = contextualIndex(model, request.contextualTuples);
    const candidates = new Set(stored.objectsByType.get(request.type) ?? []);
    for (const object of contextual?.objectsByType.get(request.type) ?? []) {
      candidates.add(object);
    }
    const maxCandidates = positiveLimit(
      request.limits?.maxCandidates,
      100_000,
      'maxCandidates',
    );
    const maxResults = positiveLimit(
      request.limits?.maxResults,
      100_000,
      'maxResults',
    );
    if (candidates.size > maxCandidates) {
      throw new AuthorizationError(
        'evaluation-limit-exceeded',
        `Authorization enumeration exceeded maximum candidates ${maxCandidates}.`,
      );
    }

    const objects: string[] = [];
    const metrics = emptyMetrics();
    for (const object of sorted(candidates)) {
      const check = checkAuthorization(model, stored, {
        subject: request.subject,
        relation: request.relation,
        object,
        ...(request.context ? { context: request.context } : {}),
        ...(request.contextualTuples
          ? { contextualTuples: request.contextualTuples }
          : {}),
        ...(request.limits ? { limits: request.limits } : {}),
      });
      if (!check.ok) return check;
      addMetrics(metrics, check.value.metrics);
      if (check.value.allowed) {
        objects.push(object);
        if (objects.length > maxResults) {
          throw new AuthorizationError(
            'evaluation-limit-exceeded',
            `Authorization enumeration exceeded maximum results ${maxResults}.`,
          );
        }
      }
    }
    return { ok: true, value: { objects, metrics } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AuthorizationError
          ? error.toRecord()
          : new AuthorizationError(
              'invalid-model',
              error instanceof Error ? error.message : String(error),
              { cause: error },
            ).toRecord(),
    };
  }
}

export function listAuthorizationUsers(
  model: CompiledAuthorizationGraph,
  stored: AuthorizationTupleIndex,
  request: AuthorizationListUsersRequest,
): AuthorizationSafeResult<AuthorizationListUsersResult> {
  try {
    const object = parseObjectReference(request.object, 'request.object');
    const objectType = model.types.get(object.type);
    if (!objectType) {
      throw new AuthorizationError('unknown-type', `Unknown object type ${object.type}.`, {
        path: 'request.object',
      });
    }
    if (!objectType.relations.has(request.relation)) {
      throw new AuthorizationError(
        'unknown-relation',
        `Unknown relation ${object.type}#${request.relation}.`,
        { path: 'request.relation' },
      );
    }
    const filters = request.filters.map((filter, index) => {
      const parsed = parseSubjectTypeConstraint(filter, `request.filters[${index}]`);
      const type = model.types.get(parsed.type);
      if (!type) {
        throw new AuthorizationError('unknown-type', `Unknown filter type ${parsed.type}.`, {
          path: `request.filters[${index}]`,
        });
      }
      if (parsed.relation !== undefined && !type.relations.has(parsed.relation)) {
        throw new AuthorizationError(
          'unknown-relation',
          `Unknown filter userset ${parsed.type}#${parsed.relation}.`,
          { path: `request.filters[${index}]` },
        );
      }
      return parsed;
    });
    const contextual = contextualIndex(model, request.contextualTuples);
    const metrics = emptyMetrics();
    const maxCandidates = positiveLimit(
      request.limits?.maxCandidates,
      100_000,
      'maxCandidates',
    );
    const maxResults = positiveLimit(
      request.limits?.maxResults,
      100_000,
      'maxResults',
    );
    const expansionState: UsersetExpansionState = {
      model,
      stored,
      ...(contextual ? { contextual } : {}),
      context: request.context ?? {},
      visited: new Set(),
      metrics,
      depth: 0,
      maxDepth: positiveLimit(request.limits?.maxDepth, 25, 'maxDepth'),
      maxSteps: positiveLimit(request.limits?.maxSteps, 10_000, 'maxSteps'),
      maxTupleReads: positiveLimit(
        request.limits?.maxTupleReads,
        100_000,
        'maxTupleReads',
      ),
      candidateSubjects: new Set([
        ...stored.tuples.map((tuple) => tuple.subject),
        ...(contextual?.tuples.map((tuple) => tuple.subject) ?? []),
        ...filters
          .filter((filter) => filter.relation === undefined)
          .map((filter) => `${filter.type}:*`),
      ]),
    };
    const expanded = expandConcreteRelation(
      object,
      request.relation,
      expansionState,
    );
    const allowed = expanded.values;
    for (const subject of [...allowed]) {
      const parsed = parseSubjectReference(subject);
      if (
        !filters.some(
          (filter) =>
            filter.type === parsed.type && filter.relation === parsed.relation,
        )
      ) {
        allowed.delete(subject);
      }
    }

    const usersets = new Set<string>();
    if (filters.some((filter) => filter.relation !== undefined)) {
      expandUsersetRelation(
        object,
        request.relation,
        { ...expansionState, visited: new Set() },
        usersets,
      );
    }
    for (const userset of usersets) {
      const subject = parseSubjectReference(userset);
      if (
        filters.some(
          (filter) =>
            filter.type === subject.type && filter.relation === subject.relation,
        )
      ) {
        allowed.add(userset);
      }
    }
    if (allowed.size > maxCandidates) {
      throw new AuthorizationError(
        'evaluation-limit-exceeded',
        `Authorization enumeration exceeded maximum candidates ${maxCandidates}.`,
      );
    }
    const users = sorted(allowed);
    if (users.length > maxResults) {
      throw new AuthorizationError(
        'evaluation-limit-exceeded',
        `Authorization enumeration exceeded maximum results ${maxResults}.`,
      );
    }
    return { ok: true, value: { users, metrics } };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof AuthorizationError
          ? error.toRecord()
          : new AuthorizationError(
              'invalid-model',
              error instanceof Error ? error.message : String(error),
              { cause: error },
            ).toRecord(),
    };
  }
}
