import type { ResolvedCodeRef } from '../code-ref.ts';
import { FILEDEF_CODE_REF_BY_EXTENSION } from '../file-def-code-ref.ts';
import type { BaseOperation } from './types.ts';
import type { CompiledOperationGrant, CompiledPolicyRule } from './policy.ts';

// ============================================================================
// Whether the callers a grant lets read a card can load the code that renders
// it.
//
// A card is rendered by the module that defines its type, and by the modules
// of the types it descends from. A caller who reaches a realm only through its
// policy loads each of those modules as a `readSource` of the module file,
// which a grant reaches only through a rule on a code type: `TsFileDef`, which
// covers every module, or `GtsFileDef`, which covers the ones with templates.
// A rule on `FileDef` does not reach code (see `isModuleSource`). So a policy
// that grants `read` or `query` on a type the governed realm defines, and no
// `readSource` on code, hands its callers cards that fail to render, and
// nothing about the grant says so.
//
// A grant never implies another: a grant admits only the operation it names
// (ADR 024 §1.4). So this check records a warning on each such grant, naming
// the modules and the grant to add, and the grant stays live.
//
// It runs where the policy compiles, over what compiling already reads. Types
// a realm doesn't define are served by the realm that does, under that realm's
// permissions, so only modules in the governed realm count. A rule on a type
// another realm defines, `CardDef` say, reaches the governed realm's code
// through the cards it holds of types under that one, so those are read too,
// and only for a policy no code grant covers. They are read only where the
// realm's summary of its cards holds a type the realm defines. A realm that
// holds none yet has its first such card noticed when the policy next
// compiles, which a `validate` always does.
//
// It is a diagnostic, and it reads no code grant's `where`: any live
// `readSource` grant on a code type counts as covering the realm's modules. Nor
// can it tell a module's extension from its identifier, so a `GtsFileDef` grant
// counts as covering a `.ts` module too. A caller a `where` leaves out, or a
// card defined in a `.ts` module, can still meet a module no grant reaches.
// ============================================================================

// The code types, which a rule must name for its `readSource` grant to reach
// module source.
const CODE_TYPES: ResolvedCodeRef[] = [
  FILEDEF_CODE_REF_BY_EXTENSION['.ts'],
  FILEDEF_CODE_REF_BY_EXTENSION['.gts'],
];

// A rule as compiled, with the adoption chain of its type and, for each of
// its grants, the base it admits through and whether it opens to callers who
// aren't signed in.
export interface ModuleAccessRule {
  rule: CompiledPolicyRule;
  // The keys of the rule's type and of every type it descends from, the
  // rule's own type first.
  types: string[];
  grants: {
    grant: CompiledOperationGrant;
    // The base the grant admits through, or undefined for one that admits
    // nothing.
    base: BaseOperation | undefined;
    opensToAnonymous: boolean;
  }[];
}

export interface ModuleAccessEnvironment {
  typeKey(codeRef: ResolvedCodeRef): string;
  // The types the governed realm holds cards of under `codeRef`, as the
  // first key of each card's adoption chain.
  heldTypesUnder(codeRef: ResolvedCodeRef): Promise<string[]>;
  // The module a type key names, where the governed realm defines it, as a
  // path in that realm. Undefined for a module the realm doesn't hold.
  localModule(key: string): string | undefined;
}

export interface ModuleAccessIssue {
  code: 'module-not-granted';
  path: string;
  message: string;
}

// How many modules a message names before it counts the rest.
const NAMED_MODULES = 3;

export async function moduleAccessIssues(
  rules: ModuleAccessRule[],
  env: ModuleAccessEnvironment,
): Promise<ModuleAccessIssue[]> {
  let codeKeys = new Set(CODE_TYPES.map((ref) => env.typeKey(ref)));
  let signedInCovered = false;
  let anonymousCovered = false;
  for (let { rule, types, grants } of rules) {
    let onCode =
      codeKeys.has(env.typeKey(rule.targetType)) ||
      (types[0] !== undefined && codeKeys.has(types[0]));
    if (!onCode) {
      continue;
    }
    for (let { base, opensToAnonymous } of grants) {
      if (base !== 'readSource') {
        continue;
      }
      signedInCovered = true;
      anonymousCovered ||= opensToAnonymous;
    }
  }
  if (signedInCovered && anonymousCovered) {
    return [];
  }

  let issues: ModuleAccessIssue[] = [];
  for (let { rule, types, grants } of rules) {
    let reading = grants.filter(
      ({ base, opensToAnonymous }) =>
        (base === 'read' || base === 'query') &&
        (!signedInCovered || (opensToAnonymous && !anonymousCovered)),
    );
    if (reading.length === 0) {
      continue;
    }
    let modules = await modulesOf(rule, types, env);
    if (modules.length === 0) {
      continue;
    }
    for (let { grant, base, opensToAnonymous } of reading) {
      issues.push({
        code: 'module-not-granted',
        path: grant.path,
        message: message(
          rule,
          base === 'query' ? 'find' : 'read',
          signedInCovered && opensToAnonymous ? 'anonymous' : 'any',
          modules,
        ),
      });
    }
  }
  return issues;
}

// The governed realm's modules the cards a rule admits are defined in: its
// type's and its ancestors', or, for a rule whose types the realm defines
// none of, those of the types the realm holds cards of under it.
async function modulesOf(
  rule: CompiledPolicyRule,
  types: string[],
  env: ModuleAccessEnvironment,
): Promise<string[]> {
  let own = localModules(types, env);
  if (own.length > 0) {
    return own;
  }
  return localModules(await env.heldTypesUnder(rule.targetType), env);
}

function localModules(keys: string[], env: ModuleAccessEnvironment): string[] {
  let modules = new Set<string>();
  for (let key of keys) {
    let local = env.localModule(key);
    if (local !== undefined) {
      modules.add(local);
    }
  }
  return [...modules];
}

function message(
  rule: CompiledPolicyRule,
  lets: 'read' | 'find',
  callers: 'any' | 'anonymous',
  modules: string[],
): string {
  let who =
    callers === 'anonymous' ? "callers who aren't signed in" : 'its callers';
  let named = modules
    .slice(0, NAMED_MODULES)
    .map((module) => `\`${module}\``)
    .join(', ');
  let rest =
    modules.length > NAMED_MODULES
      ? ` and ${modules.length - NAMED_MODULES} more`
      : '';
  let fix =
    callers === 'anonymous'
      ? `Open a \`readSource\` grant on \`TsFileDef\` (\`@cardstack/base/ts-file-def\`) to them too, by naming them in its \`where\` (\`actor() == "anonymous"\`).`
      : `Add a rule on \`TsFileDef\` (\`@cardstack/base/ts-file-def\`) that grants \`readSource\` to the same callers. A rule on \`FileDef\` doesn't reach code.`;
  return (
    `this grant lets ${who} ${lets} \`${rule.targetType.name}\` cards, and no grant in this policy lets them load the code those cards are defined in: ${named}${rest}. ` +
    `A caller who reaches the realm only through its policy can ${lets} such a card but can't render it.\n\n${fix}`
  );
}
