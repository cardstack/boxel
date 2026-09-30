import stableStringify from 'safe-stable-stringify';

import { isResolvedCodeRef } from '../card-document-shape.ts';
import type { ResolvedCodeRef } from '../code-ref.ts';
import type { Definition, FieldDefinition } from '../definitions.ts';
import { rri } from '../realm-identifiers.ts';
import type { CompiledOperationGrant, CompiledPolicyRule } from './policy.ts';
import type { PolicyIssueCode } from './types.ts';
import type { LinkStrategy } from '@cardstack/base/operations';

// ============================================================================
// What a grant hands over beyond the card it names.
//
// A grant on a row covers the row's whole returned representation. Under the
// `full` link strategy a card's document carries its link closure, and the
// results of its query-backed fields with it, so granting `read` on
// `Classroom` asserts that every card a classroom links to, and every card
// those link to, is safe for every caller the grant admits. An author cannot
// see that closure by reading the rule. Nothing fails when it reaches further
// than they meant, so nothing reports it either, and this check is what does.
//
// It runs where the policy compiles, over the definitions of the types the
// closure crosses, so it costs no index pass and reads no card. Each type it
// reads becomes an input of the compiled policy like every other definition
// the compile reads, so a link added to a type the closure crosses is found
// the next time the policy revalidates.
//
// It is a diagnostic, not a boundary. What it records is a warning and the
// grant stays live: plenty of realms reach across a link on purpose.
//
// Two lanes are walked, because a grant can hand over a card two ways.
//
// - The document. A `read` or `query` grant serves its rows' documents under
//   the link strategy its operation declares, and only `full` assembles
//   anything. A `read` grant's strategy is the granted type's own `read`
//   declaration, and a named query grant's is the query's. A linked type's
//   declaration is never consulted, because the closure never consults it. An
//   ad-hoc `query` has no declaration to narrow what it serves, so it is always
//   `full`. Under `full`, a card's query-backed fields are answered only for
//   the card the document is about: a side-loaded card's are left for its
//   consumer to ask about on its own.
// - The rendering. A search row carries its prerendered HTML, and a render
//   draws the card's links whatever strategy the document is served under,
//   and answers a query-backed field wherever a template reads one. So a
//   `query` grant is walked a second time over its whole closure. A `read`
//   serves a document and no rendering.
//
// A reached type counts as granted when a rule on it, or on a type it
// descends from, keeps a grant. Authorization infrastructure never counts as
// granted, even under a catch-all rule. A `CardDef` rule reaches a
// `RealmPolicy` by ancestry, yet the gate refuses every grant-reached caller
// every operation on one, and a policy card's attributes are its whole rule
// list. The realm config card is refused in the same way.
//
// The walk follows the types a definition declares. A link typed as a base
// class can hold a card of any subclass, which can link further still, and
// only the base class's own links can be seen from here.
// ============================================================================

// A grant whose rows this check walks from.
export interface ReachingGrant {
  rule: CompiledPolicyRule;
  grant: CompiledOperationGrant;
  // The definition of the rule's type, which is where the walk starts.
  definition: Definition;
  // Which operation's declaration governs the document the grant serves, for
  // naming the fix.
  governedBy: 'read' | 'named-query' | 'ad-hoc-query';
  // The strategy the grant's document is served under.
  links: LinkStrategy;
  // Whether the grant serves its rows' prerendered HTML.
  rendered: boolean;
}

export interface ReachEnvironment {
  // A type's definition entry, as `PolicyCompileEnvironment` states it, or
  // undefined for a type with no definition or one that could not be read.
  // A type the walk cannot read is left unwalked.
  readType(
    codeRef: ResolvedCodeRef,
  ): Promise<{ definition: Definition; types: string[] } | undefined>;
  typeKey(codeRef: ResolvedCodeRef): string;
  isPolicyCard(types: string[]): boolean;
}

export interface ReachIssue {
  code: Extract<
    PolicyIssueCode,
    'grant-reaches-ungranted-type' | 'render-reaches-ungranted-type'
  >;
  path: string;
  message: string;
}

// The type whose own fields every card has, and which the walk leaves out.
// They are on every card whatever type the rule names, so the grant's author
// did not add the reach, and a warning about it would be recorded on every
// grant in every policy. Today the one link among them is `cardInfo.theme`:
// how a card looks, which every render of it already draws.
const cardDefRef: ResolvedCodeRef = {
  module: rri('@cardstack/base/card-api'),
  name: 'CardDef',
};

const realmConfigRef: ResolvedCodeRef = {
  module: rri('@cardstack/base/realm-config'),
  name: 'RealmConfig',
};

// A type the walk reached, and the fields it was reached through, from the
// rule's type.
interface Reached {
  codeRef: ResolvedCodeRef;
  types: string[];
  via: string[];
}

export async function reachIssues(
  reaching: ReachingGrant[],
  rules: CompiledPolicyRule[],
  env: ReachEnvironment,
): Promise<ReachIssue[]> {
  if (reaching.length === 0) {
    return [];
  }
  let granted = new Set<string>();
  for (let rule of rules) {
    let key = rule.grants.length > 0 ? keyOf(rule.targetType, env) : undefined;
    if (key) {
      granted.add(key);
    }
  }
  let configKey = keyOf(realmConfigRef, env);
  let walker = new ClosureWalker(env);

  let issues: ReachIssue[] = [];
  for (let reach of reaching) {
    if (reach.links === 'full') {
      for (let reached of await walker.closure(reach, 'document')) {
        let kind = ungrantedKind(reached, granted, configKey, env);
        if (kind) {
          issues.push({
            code: 'grant-reaches-ungranted-type',
            path: reach.grant.path,
            message: documentMessage(reach, reached, kind),
          });
        }
      }
    }
    if (reach.rendered) {
      for (let reached of await walker.closure(reach, 'rendering')) {
        let kind = ungrantedKind(reached, granted, configKey, env);
        if (kind) {
          issues.push({
            code: 'render-reaches-ungranted-type',
            path: reach.grant.path,
            message: renderingMessage(reach, reached, kind),
          });
        }
      }
    }
  }
  return issues;
}

type UngrantedKind = 'ungranted' | 'policy card' | 'config card';

function ungrantedKind(
  reached: Reached,
  granted: Set<string>,
  configKey: string | undefined,
  env: ReachEnvironment,
): UngrantedKind | undefined {
  // A chain that cannot be judged counts as a policy type's, as it does where
  // the compile reads a rule's type.
  if (attempt(() => env.isPolicyCard(reached.types)) ?? true) {
    return 'policy card';
  }
  if (configKey && reached.types.includes(configKey)) {
    return 'config card';
  }
  return reached.types.some((key) => granted.has(key))
    ? undefined
    : 'ungranted';
}

class ClosureWalker {
  #env: ReachEnvironment;
  #everyCard: Promise<Set<string>> | undefined;
  #closures = new Map<string, Promise<Reached[]>>();

  constructor(env: ReachEnvironment) {
    this.#env = env;
  }

  // Every type the lane reaches from the rule's type, each once, through the
  // shortest run of fields that reaches it, nearest first.
  closure(
    reach: ReachingGrant,
    lane: 'document' | 'rendering',
  ): Promise<Reached[]> {
    let root = reach.rule.targetType;
    let key = `${lane} ${keyOf(root, this.#env) ?? `${root.module}#${root.name}`}`;
    let walked = this.#closures.get(key);
    if (!walked) {
      walked = this.#walk(root, reach.definition, lane);
      this.#closures.set(key, walked);
    }
    return walked;
  }

  async #walk(
    root: ResolvedCodeRef,
    definition: Definition,
    lane: 'document' | 'rendering',
  ): Promise<Reached[]> {
    let seen = new Set<string>();
    let rootKey = keyOf(root, this.#env);
    if (rootKey) {
      seen.add(rootKey);
    }
    let reached: Reached[] = [];
    let queue: { definition: Definition; via: string[]; isRoot: boolean }[] = [
      { definition, via: [], isRoot: true },
    ];
    while (queue.length > 0) {
      let current = queue.shift()!;
      let links = await this.#linksOf(current.definition, {
        queryFields: lane === 'rendering' || current.isRoot,
      });
      for (let link of links) {
        let key = keyOf(link.codeRef, this.#env);
        if (!key || seen.has(key)) {
          continue;
        }
        seen.add(key);
        let entry = await this.#env.readType(link.codeRef);
        if (!entry) {
          continue;
        }
        let via = [...current.via, ...link.via];
        reached.push({ codeRef: link.codeRef, types: entry.types, via });
        queue.push({ definition: entry.definition, via, isRoot: false });
      }
    }
    return reached;
  }

  // The links a type's own fields hold, and the links held inside the
  // compound fields it contains, each with the fields that lead to it.
  async #linksOf(
    definition: Definition,
    opts: { queryFields: boolean },
    prefix: string[] = [],
    containing: Set<string> = new Set(),
  ): Promise<{ codeRef: ResolvedCodeRef; via: string[] }[]> {
    let everyCard =
      prefix.length === 0 && definition.type === 'card-def'
        ? await this.#everyCardFields()
        : undefined;
    let links: { codeRef: ResolvedCodeRef; via: string[] }[] = [];
    for (let [name, id] of Object.entries(definition.fields)) {
      let field = definition.fieldDefs[id];
      if (!field || !isResolvedCodeRef(field.fieldOrCard)) {
        continue;
      }
      if (everyCard?.has(fieldSignature(name, field))) {
        continue;
      }
      let via = [...prefix, name];
      if (field.type === 'linksTo' || field.type === 'linksToMany') {
        if (field.query && !opts.queryFields) {
          continue;
        }
        links.push({ codeRef: field.fieldOrCard, via });
        continue;
      }
      if (field.isPrimitive) {
        continue;
      }
      // A compound field's links are the containing card's links, and are
      // assembled with it. A field that contains itself, however indirectly,
      // is walked once.
      let key = keyOf(field.fieldOrCard, this.#env);
      if (!key || containing.has(key)) {
        continue;
      }
      let entry = await this.#env.readType(field.fieldOrCard);
      if (!entry) {
        continue;
      }
      links.push(
        ...(await this.#linksOf(
          entry.definition,
          opts,
          via,
          new Set([...containing, key]),
        )),
      );
    }
    return links;
  }

  #everyCardFields(): Promise<Set<string>> {
    this.#everyCard ??= this.#env.readType(cardDefRef).then((entry) => {
      let fields = new Set<string>();
      for (let [name, id] of Object.entries(entry?.definition.fields ?? {})) {
        let field = entry?.definition.fieldDefs[id];
        if (field) {
          fields.add(fieldSignature(name, field));
        }
      }
      return fields;
    });
    return this.#everyCard;
  }
}

// A field as a type declares it, so a subtype that redeclares one of
// `CardDef`'s own fields as something else is walked like any other field.
function fieldSignature(name: string, field: FieldDefinition): string {
  return `${name} ${stableStringify(field)}`;
}

function documentMessage(
  reach: ReachingGrant,
  reached: Reached,
  kind: UngrantedKind,
): string {
  let { operation } = reach.grant;
  let from = reach.rule.targetType.name;
  let to = reached.codeRef.name;
  let fix = narrowingFix(reach);
  let serves =
    reach.governedBy === 'read'
      ? `\`${operation}\` on ${from} serves the card with its links assembled`
      : `\`${operation}\` on ${from} serves its rows with their links assembled`;
  return `${serves}, so it hands every caller it admits the ${to} cards linked through \`${reached.via.join('.')}\`, and ${ungrantedClause(to, kind)}. ${
    kind === 'ungranted'
      ? `To keep them out, ${fix}; to hand them over deliberately, grant ${to} in a rule of its own.`
      : `To keep them out, ${fix}.`
  } A declaration on ${to} does not narrow this: a closure never consults a linked type's declaration`;
}

function renderingMessage(
  reach: ReachingGrant,
  reached: Reached,
  kind: UngrantedKind,
): string {
  let { operation } = reach.grant;
  let from = reach.rule.targetType.name;
  let to = reached.codeRef.name;
  return `the prerendered HTML of the ${from} rows \`${operation}\` serves can draw the ${to} cards linked through \`${reached.via.join('.')}\`, and ${ungrantedClause(to, kind)}. A render draws a card's links whatever strategy its document is served under, so narrowing \`links\` does not keep them out of the HTML. ${
    kind === 'ungranted'
      ? `To keep them out, keep ${from}'s templates from embedding them; to hand them over deliberately, grant ${to} in a rule of its own`
      : `To keep them out, keep ${from}'s templates from embedding them`
  }`;
}

function ungrantedClause(to: string, kind: UngrantedKind): string {
  switch (kind) {
    case 'ungranted':
      return `no rule grants ${to}`;
    case 'policy card':
      return `${to} is a policy card type: a policy card's attributes are its whole rule list, and no rule grants one`;
    case 'config card':
      return `${to} is the realm config card type, and no rule grants a realm's config card`;
  }
}

function narrowingFix(reach: ReachingGrant): string {
  let from = reach.rule.targetType.name;
  let { operation } = reach.grant;
  switch (reach.governedBy) {
    case 'read':
      return `declare \`links: 'ids'\` on ${from}'s \`${operation}\``;
    case 'named-query':
      return `declare \`links: 'ids'\` on the \`${operation}\` query`;
    case 'ad-hoc-query':
      return `grant a named query that declares \`links: 'ids'\` in place of the ad-hoc \`query\`, which no declaration narrows`;
  }
}

function keyOf(
  codeRef: ResolvedCodeRef,
  env: ReachEnvironment,
): string | undefined {
  return attempt(() => env.typeKey(codeRef));
}

function attempt<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
