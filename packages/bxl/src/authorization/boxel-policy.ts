import { parseBxlAst } from '../bxl/ast/index.js';
import { parseNativeJq } from '../bxl/bridge/native.js';
import type { ExpressionAst } from '../jqtools/parser/AST.js';
import { AuthorizationError, toAuthorizationErrorRecord, type AuthorizationSafeResult } from './errors.js';
import type { AuthorizationRuntimeLimits, AuthorizationTraceEvent } from './resolver.js';
import { prepareAuthorizationModelSafe, type PreparedAuthorizationModel } from './index.js';
import type {
  BxlAuthorizationModel,
  RelationshipTuple,
} from './model.js';

export const BOXEL_POLICY_SCHEMA = 'boxel-policy/2' as const;

export interface BoxelPolicyLinkDefinition {
  /** Stable UpperCamelCase handle used as `Card.Handle`. */
  name: string;
  /** `adoptsFrom` URL of the linked card type. */
  to: string;
  displayName?: string;
}

export interface BoxelPolicySeatDefinition {
  /** Stable UpperCamelCase handle used as `Seat.Handle`. */
  name: string;
  displayName?: string;
  /** Optional Boxel relationship source such as `Card.Operator`. */
  from?: string;
}

export interface BoxelPolicyRefusal {
  when: string;
  because: string;
}

export interface BoxelPolicyCapabilityDefinition {
  /** Stable UpperCamelCase handle used as `Capability.Handle`. */
  name: string;
  displayName?: string;
  /** Positive BXL eligibility expression. */
  where: string;
  /** Explicit deny clauses, evaluated after `where`. */
  refuse?: string | readonly BoxelPolicyRefusal[];
}

export interface BoxelPolicyScopeDefinition {
  /** Stable UpperCamelCase handle for diagnostics and tooling. */
  name: string;
  /** Canonical CardDef URL. This replaces an authorization `type`. */
  adoptsFrom: string;
  links?: readonly BoxelPolicyLinkDefinition[];
  seats?: readonly BoxelPolicySeatDefinition[];
  capabilities: readonly BoxelPolicyCapabilityDefinition[];
}

export interface BoxelPolicyDocument {
  schema: typeof BOXEL_POLICY_SCHEMA;
  /** Optional URL of the Policy card that owns this definition. */
  card?: string;
  scopes: readonly BoxelPolicyScopeDefinition[];
}

export interface BoxelPolicyCardSnapshot {
  /** Canonical or realm-relative card URL. */
  card: string;
  /** Canonical CardDef URL. */
  adoptsFrom: string;
  /** Ordinary card values made available as `Card`. */
  data?: Readonly<Record<string, unknown>>;
  /** Loaded Boxel relationships, keyed by camelCase field name. */
  links?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface BoxelPolicyPartySnapshot {
  /** Canonical or realm-relative Party card URL. */
  party: string;
  data?: Readonly<Record<string, unknown>>;
  /** Nested Party membership. A team seated in a policy seats its members. */
  members?: readonly string[];
}

export interface BoxelPolicyCardDataSnapshot {
  card: string;
  data?: Readonly<Record<string, unknown>>;
  links?: Readonly<Record<string, string | readonly string[] | undefined>>;
}

export interface BoxelPolicySeatAssignment {
  scope: string;
  seat: string;
  holders: readonly string[];
}

export interface BoxelPolicySnapshot {
  policy?: BoxelPolicyCardDataSnapshot;
  cards: readonly BoxelPolicyCardSnapshot[];
  parties: readonly BoxelPolicyPartySnapshot[];
  seats?: readonly BoxelPolicySeatAssignment[];
  /** Realm members available through `Party.Member`. */
  members?: readonly string[];
  /** Non-members admitted by the policy, available through `Party.Guest`. */
  guests?: readonly string[];
}

export interface BoxelAuthorizeRequest {
  party: string;
  capability: string;
  card: string;
  input?: Readonly<Record<string, unknown>>;
  /** The host supplies time explicitly; the policy runtime never reads a clock. */
  now?: unknown;
  trace?: boolean;
  limits?: AuthorizationRuntimeLimits;
}

export interface BoxelPolicyTraceEvent {
  depth: number;
  operation: string;
  party: string;
  capability: string;
  card: string;
  outcome: 'allow' | 'deny' | 'error';
  detail?: string;
}

export interface BoxelAuthorizationReason {
  kind: 'capability' | 'refusal';
  message: string;
}

export interface BoxelAuthorizeResult {
  allowed: boolean;
  decision: 'allow' | 'refuse';
  because: readonly BoxelAuthorizationReason[];
  metrics: { steps: number; tupleReads: number; maxDepth: number };
  trace: readonly BoxelPolicyTraceEvent[];
}

interface BoxelEnumerationRequest {
  input?: Readonly<Record<string, unknown>>;
  now?: unknown;
  limits?: AuthorizationRuntimeLimits;
}

export interface BoxelListCardsRequest extends BoxelEnumerationRequest {
  party: string;
  capability: string;
  adoptsFrom?: string;
}

export interface BoxelListCardsResult {
  cards: readonly string[];
  metrics: { steps: number; tupleReads: number; maxDepth: number };
}

export interface BoxelListPartiesRequest extends BoxelEnumerationRequest {
  card: string;
  capability: string;
}

export interface BoxelListPartiesResult {
  parties: readonly string[];
  metrics: { steps: number; tupleReads: number; maxDepth: number };
}

export interface BoxelListCapabilitiesRequest extends BoxelEnumerationRequest {
  party: string;
  card: string;
}

export interface BoxelListCapabilitiesResult {
  capabilities: readonly string[];
  metrics: { steps: number; tupleReads: number; maxDepth: number };
}

export interface PreparedBoxelPolicy {
  authorize(request: BoxelAuthorizeRequest): AuthorizationSafeResult<BoxelAuthorizeResult>;
  authorizeMany(
    requests: readonly BoxelAuthorizeRequest[],
  ): readonly AuthorizationSafeResult<BoxelAuthorizeResult>[];
  listCards(request: BoxelListCardsRequest): AuthorizationSafeResult<BoxelListCardsResult>;
  listParties(request: BoxelListPartiesRequest): AuthorizationSafeResult<BoxelListPartiesResult>;
  listCapabilities(
    request: BoxelListCapabilitiesRequest,
  ): AuthorizationSafeResult<BoxelListCapabilitiesResult>;
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
    throw new AuthorizationError('invalid-identifier', 'Card references cannot be empty.');
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
  definition: BoxelPolicyScopeDefinition;
  internalType: string;
  links: Map<string, BoxelPolicyLinkDefinition>;
  seats: Map<string, BoxelPolicySeatDefinition>;
  capabilities: Map<string, BoxelPolicyCapabilityDefinition>;
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
    program = parseBxlAst(source, { profile: 'authorization' });
  } catch (cause) {
    throw new AuthorizationError('invalid-expression', 'Could not parse Boxel policy expression.', {
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
    throw new AuthorizationError('invalid-expression', 'Boxel policy expression is empty.', {
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
          'via() requires two BXL arguments separated by `;`: a Card link and a Capability.',
          { path },
        );
      }
      const linkPath = pathOf(node.args[0]!);
      const capabilityPath = pathOf(node.args[1]!);
      if (linkPath?.length !== 2 || linkPath[0] !== 'card') {
        throw new AuthorizationError(
          'invalid-expression',
          'The first via() argument must be a declared Card link such as Card.Parent.',
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
        throw new AuthorizationError('unknown-relation', `Unknown Card link Card.${linkPath[1]}.`, {
          path,
        });
      }
      const target = [...scopesByName.values()].find(
        (candidate) => candidate.definition.adoptsFrom === link.to,
      );
      if (!target?.capabilities.has(capabilityPath[1]!)) {
        throw new AuthorizationError(
          'unknown-relation',
          `Card.${linkPath[1]} does not lead to a scope with Capability.${capabilityPath[1]}.`,
          { path },
        );
      }
      return false;
    }
    return true;
  });

  let translated = program.canonicalSource;
  translated = translated.replace(
    /via\(\.card\.([A-Za-z_][A-Za-z0-9_]*);\s*\.capability\.([A-Za-z_][A-Za-z0-9_]*)\)/g,
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
  capability: BoxelPolicyCapabilityDefinition,
): readonly BoxelPolicyRefusal[] {
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
      `Boxel policy runtime limit ${name} must be a positive safe integer.`,
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

interface CompiledNativePolicy {
  runtime: PreparedAuthorizationModel;
  scopesByAdoptsFrom: Map<string, ScopeCompilation>;
  cardsByRef: Map<string, BoxelPolicyCardSnapshot>;
  partiesByRef: Map<string, BoxelPolicyPartySnapshot>;
  objectToCard: Map<string, string>;
  relationLabels: Map<string, string>;
  refusalRelations: Map<string, readonly { relation: string; because: string }[]>;
  contextBase: Readonly<Record<string, unknown>>;
}

function sourceField(source: string, path: string): { root: 'card' | 'policy'; field: string } {
  const match = /^(Card|Policy)\.([A-Z][A-Za-z0-9]*)$/.exec(source);
  if (!match) {
    throw new AuthorizationError(
      'invalid-expression',
      `${path} must be a direct Boxel relationship path such as Card.Operator or Policy.Owners.`,
      { path },
    );
  }
  return {
    root: match[1]!.toLowerCase() as 'card' | 'policy',
    field: handle(match[2]!, path),
  };
}

function asLinks(value: string | readonly string[] | undefined): readonly string[] {
  if (value === undefined) return [];
  return typeof value === 'string' ? [value] : value;
}

function compileNativePolicy(
  document: BoxelPolicyDocument,
  snapshot: BoxelPolicySnapshot,
): CompiledNativePolicy {
  if (!document || document.schema !== BOXEL_POLICY_SCHEMA) {
    throw new AuthorizationError(
      'invalid-model',
      `Boxel policy schema must be ${BOXEL_POLICY_SCHEMA}.`,
      { path: 'schema' },
    );
  }
  if (!Array.isArray(document.scopes) || document.scopes.length === 0) {
    throw new AuthorizationError('invalid-model', 'A Boxel policy must declare at least one scope.', {
      path: 'scopes',
    });
  }

  const scopesByName = new Map<string, ScopeCompilation>();
  const scopesByAdoptsFrom = new Map<string, ScopeCompilation>();
  for (let index = 0; index < document.scopes.length; index++) {
    const definition = document.scopes[index]!;
    const name = handle(definition.name, `scopes[${index}].name`);
    if (scopesByName.has(name) || scopesByAdoptsFrom.has(definition.adoptsFrom)) {
      throw new AuthorizationError('invalid-model', `Duplicate policy scope ${definition.name}.`, {
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
    for (const key of compilation.links.keys()) {
      if (compilation.seats.has(key) || compilation.capabilities.has(key)) {
        throw new AuthorizationError('invalid-model', `Policy handle ${key} is ambiguous.`, {
          path: `scopes[${index}]`,
        });
      }
    }
    for (const key of compilation.seats.keys()) {
      if (compilation.capabilities.has(key)) {
        throw new AuthorizationError('invalid-model', `Policy handle ${key} is ambiguous.`, {
          path: `scopes[${index}]`,
        });
      }
    }
    scopesByName.set(name, compilation);
    scopesByAdoptsFrom.set(definition.adoptsFrom, compilation);
  }

  const types: Record<string, import('./model.js').BxlAuthorizationType> = {
    party: {
      relations: {
        member: { subjects: ['party', 'party#member'], rewrite: 'direct()' },
      },
    },
  };
  const relationLabels = new Map<string, string>();
  const refusalRelations = new Map<string, readonly { relation: string; because: string }[]>();

  for (const scope of scopesByName.values()) {
    const relations: Record<string, import('./model.js').BxlAuthorizationRelationDefinition> = {
      __party_anyone: ['party:*'],
      __party_member: ['party', 'party#member'],
      __party_guest: ['party', 'party#member'],
    };
    const permissions: Record<string, string> = {};
    for (const [name, link] of scope.links) {
      const target = scopesByAdoptsFrom.get(link.to);
      if (!target) {
        throw new AuthorizationError(
          'unknown-type',
          `Card link ${scope.definition.name}.${link.name} targets undeclared CardDef ${link.to}.`,
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

  const model: BxlAuthorizationModel = {
    schema: 'bxl-authorization/1',
    types,
  };
  const cardsByRef = new Map<string, BoxelPolicyCardSnapshot>();
  const objectToCard = new Map<string, string>();
  for (const card of snapshot.cards) {
    if (cardsByRef.has(card.card)) {
      throw new AuthorizationError('invalid-model', `Duplicate card snapshot ${card.card}.`);
    }
    const scope = scopesByAdoptsFrom.get(card.adoptsFrom);
    if (!scope) {
      throw new AuthorizationError(
        'unknown-type',
        `Card ${card.card} adopts undeclared CardDef ${card.adoptsFrom}.`,
      );
    }
    cardsByRef.set(card.card, card);
    objectToCard.set(internalObject(scope.internalType, card.card), card.card);
  }

  const partiesByRef = new Map<string, BoxelPolicyPartySnapshot>();
  const ensureParty = (party: string): BoxelPolicyPartySnapshot => {
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

  for (const card of snapshot.cards) {
    const scope = scopesByAdoptsFrom.get(card.adoptsFrom)!;
    const object = internalObject(scope.internalType, card.card);
    tuples.push({ subject: 'party:*', relation: '__party_anyone', object });
    for (const party of snapshot.members ?? []) {
      tuples.push({ subject: partySubject(party), relation: '__party_member', object });
    }
    for (const party of snapshot.guests ?? []) {
      tuples.push({ subject: partySubject(party), relation: '__party_guest', object });
    }
    for (const [name, link] of scope.links) {
      for (const targetRef of asLinks(card.links?.[name])) {
        const targetCard = cardsByRef.get(targetRef);
        const targetScope = targetCard && scopesByAdoptsFrom.get(targetCard.adoptsFrom);
        if (!targetCard || !targetScope || targetCard.adoptsFrom !== link.to) {
          throw new AuthorizationError(
            'invalid-model',
            `Card.${link.name} on ${card.card} points to ${targetRef}, which is absent or has the wrong CardDef.`,
          );
        }
        tuples.push({
          subject: internalObject(targetScope.internalType, targetRef),
          relation: name,
          object,
        });
      }
    }
    for (const [name, seat] of scope.seats) {
      if (!seat.from) continue;
      const source = sourceField(
        seat.from,
        `scopes.${scope.definition.name}.seats.${seat.name}.from`,
      );
      const links = source.root === 'card' ? card.links : snapshot.policy?.links;
      for (const holder of asLinks(links?.[source.field])) {
        tuples.push({ subject: partySubject(holder), relation: name, object });
      }
    }
  }

  for (const assignment of snapshot.seats ?? []) {
    const card = cardsByRef.get(assignment.scope);
    if (!card) {
      throw new AuthorizationError('invalid-identifier', `Unknown seat scope ${assignment.scope}.`);
    }
    const scope = scopesByAdoptsFrom.get(card.adoptsFrom)!;
    const name = handle(assignment.seat, 'seats[].seat');
    if (!scope.seats.has(name)) {
      throw new AuthorizationError(
        'unknown-relation',
        `Scope ${assignment.scope} does not declare Seat.${assignment.seat}.`,
      );
    }
    for (const holder of assignment.holders) {
      tuples.push({
        subject: partySubject(holder),
        relation: name,
        object: internalObject(scope.internalType, assignment.scope),
      });
    }
  }

  const prepared = prepareAuthorizationModelSafe(model, tuples);
  if (!prepared.ok) {
    throw new AuthorizationError(prepared.error.kind, prepared.error.message, {
      path: prepared.error.path,
    });
  }

  const cards: Record<string, unknown> = {};
  for (const card of snapshot.cards) {
    const scope = scopesByAdoptsFrom.get(card.adoptsFrom)!;
    cards[internalObject(scope.internalType, card.card)] = {
      id: card.card,
      adoptsFrom: card.adoptsFrom,
      ...(card.data ?? {}),
      ...(card.links ?? {}),
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
    __boxelPolicy: {
      cards,
      parties,
      policy: {
        id: snapshot.policy?.card ?? document.card,
        ...(snapshot.policy?.data ?? {}),
        ...(snapshot.policy?.links ?? {}),
      },
    },
  };

  return {
    runtime: prepared.value,
    scopesByAdoptsFrom,
    cardsByRef,
    partiesByRef,
    objectToCard,
    relationLabels,
    refusalRelations,
    contextBase,
  };
}

function requestContext(
  compiled: CompiledNativePolicy,
  request: BoxelEnumerationRequest,
): Readonly<Record<string, unknown>> {
  return {
    ...compiled.contextBase,
    input: request.input ?? {},
    ...(request.now === undefined ? {} : { now: request.now }),
  };
}

function resolveRequest(
  compiled: CompiledNativePolicy,
  request: { party: string; capability: string; card: string },
): { subject: string; relation: string; object: string; scope: ScopeCompilation } {
  const card = compiled.cardsByRef.get(request.card);
  if (!card) {
    throw new AuthorizationError('invalid-identifier', `Unknown policy card ${request.card}.`, {
      path: 'request.card',
    });
  }
  const scope = compiled.scopesByAdoptsFrom.get(card.adoptsFrom)!;
  const relation = handle(request.capability, 'request.capability');
  if (!scope.capabilities.has(relation)) {
    throw new AuthorizationError(
      'unknown-relation',
      `${request.card} does not declare Capability.${request.capability}.`,
      { path: 'request.capability' },
    );
  }
  return {
    subject: internalParty(request.party),
    relation,
    object: internalObject(scope.internalType, request.card),
    scope,
  };
}

function decodeParty(value: string): string {
  const hash = value.lastIndexOf('#');
  const entity = hash === -1 ? value : value.slice(0, hash);
  const separator = entity.indexOf(':');
  return separator === -1 ? value : decodeURIComponent(entity.slice(separator + 1));
}

function decodeTraceCard(
  compiled: CompiledNativePolicy,
  value: string,
): string {
  const card = compiled.objectToCard.get(value);
  if (card) {
    return card;
  }
  return value.startsWith('party:')
    ? decodeURIComponent(value.slice('party:'.length))
    : value;
}

function translateTrace(
  compiled: CompiledNativePolicy,
  trace: readonly AuthorizationTraceEvent[],
): BoxelPolicyTraceEvent[] {
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
      card: decodeTraceCard(compiled, event.object),
      outcome: event.outcome,
      ...(event.detail ? { detail: event.detail } : {}),
    };
  });
}

function authorizeCompiled(
  compiled: CompiledNativePolicy,
  request: BoxelAuthorizeRequest,
): AuthorizationSafeResult<BoxelAuthorizeResult> {
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
    const because: BoxelAuthorizationReason[] = [];
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

export function prepareBoxelPolicySafe(
  document: BoxelPolicyDocument,
  snapshot: BoxelPolicySnapshot,
): AuthorizationSafeResult<PreparedBoxelPolicy> {
  try {
    const compiled = compileNativePolicy(document, snapshot);
    return {
      ok: true,
      value: {
        authorize(request) {
          return authorizeCompiled(compiled, request);
        },
        authorizeMany(requests) {
          return requests.map((request) => authorizeCompiled(compiled, request));
        },
        listCards(request) {
          try {
            const result: string[] = [];
            const total = metrics();
            const candidates = [...compiled.cardsByRef.values()].filter(
              (card) => !request.adoptsFrom || card.adoptsFrom === request.adoptsFrom,
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
                `Boxel policy enumeration exceeded maximum candidates ${maxCandidates}.`,
              );
            }
            for (const card of candidates) {
              const decision = authorizeCompiled(compiled, {
                party: request.party,
                capability: request.capability,
                card: card.card,
                input: request.input,
                now: request.now,
                limits: request.limits,
              });
              if (!decision.ok) {
                if (decision.error.kind === 'unknown-relation') continue;
                return decision;
              }
              addMetrics(total, decision.value.metrics);
              if (decision.value.allowed) result.push(card.card);
              if (result.length > maxResults) {
                throw new AuthorizationError(
                  'evaluation-limit-exceeded',
                  `Boxel policy enumeration exceeded maximum results ${maxResults}.`,
                );
              }
            }
            return { ok: true, value: { cards: result.sort(), metrics: total } };
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
                `Boxel policy enumeration exceeded maximum candidates ${maxCandidates}.`,
              );
            }
            for (const party of candidates) {
              const decision = authorizeCompiled(compiled, {
                party,
                capability: request.capability,
                card: request.card,
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
                  `Boxel policy enumeration exceeded maximum results ${maxResults}.`,
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
            const card = compiled.cardsByRef.get(request.card);
            if (!card) {
              throw new AuthorizationError(
                'invalid-identifier',
                `Unknown policy card ${request.card}.`,
                { path: 'request.card' },
              );
            }
            const scope = compiled.scopesByAdoptsFrom.get(card.adoptsFrom)!;
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
                `Boxel policy enumeration exceeded maximum candidates ${maxCandidates}.`,
              );
            }

            const result: string[] = [];
            const total = metrics();
            for (const capability of candidates) {
              const decision = authorizeCompiled(compiled, {
                party: request.party,
                capability: capability.name,
                card: request.card,
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
                  `Boxel policy enumeration exceeded maximum results ${maxResults}.`,
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
