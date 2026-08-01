import { AuthorizationError, type AuthorizationSafeResult } from './errors.js';
import {
  parseObjectReference,
  parseSubjectReference,
  type EntityReference,
  type SubjectReference,
} from './identifiers.js';
import type {
  AuthorizationRelationExpression,
  CompiledAuthorizationGraph,
} from './ir.js';
import type { RelationshipTuple } from './graph-model.js';
import {
  breadthFirstRecursiveMatchSync,
  OPENFGA_RECURSIVE_PORT_INFO,
} from './openfga-recursive.js';
import {
  buildAuthorizationTupleIndex,
  type AuthorizationTupleIndex,
  type IndexedRelationshipTuple,
} from './tuple-index.js';

export interface AuthorizationRuntimeLimits {
  maxDepth?: number;
  maxSteps?: number;
  maxTupleReads?: number;
  maxTraceEvents?: number;
  maxCandidates?: number;
  maxResults?: number;
}

interface ResolvedAuthorizationRuntimeLimits {
  maxDepth: number;
  maxSteps: number;
  maxTupleReads: number;
  maxTraceEvents: number;
  maxCandidates: number;
  maxResults: number;
}

export interface AuthorizationCheckRequest {
  subject: string;
  relation: string;
  object: string;
  context?: Readonly<Record<string, unknown>>;
  contextualTuples?: readonly RelationshipTuple[];
  trace?: boolean;
  limits?: AuthorizationRuntimeLimits;
}

export interface AuthorizationCheckMetrics {
  steps: number;
  tupleReads: number;
  maxDepth: number;
}

export interface AuthorizationTraceEvent {
  depth: number;
  operation: string;
  subject: string;
  relation: string;
  object: string;
  outcome: 'allow' | 'deny' | 'error';
  detail?: string;
}

export interface AuthorizationCheckResult {
  allowed: boolean;
  metrics: AuthorizationCheckMetrics;
  trace: readonly AuthorizationTraceEvent[];
}

type ResolutionOutcome =
  | { status: 'allow' }
  | { status: 'deny' }
  | { status: 'cycle' }
  | { status: 'error'; error: AuthorizationError };

interface ResolutionState {
  subject: SubjectReference;
  context: Readonly<Record<string, unknown>>;
  stored: AuthorizationTupleIndex;
  contextual?: AuthorizationTupleIndex;
  limits: ResolvedAuthorizationRuntimeLimits;
  metrics: AuthorizationCheckMetrics;
  trace?: AuthorizationTraceEvent[];
}

const DEFAULT_LIMITS: ResolvedAuthorizationRuntimeLimits = {
  maxDepth: 25,
  maxSteps: 10_000,
  maxTupleReads: 100_000,
  maxTraceEvents: 1_000,
  maxCandidates: 100_000,
  maxResults: 100_000,
};

function deny(): ResolutionOutcome {
  return { status: 'deny' };
}

function allow(): ResolutionOutcome {
  return { status: 'allow' };
}

function cycle(): ResolutionOutcome {
  return { status: 'cycle' };
}

function errorOutcome(error: AuthorizationError): ResolutionOutcome {
  return { status: 'error', error };
}

function resolvedLimits(
  limits: AuthorizationRuntimeLimits | undefined,
): ResolvedAuthorizationRuntimeLimits {
  const result = { ...DEFAULT_LIMITS, ...limits };
  for (const [name, value] of Object.entries(result)) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new AuthorizationError(
        'invalid-model',
        `Authorization runtime limit ${name} must be a positive safe integer.`,
        { path: `limits.${name}` },
      );
    }
  }
  return result;
}

function relationKey(subject: string, object: string, relation: string): string {
  return `${subject}\0${object}\0${relation}`;
}

function tick(state: ResolutionState, depth: number): AuthorizationError | undefined {
  state.metrics.steps++;
  state.metrics.maxDepth = Math.max(state.metrics.maxDepth, depth);
  if (depth > state.limits.maxDepth) {
    return new AuthorizationError(
      'resolution-depth-exceeded',
      `Authorization resolution exceeded maximum depth ${state.limits.maxDepth}.`,
    );
  }
  if (state.metrics.steps > state.limits.maxSteps) {
    return new AuthorizationError(
      'evaluation-limit-exceeded',
      `Authorization resolution exceeded maximum steps ${state.limits.maxSteps}.`,
    );
  }
  return undefined;
}

function recordTrace(
  state: ResolutionState,
  event: AuthorizationTraceEvent,
): void {
  if (!state.trace || state.trace.length >= state.limits.maxTraceEvents) return;
  state.trace.push(event);
}

function tuplesFor(
  state: ResolutionState,
  object: string,
  relation: string,
): readonly IndexedRelationshipTuple[] | AuthorizationError {
  const stored = state.stored.forObjectRelation(object, relation);
  const contextual = state.contextual?.forObjectRelation(object, relation) ?? [];
  const reads = stored.length + contextual.length;
  state.metrics.tupleReads += reads;
  if (state.metrics.tupleReads > state.limits.maxTupleReads) {
    return new AuthorizationError(
      'evaluation-limit-exceeded',
      `Authorization resolution exceeded maximum tuple reads ${state.limits.maxTupleReads}.`,
    );
  }
  return contextual.length === 0 ? stored : [...stored, ...contextual];
}

function mergeUnion(outcomes: readonly ResolutionOutcome[]): ResolutionOutcome {
  let firstError: AuthorizationError | undefined;
  let sawCycle = false;
  for (const outcome of outcomes) {
    if (outcome.status === 'allow') return allow();
    if (outcome.status === 'error' && !firstError) firstError = outcome.error;
    if (outcome.status === 'cycle') sawCycle = true;
  }
  if (firstError) return errorOutcome(firstError);
  return sawCycle ? cycle() : deny();
}

function mergeIntersection(outcomes: readonly ResolutionOutcome[]): ResolutionOutcome {
  let firstError: AuthorizationError | undefined;
  for (const outcome of outcomes) {
    if (outcome.status === 'deny' || outcome.status === 'cycle') return deny();
    if (outcome.status === 'error' && !firstError) firstError = outcome.error;
  }
  return firstError ? errorOutcome(firstError) : allow();
}

function mergeDifference(
  base: ResolutionOutcome,
  subtract: ResolutionOutcome,
): ResolutionOutcome {
  if (
    base.status === 'deny' ||
    base.status === 'cycle' ||
    subtract.status === 'allow' ||
    subtract.status === 'cycle'
  ) {
    return deny();
  }
  if (base.status === 'allow' && subtract.status === 'deny') return allow();
  if (base.status === 'error') return base;
  if (subtract.status === 'error') return subtract;
  return deny();
}

function directTupleMatchesSubject(
  tuple: IndexedRelationshipTuple,
  subject: SubjectReference,
): boolean {
  if (tuple.parsedSubject.canonical === subject.canonical) return true;
  if (tuple.parsedSubject.relation !== undefined) return false;
  if (tuple.parsedSubject.type !== subject.type) return false;
  return tuple.parsedSubject.id === '*' || tuple.parsedSubject.id === subject.id;
}

function tupleConditionOutcome(
  model: CompiledAuthorizationGraph,
  tuple: IndexedRelationshipTuple,
  state: ResolutionState,
): ResolutionOutcome {
  if (!tuple.condition) return allow();
  const condition = model.conditions.get(tuple.condition.name);
  if (!condition) {
    return errorOutcome(
      new AuthorizationError(
        'invalid-model',
        `Tuple condition ${tuple.condition.name} does not exist in the active model.`,
      ),
    );
  }
  try {
    return condition.evaluate(state.context, tuple.condition.context) ? allow() : deny();
  } catch (error) {
    return errorOutcome(
      error instanceof AuthorizationError
        ? error
        : new AuthorizationError(
            'invalid-model',
            `Tuple condition ${tuple.condition.name} evaluation failed.`,
            { cause: error },
          ),
    );
  }
}

function resolveOpenFgaRecursiveUsersets(
  model: CompiledAuthorizationGraph,
  initialUsersets: readonly string[],
  state: ResolutionState,
  visited: ReadonlySet<string>,
  depth: number,
): ResolutionOutcome {
  try {
    const result = breadthFirstRecursiveMatchSync(
      initialUsersets,
      (userset, usersetDepth) => {
        const subject = parseSubjectReference(userset, 'recursive.userset');
        if (subject.relation === undefined) {
          return { matched: false, children: [] };
        }
        const object = parseObjectReference(`${subject.type}:${subject.id}`);
        const compiledRelation = model.types
          .get(object.type)
          ?.relations.get(subject.relation);
        if (!compiledRelation) {
          throw new AuthorizationError(
            'unknown-relation',
            `Unknown recursive userset relation ${userset}.`,
          );
        }

        // OpenFGA's recursive fast path is selected for directly assignable,
        // self-recursive usersets. If a nested userset reaches richer rewrite
        // algebra, dispatch it through BXL's general resolver instead.
        if (compiledRelation.expression.kind !== 'direct') {
          const outcome = resolveRelation(
            model,
            object,
            subject.relation,
            state,
            new Set(visited),
            depth + usersetDepth,
          );
          if (outcome.status === 'error') throw outcome.error;
          return { matched: outcome.status === 'allow', children: [] };
        }

        const limitError = tick(state, depth + usersetDepth);
        if (limitError) throw limitError;
        const tuples = tuplesFor(state, object.canonical, subject.relation);
        if (tuples instanceof AuthorizationError) throw tuples;

        const children: string[] = [];
        for (const tuple of tuples) {
          if (directTupleMatchesSubject(tuple, state.subject)) {
            const condition = tupleConditionOutcome(model, tuple, state);
            if (condition.status === 'error') throw condition.error;
            if (condition.status === 'allow') {
              return { matched: true, children };
            }
            continue;
          }
          if (tuple.parsedSubject.relation !== undefined) {
            const condition = tupleConditionOutcome(model, tuple, state);
            if (condition.status === 'error') throw condition.error;
            if (condition.status === 'allow') {
              children.push(tuple.parsedSubject.canonical);
            }
          }
        }
        return { matched: false, children };
      },
      Math.max(0, state.limits.maxDepth - depth),
    );

    if (result.depthExceeded) {
      return errorOutcome(
        new AuthorizationError(
          'resolution-depth-exceeded',
          `Authorization resolution exceeded maximum depth ${state.limits.maxDepth}.`,
        ),
      );
    }

    const detail =
      `OpenFGA ${OPENFGA_RECURSIVE_PORT_INFO.upstreamFunctions[1]} ` +
      `synchronous port @ ${OPENFGA_RECURSIVE_PORT_INFO.commit.slice(0, 12)}` +
      (result.cyclePruned > 0 ? `; ${result.cyclePruned} revisits pruned` : '');
    const traceVisits = result.matched
      ? result.path.map((userset, usersetDepth) => ({ userset, depth: usersetDepth }))
      : result.visited;
    for (const visit of [...traceVisits].reverse()) {
      const subject = parseSubjectReference(visit.userset, 'recursive.trace');
      recordTrace(state, {
        depth: depth + visit.depth,
        operation: 'openfga-recursive-userset',
        subject: state.subject.canonical,
        relation: subject.relation ?? 'userset',
        object: `${subject.type}:${subject.id}`,
        outcome: result.matched ? 'allow' : 'deny',
        detail,
      });
    }
    return result.matched ? allow() : deny();
  } catch (error) {
    return errorOutcome(
      error instanceof AuthorizationError
        ? error
        : new AuthorizationError(
            'invalid-model',
            'OpenFGA recursive userset port failed.',
            { cause: error },
          ),
    );
  }
}

function resolveDirect(
  model: CompiledAuthorizationGraph,
  object: EntityReference,
  relation: string,
  state: ResolutionState,
  visited: ReadonlySet<string>,
  depth: number,
): ResolutionOutcome {
  const tuples = tuplesFor(state, object.canonical, relation);
  if (tuples instanceof AuthorizationError) return errorOutcome(tuples);

  const outcomes: ResolutionOutcome[] = [];
  const openFgaRecursiveUsersets: string[] = [];
  for (const tuple of tuples) {
    if (directTupleMatchesSubject(tuple, state.subject)) {
      const condition = tupleConditionOutcome(model, tuple, state);
      if (condition.status === 'allow') return allow();
      if (condition.status === 'error' || condition.status === 'cycle') {
        outcomes.push(condition);
      }
      continue;
    }
    if (tuple.parsedSubject.relation !== undefined) {
      const condition = tupleConditionOutcome(model, tuple, state);
      if (condition.status === 'deny') continue;
      if (condition.status === 'error' || condition.status === 'cycle') {
        outcomes.push(condition);
        continue;
      }
      const usersetObject = parseObjectReference(
        `${tuple.parsedSubject.type}:${tuple.parsedSubject.id}`,
      );
      const usersetRelation = model.types
        .get(usersetObject.type)
        ?.relations.get(tuple.parsedSubject.relation);
      if (usersetRelation?.expression.kind === 'direct') {
        openFgaRecursiveUsersets.push(tuple.parsedSubject.canonical);
      } else {
        outcomes.push(
          resolveRelation(
            model,
            usersetObject,
            tuple.parsedSubject.relation,
            state,
            new Set(visited),
            depth + 1,
          ),
        );
      }
    }
  }
  if (openFgaRecursiveUsersets.length > 0) {
    for (const userset of openFgaRecursiveUsersets) {
      outcomes.push(
        resolveOpenFgaRecursiveUsersets(
          model,
          [userset],
          state,
          visited,
          depth + 1,
        ),
      );
      if (outcomes.at(-1)?.status === 'allow') break;
    }
  }
  return mergeUnion(outcomes);
}

function resolveTupleToUserset(
  model: CompiledAuthorizationGraph,
  expression: Extract<AuthorizationRelationExpression, { kind: 'tupleToUserset' }>,
  object: EntityReference,
  state: ResolutionState,
  visited: ReadonlySet<string>,
  depth: number,
): ResolutionOutcome {
  const tuples = tuplesFor(state, object.canonical, expression.tupleset);
  if (tuples instanceof AuthorizationError) return errorOutcome(tuples);

  const outcomes: ResolutionOutcome[] = [];
  for (const tuple of tuples) {
    if (tuple.parsedSubject.wildcard || tuple.parsedSubject.relation !== undefined) {
      continue;
    }
    const condition = tupleConditionOutcome(model, tuple, state);
    if (condition.status === 'deny') continue;
    if (condition.status === 'error' || condition.status === 'cycle') {
      outcomes.push(condition);
      continue;
    }
    const target = parseObjectReference(
      `${tuple.parsedSubject.type}:${tuple.parsedSubject.id}`,
    );
    if (!model.types.get(target.type)?.relations.has(expression.computed)) {
      continue;
    }
    outcomes.push(
      resolveRelation(
        model,
        target,
        expression.computed,
        state,
        new Set(visited),
        depth + 1,
      ),
    );
  }
  return mergeUnion(outcomes);
}

function resolveExpression(
  model: CompiledAuthorizationGraph,
  expression: AuthorizationRelationExpression,
  object: EntityReference,
  relation: string,
  state: ResolutionState,
  visited: ReadonlySet<string>,
  depth: number,
): ResolutionOutcome {
  switch (expression.kind) {
    case 'direct':
      return resolveDirect(model, object, relation, state, visited, depth);
    case 'computed':
      return resolveRelation(
        model,
        object,
        expression.relation,
        state,
        new Set(visited),
        depth + 1,
      );
    case 'tupleToUserset':
      return resolveTupleToUserset(model, expression, object, state, visited, depth);
    case 'union': {
      const outcomes: ResolutionOutcome[] = [];
      for (const child of expression.children) {
        const outcome = resolveExpression(
          model,
          child,
          object,
          relation,
          state,
          new Set(visited),
          depth,
        );
        outcomes.push(outcome);
        if (outcome.status === 'allow') break;
      }
      return mergeUnion(outcomes);
    }
    case 'intersection': {
      const outcomes: ResolutionOutcome[] = [];
      for (const child of expression.children) {
        const outcome = resolveExpression(
          model,
          child,
          object,
          relation,
          state,
          new Set(visited),
          depth,
        );
        outcomes.push(outcome);
        if (outcome.status === 'deny' || outcome.status === 'cycle') break;
      }
      return mergeIntersection(outcomes);
    }
    case 'difference':
      return mergeDifference(
        resolveExpression(
          model,
          expression.base,
          object,
          relation,
          state,
          new Set(visited),
          depth,
        ),
        resolveExpression(
          model,
          expression.subtract,
          object,
          relation,
          state,
          new Set(visited),
          depth,
        ),
      );
    case 'predicate':
      try {
        return expression.evaluate({
          context: state.context,
          subject: state.subject,
          object,
          relation,
        })
          ? allow()
          : deny();
      } catch (error) {
        return errorOutcome(
          error instanceof AuthorizationError
            ? error
            : new AuthorizationError(
                'invalid-model',
                'BXL authorization predicate evaluation failed.',
                { cause: error },
              ),
        );
      }
  }
}

function resolveRelation(
  model: CompiledAuthorizationGraph,
  object: EntityReference,
  relation: string,
  state: ResolutionState,
  visited: ReadonlySet<string>,
  depth: number,
): ResolutionOutcome {
  const limitError = tick(state, depth);
  if (limitError) return errorOutcome(limitError);

  const type = model.types.get(object.type);
  const compiledRelation = type?.relations.get(relation);
  if (!compiledRelation) {
    return errorOutcome(
      new AuthorizationError(
        'unknown-relation',
        `Unknown relation ${object.type}#${relation}.`,
      ),
    );
  }

  const key = relationKey(state.subject.canonical, object.canonical, relation);
  if (visited.has(key)) {
    recordTrace(state, {
      depth,
      operation: 'cycle',
      subject: state.subject.canonical,
      relation,
      object: object.canonical,
      outcome: 'deny',
      detail: 'repeated relation path',
    });
    return cycle();
  }
  const nextVisited = new Set(visited);
  nextVisited.add(key);

  const outcome = resolveExpression(
    model,
    compiledRelation.expression,
    object,
    relation,
    state,
    nextVisited,
    depth,
  );
  recordTrace(state, {
    depth,
    operation: compiledRelation.expression.kind,
    subject: state.subject.canonical,
    relation,
    object: object.canonical,
    outcome: outcome.status === 'cycle' ? 'deny' : outcome.status,
    ...(outcome.status === 'error' ? { detail: outcome.error.message } : {}),
  });
  return outcome;
}

export function checkAuthorization(
  model: CompiledAuthorizationGraph,
  stored: AuthorizationTupleIndex,
  request: AuthorizationCheckRequest,
): AuthorizationSafeResult<AuthorizationCheckResult> {
  try {
    const subject = parseSubjectReference(request.subject, 'request.subject');
    const object = parseObjectReference(request.object, 'request.object');
    if (!model.types.has(subject.type)) {
      throw new AuthorizationError('unknown-type', `Unknown subject type ${subject.type}.`, {
        path: 'request.subject',
      });
    }
    if (subject.relation !== undefined) {
      const subjectRelation = model.types.get(subject.type)?.relations.get(subject.relation);
      if (!subjectRelation) {
        throw new AuthorizationError(
          'unknown-relation',
          `Unknown userset relation ${subject.type}#${subject.relation}.`,
          { path: 'request.subject' },
        );
      }
    }
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

    const metrics: AuthorizationCheckMetrics = {
      steps: 0,
      tupleReads: 0,
      maxDepth: 0,
    };
    const state: ResolutionState = {
      subject,
      context: request.context ?? {},
      stored,
      ...(request.contextualTuples && request.contextualTuples.length > 0
        ? {
            contextual: buildAuthorizationTupleIndex(
              model,
              request.contextualTuples,
            ),
          }
        : {}),
      limits: resolvedLimits(request.limits),
      metrics,
      ...(request.trace ? { trace: [] } : {}),
    };

    const outcome = resolveRelation(model, object, request.relation, state, new Set(), 0);
    if (outcome.status === 'error') {
      return { ok: false, error: outcome.error.toRecord() };
    }
    return {
      ok: true,
      value: {
        allowed: outcome.status === 'allow',
        metrics,
        trace: state.trace ?? [],
      },
    };
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
