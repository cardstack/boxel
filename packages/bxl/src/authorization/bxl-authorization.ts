import { parseBxlAst } from '../bxl/ast/index.js';
import { parseNativeJq } from '../bxl/bridge/native.js';
import type { ExpressionAst } from '../jqtools/parser/AST.js';
import { AuthorizationError, toAuthorizationErrorRecord, type AuthorizationSafeResult } from './errors.js';
import type { AuthorizationRuntimeLimits, AuthorizationTraceEvent } from './resolver.js';
import { prepareAuthorizationGraphSafe, type PreparedAuthorizationGraph } from './index.js';
import type {
  AuthorizationGraphModel,
  RelationshipTuple,
} from './graph-model.js';

export const BXL_AUTHORIZATION_SCHEMA = 'bxl-authorization/1' as const;

export interface BxlAuthorizationLink {
  /** Stable UpperCamelCase handle used as `Resource.Handle`. */
  name: string;
  /** Stable UpperCamelCase name of the linked authorization type. */
  to: string;
  displayName?: string;
}

export interface BxlAuthorizationSeat {
  /** Stable UpperCamelCase handle used as `Seat.Handle`. */
  name: string;
  displayName?: string;
  /** Optional relationship source such as `Resource.Operator`. */
  from?: string;
}

export interface BxlAuthorizationRefusal {
  when: string;
  because: string;
}

export interface BxlAuthorizationCapability {
  /** Stable UpperCamelCase handle used as `Capability.Handle`. */
  name: string;
  displayName?: string;
  /** Positive BXL eligibility expression. */
  where: string;
  /** Explicit deny clauses, evaluated after `where`. */
  refuse?: string | readonly BxlAuthorizationRefusal[];
}

export interface BxlAuthorizationScope {
  /** Stable UpperCamelCase authorization type name. */
  name: string;
  links?: readonly BxlAuthorizationLink[];
  seats?: readonly BxlAuthorizationSeat[];
  capabilities: readonly BxlAuthorizationCapability[];
}

export interface BxlAuthorizationDocument {
  schema: typeof BXL_AUTHORIZATION_SCHEMA;
  /** Optional stable identifier for this authorization document. */
  id?: string;
  scopes: readonly BxlAuthorizationScope[];
}

export interface BxlAuthorizationResource {
  /** Stable identifier for the protected resource. */
  resource: string;
  /** Stable authorization type name matching a document scope. */
  type: string;
  /** Ordinary resource values made available as `Resource`. */
  data?: Readonly<Record<string, unknown>>;
  /** Loaded resource relationships, keyed by camelCase field name. */
  links?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface BxlAuthorizationParty {
  /** Stable identifier for the party. */
  party: string;
  data?: Readonly<Record<string, unknown>>;
  /** Nested Party membership. A seated team also seats its members. */
  members?: readonly string[];
}

export interface BxlAuthorizationPolicyData {
  id?: string;
  data?: Readonly<Record<string, unknown>>;
  links?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface BxlAuthorizationSeatAssignment {
  resource: string;
  seat: string;
  holders: readonly string[];
}

export interface BxlAuthorizationSnapshot {
  policy?: BxlAuthorizationPolicyData;
  resources: readonly BxlAuthorizationResource[];
  parties: readonly BxlAuthorizationParty[];
  seats?: readonly BxlAuthorizationSeatAssignment[];
  /** Realm members available through `Party.Member`. */
  members?: readonly string[];
  /** Non-members admitted by the authorization document, available through `Party.Guest`. */
  guests?: readonly string[];
}

export interface BxlAuthorizationCheckRequest {
  party: string;
  capability: string;
  resource: string;
  input?: Readonly<Record<string, unknown>>;
  /** The host supplies time explicitly; the evaluator never reads a clock. */
  now?: unknown;
  trace?: boolean;
  limits?: AuthorizationRuntimeLimits;
}

export interface BxlAuthorizationTraceEvent {
  depth: number;
  operation: string;
  party: string;
  capability: string;
  resource: string;
  outcome: 'allow' | 'deny' | 'error';
  detail?: string;
}

export interface BxlAuthorizationReason {
  kind: 'capability' | 'refusal';
  message: string;
}

export interface BxlAuthorizationCheckResult {
  allowed: boolean;
  decision: 'allow' | 'refuse';
  because: readonly BxlAuthorizationReason[];
  metrics: { steps: number; tupleReads: number; maxDepth: number };
  trace: readonly BxlAuthorizationTraceEvent[];
}

interface BxlAuthorizationEnumerationRequest {
  input?: Readonly<Record<string, unknown>>;
  now?: unknown;
  limits?: AuthorizationRuntimeLimits;
}

export interface BxlAuthorizationListResourcesRequest extends BxlAuthorizationEnumerationRequest {
  party: string;
  capability: string;
  type?: string;
}

export interface BxlAuthorizationListResourcesResult {
  resources: readonly string[];
  metrics: { steps: number; tupleReads: number; maxDepth: number };
}

export interface BxlAuthorizationListPartiesRequest extends BxlAuthorizationEnumerationRequest {
  resource: string;
  capability: string;
}

export interface BxlAuthorizationListPartiesResult {
  parties: readonly string[];
  metrics: { steps: number; tupleReads: number; maxDepth: number };
}

export interface BxlAuthorizationListCapabilitiesRequest extends BxlAuthorizationEnumerationRequest {
  party: string;
  resource: string;
}

export interface BxlAuthorizationListCapabilitiesResult {
  capabilities: readonly string[];
  metrics: { steps: number; tupleReads: number; maxDepth: number };
}

export interface PreparedBxlAuthorization {
  checkCapability(request: BxlAuthorizationCheckRequest): AuthorizationSafeResult<BxlAuthorizationCheckResult>;
  checkCapabilities(
    requests: readonly BxlAuthorizationCheckRequest[],
  ): readonly AuthorizationSafeResult<BxlAuthorizationCheckResult>[];
  listResources(request: BxlAuthorizationListResourcesRequest): AuthorizationSafeResult<BxlAuthorizationListResourcesResult>;
  listParties(request: BxlAuthorizationListPartiesRequest): AuthorizationSafeResult<BxlAuthorizationListPartiesResult>;
  listCapabilities(
    request: BxlAuthorizationListCapabilitiesRequest,
  ): AuthorizationSafeResult<BxlAuthorizationListCapabilitiesResult>;
}

const HANDLE = /^[A-Z][A-Za-z0-9]*$/;
const RESERVED_AUDIENCES = new Map([
  ['anyone', '__party_anyone'],
  ['member', '__party_member'],
  ['guest', '__party_guest'],
]);

function handle(name: string, path: string): string {
  if (!HANDLE.test(name)) {
    throw new AuthorizationError(
      'invalid-identifier',
      `${path} must be an UpperCamelCase handle such as Operator or InvokeCommand. Put human-facing spacing in displayName.`,
      { path },
    );
  }
  return name[0]!.toLowerCase() + name.slice(1);
}

function uniqueByHandle<T extends { name: string }>(
  values: readonly T[] | undefined,
  path: string,
): Map<string, T> {
  const result = new Map<string, T>();
  for (let index = 0; index < (values?.length ?? 0); index++) {
    const value = values![index]!;
    const key = handle(value.name, `${path}[${index}].name`);
    if (result.has(key)) {
      throw new AuthorizationError('invalid-model', `Duplicate handle ${value.name}.`, {
        path: `${path}[${index}].name`,
      });
    }
    result.set(key, value);
  }
  return result;
}

function encoded(value: string): string {
  if (value.trim() === '') {
    throw new AuthorizationError('invalid-identifier', 'Resource references cannot be empty.');
  }
  return encodeURIComponent(value);
}

function internalParty(value: string): string {
  return `party:${encoded(value)}`;
}

function internalObject(type: string, value: string): string {
  return `${type}:${encoded(value)}`;
}

function pathOf(node: ExpressionAst): readonly string[] | undefined {
  if (node.type !== 'index' || !node.staticPath) return undefined;
  return node.staticPath;
}

interface ScopeCompilation {
  definition: BxlAuthorizationScope;
  internalType: string;
  links: Map<string, BxlAuthorizationLink>;
  seats: Map<string, BxlAuthorizationSeat>;
  capabilities: Map<string, BxlAuthorizationCapability>;
}

function visitExpression(
  node: unknown,
  visit: (node: ExpressionAst) => boolean | void,
): void {
  if (!node || typeof node !== 'object') return;
  if ('type' in node && typeof node.type === 'string') {
    if (visit(node as ExpressionAst) === false) return;
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) visitExpression(item, visit);
    } else {
      visitExpression(value, visit);
    }
  }
}

function compilePolicyExpression(
  source: string,
  owner: ScopeCompilation,
  scopesByName: ReadonlyMap<string, ScopeCompilation>,
  path: string,
): string {
  let program;
  try {
    program = parseBxlAst(source, { profile: 'policy' });
  } catch (cause) {
    throw new AuthorizationError('invalid-expression', 'Could not parse BXL authorization expression.', {
      path,
      cause,
    });
  }
  const errors = program.profileIssues.filter((issue) => issue.severity === 'error');
  if (errors.length > 0) {
    throw new AuthorizationError(
      'unsafe-expression',
      errors.map((issue) => `${issue.code}: ${issue.message}`).join('\n'),
      { path },
    );
  }
  const parsed = parseNativeJq(program.canonicalSource, { readableSyntax: false });
  if (!parsed.ast.expr) {
    throw new AuthorizationError('invalid-expression', 'BXL authorization expression is empty.', {
      path,
    });
  }

  visitExpression(parsed.ast.expr, (node) => {
    const nodePath = pathOf(node);
    if (nodePath?.[0] === 'seat') {
      if (nodePath.length !== 2 || !owner.seats.has(nodePath[1]!)) {
        throw new AuthorizationError(
          'unknown-relation',
          `Unknown seat ${nodePath.join('.')}.`,
          { path },
        );
      }
      return false;
    }
    if (nodePath?.[0] === 'capability') {
      if (nodePath.length !== 2 || !owner.capabilities.has(nodePath[1]!)) {
        throw new AuthorizationError(
          'unknown-relation',
          `Unknown capability ${nodePath.join('.')}.`,
          { path },
        );
      }
      return false;
    }
    if (nodePath?.[0] === 'party' && RESERVED_AUDIENCES.has(nodePath[1] ?? '')) {
      if (nodePath.length !== 2) {
        throw new AuthorizationError('invalid-expression', 'Party audiences cannot be traversed.', {
          path,
        });
      }
      return false;
    }
    if (node.type === 'filter' && node.name.replace(/\/\d+$/, '') === 'via') {
      if (node.args.length !== 2) {
        throw new AuthorizationError(
          'invalid-expression',
          'via() requires two BXL arguments separated by `;`: a Resource link and a Capability.',
          { path },
        );
      }
      const linkPath = pathOf(node.args[0]!);
      const capabilityPath = pathOf(node.args[1]!);
      if (linkPath?.length !== 2 || linkPath[0] !== 'resource') {
        throw new AuthorizationError(
          'invalid-expression',
          'The first via() argument must be a declared Resource link such as Resource.Parent.',
          { path },
        );
      }
      if (capabilityPath?.length !== 2 || capabilityPath[0] !== 'capability') {
        throw new AuthorizationError(
          'invalid-expression',
          'The second via() argument must be a capability such as Capability.InvokeCommand.',
          { path },
        );
      }
      const link = owner.links.get(linkPath[1]!);
      if (!link) {
        throw new AuthorizationError('unknown-relation', `Unknown Resource link Resource.${linkPath[1]}.`, {
          path,
        });
      }
      const target = scopesByName.get(handle(link.to, `${path}.via.to`));
      if (!target?.capabilities.has(capabilityPath[1]!)) {
        throw new AuthorizationError(
          'unknown-relation',
          `Resource.${linkPath[1]} does not lead to a scope with Capability.${capabilityPath[1]}.`,
          { path },
        );
      }
      return false;
    }
    return true;
  });

  let translated = program.canonicalSource;
  translated = translated.replace(
    /via\(\.resource\.([A-Za-z_][A-Za-z0-9_]*);\s*\.capability\.([A-Za-z_][A-Za-z0-9_]*)\)/g,
    (_match, link: string, capability: string) =>
      `userset_from(${JSON.stringify(link)}; ${JSON.stringify(capability)})`,
  );
  translated = translated.replace(
    /\.seat\.([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, seat: string) => `userset(${JSON.stringify(seat)})`,
  );
  translated = translated.replace(
    /\.capability\.([A-Za-z_][A-Za-z0-9_]*)/g,
    (_match, capability: string) => `userset(${JSON.stringify(capability)})`,
  );
  translated = translated.replace(
    /\.party\.(anyone|member|guest)/g,
    (_match, audience: string) =>
      `userset(${JSON.stringify(RESERVED_AUDIENCES.get(audience))})`,
  );
  return translated;
}

function refusalDefinitions(
  capability: BxlAuthorizationCapability,
): readonly BxlAuthorizationRefusal[] {
  if (!capability.refuse) return [];
  if (typeof capability.refuse === 'string') {
    return [{ when: capability.refuse, because: `Refused by ${capability.displayName ?? capability.name}.` }];
  }
  return capability.refuse;
}

function metrics(): { steps: number; tupleReads: number; maxDepth: number } {
  return { steps: 0, tupleReads: 0, maxDepth: 0 };
}

function enumerationLimit(
  value: number | undefined,
  fallback: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new AuthorizationError(
      'invalid-model',
      `BXL authorization evaluation limit ${name} must be a positive safe integer.`,
      { path: `limits.${name}` },
    );
  }
  return resolved;
}

function addMetrics(
  target: { steps: number; tupleReads: number; maxDepth: number },
  source: { steps: number; tupleReads: number; maxDepth: number },
): void {
  target.steps += source.steps;
  target.tupleReads += source.tupleReads;
  target.maxDepth = Math.max(target.maxDepth, source.maxDepth);
}

interface CompiledBxlAuthorization {
  runtime: PreparedAuthorizationGraph;
  scopesByType: Map<string, ScopeCompilation>;
  resourcesByRef: Map<string, BxlAuthorizationResource>;
  partiesByRef: Map<string, BxlAuthorizationParty>;
  objectToResource: Map<string, string>;
  relationLabels: Map<string, string>;
  refusalRelations: Map<string, readonly { relation: string; because: string }[]>;
  contextBase: Readonly<Record<string, unknown>>;
}

function sourceField(source: string, path: string): { root: 'resource' | 'policy'; field: string } {
  const match = /^(Resource|Policy)\.([A-Z][A-Za-z0-9]*)$/.exec(source);
  if (!match) {
    throw new AuthorizationError(
      'invalid-expression',
      `${path} must be a direct relationship path such as Resource.Operator or Policy.Owners.`,
      { path },
    );
  }
  return {
    root: match[1]!.toLowerCase() as 'resource' | 'policy',
    field: handle(match[2]!, path),
  };
}

function asLinks(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function compileBxlAuthorization(
  document: BxlAuthorizationDocument,
  snapshot: BxlAuthorizationSnapshot,
): CompiledBxlAuthorization {
  if (!document || document.schema !== BXL_AUTHORIZATION_SCHEMA) {
    throw new AuthorizationError(
      'invalid-model',
      `BXL authorization schema must be ${BXL_AUTHORIZATION_SCHEMA}.`,
      { path: 'schema' },
    );
  }
  if (!Array.isArray(document.scopes) || document.scopes.length === 0) {
    throw new AuthorizationError('invalid-model', 'A BXL authorization must declare at least one scope.', {
      path: 'scopes',
    });
  }

  const scopesByName = new Map<string, ScopeCompilation>();
  for (let index = 0; index < document.scopes.length; index++) {
    const definition = document.scopes[index]!;
    const name = handle(definition.name, `scopes[${index}].name`);
    if (scopesByName.has(name)) {
      throw new AuthorizationError('invalid-model', `Duplicate authorization scope ${definition.name}.`, {
        path: `scopes[${index}]`,
      });
    }
    const compilation: ScopeCompilation = {
      definition,
      internalType: `scope_${name}`,
      links: uniqueByHandle(definition.links, `scopes[${index}].links`),
      seats: uniqueByHandle(definition.seats, `scopes[${index}].seats`),
      capabilities: uniqueByHandle(
        definition.capabilities,
        `scopes[${index}].capabilities`,
      ),
    };
    for (let linkIndex = 0; linkIndex < (definition.links?.length ?? 0); linkIndex++) {
      handle(definition.links![linkIndex]!.to, `scopes[${index}].links[${linkIndex}].to`);
    }
    for (const key of compilation.links.keys()) {
      if (compilation.seats.has(key) || compilation.capabilities.has(key)) {
        throw new AuthorizationError('invalid-model', `Authorization handle ${key} is ambiguous.`, {
          path: `scopes[${index}]`,
        });
      }
    }
    for (const key of compilation.seats.keys()) {
      if (compilation.capabilities.has(key)) {
        throw new AuthorizationError('invalid-model', `Authorization handle ${key} is ambiguous.`, {
          path: `scopes[${index}]`,
        });
      }
    }
    scopesByName.set(name, compilation);
  }

  const types: Record<string, import('./graph-model.js').AuthorizationGraphType> = {
    party: {
      relations: {
        member: { subjects: ['party', 'party#member'], rewrite: 'direct()' },
      },
    },
  };
  const relationLabels = new Map<string, string>();
  const refusalRelations = new Map<string, readonly { relation: string; because: string }[]>();

  for (const scope of scopesByName.values()) {
    const relations: Record<string, import('./graph-model.js').AuthorizationGraphRelationDefinition> = {
      __party_anyone: ['party:*'],
      __party_member: ['party', 'party#member'],
      __party_guest: ['party', 'party#member'],
    };
    const permissions: Record<string, string> = {};
    for (const [name, link] of scope.links) {
      const target = scopesByName.get(handle(link.to, `scopes.${scope.definition.name}.links.${link.name}.to`));
      if (!target) {
        throw new AuthorizationError(
          'unknown-type',
          `Resource link ${scope.definition.name}.${link.name} targets undeclared authorization type ${link.to}.`,
        );
      }
      relations[name] = [target.internalType];
      relationLabels.set(`${scope.internalType}\0${name}`, link.displayName ?? link.name);
    }
    for (const [name, seat] of scope.seats) {
      if (seat.from) sourceField(seat.from, `scopes.${scope.definition.name}.seats.${seat.name}.from`);
      relations[name] = ['party', 'party#member', 'party:*'];
      relationLabels.set(`${scope.internalType}\0${name}`, seat.displayName ?? seat.name);
    }
    for (const [name, capability] of scope.capabilities) {
      const where = compilePolicyExpression(
        capability.where,
        scope,
        scopesByName,
        `scopes.${scope.definition.name}.capabilities.${capability.name}.where`,
      );
      const refusals = refusalDefinitions(capability);
      const refusalEntries: { relation: string; because: string }[] = [];
      const refusalExpressions = refusals.map((refusal, index) => {
        const relation = `__refuse_${name}_${index}`;
        permissions[relation] = compilePolicyExpression(
          refusal.when,
          scope,
          scopesByName,
          `scopes.${scope.definition.name}.capabilities.${capability.name}.refuse[${index}]`,
        );
        refusalEntries.push({ relation, because: refusal.because });
        return `userset(${JSON.stringify(relation)})`;
      });
      permissions[name] =
        refusalExpressions.length === 0
          ? where
          : `except(${where}; ${refusalExpressions.join(' or ')})`;
      refusalRelations.set(`${scope.internalType}\0${name}`, refusalEntries);
      relationLabels.set(
        `${scope.internalType}\0${name}`,
        capability.displayName ?? capability.name,
      );
    }
    types[scope.internalType] = { relations, permissions };
  }

  const model: AuthorizationGraphModel = {
    schema: 'bxl-authorization-ir/1',
    types,
  };
  const resourcesByRef = new Map<string, BxlAuthorizationResource>();
  const objectToResource = new Map<string, string>();
  for (const resource of snapshot.resources) {
    if (resourcesByRef.has(resource.resource)) {
      throw new AuthorizationError('invalid-model', `Duplicate resource snapshot ${resource.resource}.`);
    }
    const scope = scopesByName.get(handle(resource.type, `resources.${resource.resource}.type`));
    if (!scope) {
      throw new AuthorizationError(
        'unknown-type',
        `Resource ${resource.resource} has undeclared authorization type ${resource.type}.`,
      );
    }
    resourcesByRef.set(resource.resource, resource);
    objectToResource.set(
      internalObject(scope.internalType, resource.resource),
      resource.resource,
    );
  }

  const partiesByRef = new Map<string, BxlAuthorizationParty>();
  const ensureParty = (party: string): BxlAuthorizationParty => {
    const existing = partiesByRef.get(party);
    if (existing) return existing;
    const created = { party };
    partiesByRef.set(party, created);
    return created;
  };
  for (const party of snapshot.parties) {
    if (partiesByRef.has(party.party)) {
      throw new AuthorizationError('invalid-model', `Duplicate party snapshot ${party.party}.`);
    }
    partiesByRef.set(party.party, party);
  }
  for (const party of snapshot.parties) {
    for (const member of party.members ?? []) ensureParty(member);
  }
  for (const party of snapshot.members ?? []) ensureParty(party);
  for (const party of snapshot.guests ?? []) ensureParty(party);

  const tuples: RelationshipTuple[] = [];
  const partySubject = (party: string): string => {
    const record = ensureParty(party);
    return `${internalParty(party)}${(record.members?.length ?? 0) > 0 ? '#member' : ''}`;
  };
  for (const party of partiesByRef.values()) {
    for (const member of party.members ?? []) {
      tuples.push({
        subject: partySubject(member),
        relation: 'member',
        object: internalParty(party.party),
      });
    }
  }

  for (const sourceResource of snapshot.resources) {
    const scope = scopesByName.get(
      handle(sourceResource.type, `resources.${sourceResource.resource}.type`),
    )!;
    const internal = internalObject(scope.internalType, sourceResource.resource);
    tuples.push({ subject: 'party:*', relation: '__party_anyone', object: internal });
    for (const party of snapshot.members ?? []) {
      tuples.push({ subject: partySubject(party), relation: '__party_member', object: internal });
    }
    for (const party of snapshot.guests ?? []) {
      tuples.push({ subject: partySubject(party), relation: '__party_guest', object: internal });
    }
    for (const [name, link] of scope.links) {
      for (const targetRef of asLinks(sourceResource.links?.[name])) {
        const targetResource = resourcesByRef.get(targetRef);
        const targetScope =
          targetResource &&
          scopesByName.get(handle(targetResource.type, `resources.${targetRef}.type`));
        if (!targetResource || !targetScope || targetScope.definition.name !== link.to) {
          throw new AuthorizationError(
            'invalid-model',
            `Resource.${link.name} on ${sourceResource.resource} points to ${targetRef}, which is absent or has the wrong authorization type.`,
          );
        }
        tuples.push({
          subject: internalObject(targetScope.internalType, targetRef),
          relation: name,
          object: internal,
        });
      }
    }
    for (const [name, seat] of scope.seats) {
      if (!seat.from) continue;
      const source = sourceField(
        seat.from,
        `scopes.${scope.definition.name}.seats.${seat.name}.from`,
      );
      const links =
        source.root === 'resource' ? sourceResource.links : snapshot.policy?.links;
      for (const holder of asLinks(links?.[source.field])) {
        tuples.push({ subject: partySubject(holder), relation: name, object: internal });
      }
    }
  }

  for (const assignment of snapshot.seats ?? []) {
    const resource = resourcesByRef.get(assignment.resource);
    if (!resource) {
      throw new AuthorizationError(
        'invalid-identifier',
        `Unknown seat resource ${assignment.resource}.`,
      );
    }
    const scope = scopesByName.get(
      handle(resource.type, `resources.${resource.resource}.type`),
    )!;
    const name = handle(assignment.seat, 'seats[].seat');
    if (!scope.seats.has(name)) {
      throw new AuthorizationError(
        'unknown-relation',
        `Resource ${assignment.resource} does not declare Seat.${assignment.seat}.`,
      );
    }
    for (const holder of assignment.holders) {
      tuples.push({
        subject: partySubject(holder),
        relation: name,
        object: internalObject(scope.internalType, assignment.resource),
      });
    }
  }

  const prepared = prepareAuthorizationGraphSafe(model, tuples);
  if (!prepared.ok) {
    throw new AuthorizationError(prepared.error.kind, prepared.error.message, {
      path: prepared.error.path,
    });
  }

  const resources: Record<string, unknown> = {};
  for (const resource of snapshot.resources) {
    const scope = scopesByName.get(
      handle(resource.type, `resources.${resource.resource}.type`),
    )!;
    resources[internalObject(scope.internalType, resource.resource)] = {
      id: resource.resource,
      type: resource.type,
      ...(resource.data ?? {}),
      ...(resource.links ?? {}),
    };
  }
  const parties: Record<string, unknown> = {};
  for (const party of partiesByRef.values()) {
    parties[internalParty(party.party)] = {
      id: party.party,
      ...(party.data ?? {}),
      ...(party.members ? { members: party.members } : {}),
    };
  }
  const contextBase = {
    __bxlAuthorization: {
      resources,
      parties,
      policy: {
        id: snapshot.policy?.id ?? document.id,
        ...(snapshot.policy?.data ?? {}),
        ...(snapshot.policy?.links ?? {}),
      },
    },
  };

  return {
    runtime: prepared.value,
    scopesByType: scopesByName,
    resourcesByRef,
    partiesByRef,
    objectToResource,
    relationLabels,
    refusalRelations,
    contextBase,
  };
}

function requestContext(
  compiled: CompiledBxlAuthorization,
  request: BxlAuthorizationEnumerationRequest,
): Readonly<Record<string, unknown>> {
  return {
    ...compiled.contextBase,
    input: request.input ?? {},
    ...(request.now === undefined ? {} : { now: request.now }),
  };
}

function resolveRequest(
  compiled: CompiledBxlAuthorization,
  request: { party: string; capability: string; resource: string },
): { subject: string; relation: string; object: string; scope: ScopeCompilation } {
  const resource = compiled.resourcesByRef.get(request.resource);
  if (!resource) {
    throw new AuthorizationError('invalid-identifier', `Unknown authorization resource ${request.resource}.`, {
      path: 'request.resource',
    });
  }
  const scope = compiled.scopesByType.get(
    handle(resource.type, `resources.${resource.resource}.type`),
  )!;
  const relation = handle(request.capability, 'request.capability');
  if (!scope.capabilities.has(relation)) {
    throw new AuthorizationError(
      'unknown-relation',
      `${request.resource} does not declare Capability.${request.capability}.`,
      { path: 'request.capability' },
    );
  }
  return {
    subject: internalParty(request.party),
    relation,
    object: internalObject(scope.internalType, request.resource),
    scope,
  };
}

function decodeParty(value: string): string {
  const hash = value.lastIndexOf('#');
  const entity = hash === -1 ? value : value.slice(0, hash);
  const separator = entity.indexOf(':');
  return separator === -1 ? value : decodeURIComponent(entity.slice(separator + 1));
}

function decodeTraceResource(
  compiled: CompiledBxlAuthorization,
  value: string,
): string {
  const resource = compiled.objectToResource.get(value);
  if (resource) {
    return resource;
  }
  return value.startsWith('party:')
    ? decodeURIComponent(value.slice('party:'.length))
    : value;
}

function translateTrace(
  compiled: CompiledBxlAuthorization,
  trace: readonly AuthorizationTraceEvent[],
): BxlAuthorizationTraceEvent[] {
  return trace.map((event) => {
    const separator = event.object.indexOf(':');
    const type = separator === -1 ? '' : event.object.slice(0, separator);
    const capability =
      compiled.relationLabels.get(`${type}\0${event.relation}`) ?? event.relation;
    return {
      depth: event.depth,
      operation: event.operation,
      party: decodeParty(event.subject),
      capability,
      resource: decodeTraceResource(compiled, event.object),
      outcome: event.outcome,
      ...(event.detail ? { detail: event.detail } : {}),
    };
  });
}

function checkCapabilityCompiled(
  compiled: CompiledBxlAuthorization,
  request: BxlAuthorizationCheckRequest,
): AuthorizationSafeResult<BxlAuthorizationCheckResult> {
  try {
    const resolved = resolveRequest(compiled, request);
    const context = requestContext(compiled, request);
    const result = compiled.runtime.check({
      subject: resolved.subject,
      relation: resolved.relation,
      object: resolved.object,
      context,
      trace: request.trace ?? false,
      ...(request.limits ? { limits: request.limits } : {}),
    });
    if (!result.ok) return result;
    const because: BxlAuthorizationReason[] = [];
    if (result.value.allowed) {
      const label =
        compiled.relationLabels.get(`${resolved.scope.internalType}\0${resolved.relation}`) ??
        request.capability;
      because.push({ kind: 'capability', message: `Capability ${label} allowed this party.` });
    } else {
      for (const refusal of compiled.refusalRelations.get(
        `${resolved.scope.internalType}\0${resolved.relation}`,
      ) ?? []) {
        const refused = compiled.runtime.check({
          subject: resolved.subject,
          relation: refusal.relation,
          object: resolved.object,
          context,
          ...(request.limits ? { limits: request.limits } : {}),
        });
        if (refused.ok && refused.value.allowed) {
          because.push({ kind: 'refusal', message: refusal.because });
        }
      }
    }
    return {
      ok: true,
      value: {
        allowed: result.value.allowed,
        decision: result.value.allowed ? 'allow' : 'refuse',
        because,
        metrics: result.value.metrics,
        trace: translateTrace(compiled, result.value.trace),
      },
    };
  } catch (error) {
    return { ok: false, error: toAuthorizationErrorRecord(error) };
  }
}

export function prepareBxlAuthorizationSafe(
  document: BxlAuthorizationDocument,
  snapshot: BxlAuthorizationSnapshot,
): AuthorizationSafeResult<PreparedBxlAuthorization> {
  try {
    const compiled = compileBxlAuthorization(document, snapshot);
    return {
      ok: true,
      value: {
        checkCapability(request) {
          return checkCapabilityCompiled(compiled, request);
        },
        checkCapabilities(requests) {
          return requests.map((request) => checkCapabilityCompiled(compiled, request));
        },
        listResources(request) {
          try {
            const result: string[] = [];
            const total = metrics();
            const candidates = [...compiled.resourcesByRef.values()].filter(
              (resource) => !request.type || resource.type === request.type,
            );
            const maxCandidates = enumerationLimit(
              request.limits?.maxCandidates,
              100_000,
              'maxCandidates',
            );
            const maxResults = enumerationLimit(
              request.limits?.maxResults,
              100_000,
              'maxResults',
            );
            if (candidates.length > maxCandidates) {
              throw new AuthorizationError(
                'evaluation-limit-exceeded',
                `BXL authorization enumeration exceeded maximum candidates ${maxCandidates}.`,
              );
            }
            for (const resource of candidates) {
              const decision = checkCapabilityCompiled(compiled, {
                party: request.party,
                capability: request.capability,
                resource: resource.resource,
                input: request.input,
                now: request.now,
                limits: request.limits,
              });
              if (!decision.ok) {
                if (decision.error.kind === 'unknown-relation') continue;
                return decision;
              }
              addMetrics(total, decision.value.metrics);
              if (decision.value.allowed) result.push(resource.resource);
              if (result.length > maxResults) {
                throw new AuthorizationError(
                  'evaluation-limit-exceeded',
                  `BXL authorization enumeration exceeded maximum results ${maxResults}.`,
                );
              }
            }
            return { ok: true, value: { resources: result.sort(), metrics: total } };
          } catch (error) {
            return { ok: false, error: toAuthorizationErrorRecord(error) };
          }
        },
        listParties(request) {
          try {
            const result: string[] = [];
            const total = metrics();
            const candidates = [...compiled.partiesByRef.keys()];
            const maxCandidates = enumerationLimit(
              request.limits?.maxCandidates,
              100_000,
              'maxCandidates',
            );
            const maxResults = enumerationLimit(
              request.limits?.maxResults,
              100_000,
              'maxResults',
            );
            if (candidates.length > maxCandidates) {
              throw new AuthorizationError(
                'evaluation-limit-exceeded',
                `BXL authorization enumeration exceeded maximum candidates ${maxCandidates}.`,
              );
            }
            for (const party of candidates) {
              const decision = checkCapabilityCompiled(compiled, {
                party,
                capability: request.capability,
                resource: request.resource,
                input: request.input,
                now: request.now,
                limits: request.limits,
              });
              if (!decision.ok) return decision;
              addMetrics(total, decision.value.metrics);
              if (decision.value.allowed) result.push(party);
              if (result.length > maxResults) {
                throw new AuthorizationError(
                  'evaluation-limit-exceeded',
                  `BXL authorization enumeration exceeded maximum results ${maxResults}.`,
                );
              }
            }
            return { ok: true, value: { parties: result.sort(), metrics: total } };
          } catch (error) {
            return { ok: false, error: toAuthorizationErrorRecord(error) };
          }
        },
        listCapabilities(request) {
          try {
            const resource = compiled.resourcesByRef.get(request.resource);
            if (!resource) {
              throw new AuthorizationError(
                'invalid-identifier',
                `Unknown authorization resource ${request.resource}.`,
                { path: 'request.resource' },
              );
            }
            const scope = compiled.scopesByType.get(
              handle(resource.type, `resources.${resource.resource}.type`),
            )!;
            const candidates = [...scope.definition.capabilities];
            const maxCandidates = enumerationLimit(
              request.limits?.maxCandidates,
              100_000,
              'maxCandidates',
            );
            const maxResults = enumerationLimit(
              request.limits?.maxResults,
              100_000,
              'maxResults',
            );
            if (candidates.length > maxCandidates) {
              throw new AuthorizationError(
                'evaluation-limit-exceeded',
                `BXL authorization enumeration exceeded maximum candidates ${maxCandidates}.`,
              );
            }

            const result: string[] = [];
            const total = metrics();
            for (const capability of candidates) {
              const decision = checkCapabilityCompiled(compiled, {
                party: request.party,
                capability: capability.name,
                resource: request.resource,
                input: request.input,
                now: request.now,
                limits: request.limits,
              });
              if (!decision.ok) return decision;
              addMetrics(total, decision.value.metrics);
              if (decision.value.allowed) result.push(capability.name);
              if (result.length > maxResults) {
                throw new AuthorizationError(
                  'evaluation-limit-exceeded',
                  `BXL authorization enumeration exceeded maximum results ${maxResults}.`,
                );
              }
            }
            return {
              ok: true,
              value: { capabilities: result.sort(), metrics: total },
            };
          } catch (error) {
            return { ok: false, error: toAuthorizationErrorRecord(error) };
          }
        },
      },
    };
  } catch (error) {
    return { ok: false, error: toAuthorizationErrorRecord(error) };
  }
}
