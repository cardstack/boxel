import type { ResolvedCodeRef } from '../code-ref.ts';
import { FILEDEF_CODE_REF_BY_EXTENSION } from '../file-def-code-ref.ts';
import { hasExecutableExtension } from '../index.ts';
import { pathSpecifierMatches } from '../path-specifier.ts';
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
// realm's summary of its cards holds a type the realm defines. A policy
// compiled while the realm holds none is compiled again once it holds one, so
// the warning arrives with the realm's first such card.
//
// It is a diagnostic, and it doesn't evaluate a code grant's `where`: a live
// `readSource` grant on a code type counts as covering the realm's modules
// under its paths for every kind of caller it can admit. One whose `where` can never hold for a
// signed-in caller, as `actor() == "anonymous"` can't, covers only callers who
// aren't signed in, and one that doesn't name them covers only signed-in
// callers. Nor can it tell a module's extension from its identifier, so a
// `GtsFileDef` grant counts as covering a `.ts` module too. A caller a `where`
// leaves out, or a card defined in a `.ts` module, can still meet a module no
// grant reaches.
// ============================================================================

// The code types, which a rule must name for its `readSource` grant to reach
// module source.
const CODE_TYPES: ResolvedCodeRef[] = [
  FILEDEF_CODE_REF_BY_EXTENSION['.ts'],
  FILEDEF_CODE_REF_BY_EXTENSION['.gts'],
];

// A rule as compiled, with the adoption chain of its type and, for each of
// its grants, the base it admits through and which kinds of caller it can
// admit.
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
    // False for a grant whose `where` can never hold for a signed-in caller.
    opensToSignedIn: boolean;
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
  let codeGrants: ModuleAccessRule['grants'] = [];
  for (let { rule, types, grants } of rules) {
    let onCode =
      codeKeys.has(env.typeKey(rule.targetType)) ||
      (types[0] !== undefined && codeKeys.has(types[0]));
    if (onCode) {
      codeGrants.push(...grants.filter(({ base }) => base === 'readSource'));
    }
  }
  // Whether some code grant covers a module for a kind of caller.
  let covers = (module: string, kind: 'signedIn' | 'anonymous') =>
    codeGrants.some(
      (entry) =>
        (kind === 'signedIn'
          ? entry.opensToSignedIn
          : entry.opensToAnonymous) && underPaths(entry.grant, module),
    );
  let everywhere = (kind: 'signedIn' | 'anonymous') =>
    codeGrants.some(
      (entry) =>
        !entry.grant.paths &&
        (kind === 'signedIn' ? entry.opensToSignedIn : entry.opensToAnonymous),
    );
  if (everywhere('signedIn') && everywhere('anonymous')) {
    return [];
  }

  let issues: ModuleAccessIssue[] = [];
  for (let { rule, types, grants } of rules) {
    let reading = grants.filter(
      ({ base, opensToSignedIn, opensToAnonymous }) =>
        (base === 'read' || base === 'query') &&
        (opensToSignedIn || opensToAnonymous),
    );
    if (reading.length === 0) {
      continue;
    }
    let modules = await modulesOf(rule, types, env);
    if (modules.length === 0) {
      continue;
    }
    for (let { grant, base, opensToSignedIn, opensToAnonymous } of reading) {
      let signedIn = opensToSignedIn
        ? modules.filter((module) => !covers(module, 'signedIn'))
        : [];
      let anonymous = opensToAnonymous
        ? modules.filter((module) => !covers(module, 'anonymous'))
        : [];
      if (signedIn.length === 0 && anonymous.length === 0) {
        continue;
      }
      // The callers no code grant covers, as the message names them. It
      // names one kind where a code grant covers those modules for the
      // other, so the fix is to open code to that kind too, and otherwise
      // all of them.
      let callers: Callers =
        signedIn.length > 0 && anonymous.length > 0
          ? 'any'
          : anonymous.length > 0
            ? anonymous.every((module) => covers(module, 'signedIn'))
              ? 'anonymous'
              : 'any'
            : signedIn.every((module) => covers(module, 'anonymous'))
              ? 'signed-in'
              : 'any';
      let missing = modules.filter(
        (module) => signedIn.includes(module) || anonymous.includes(module),
      );
      issues.push({
        code: 'module-not-granted',
        path: grant.path,
        message: message(
          rule,
          base === 'query' ? 'find' : 'read',
          callers,
          missing,
        ),
      });
    }
  }
  return issues;
}

// Whether a code grant's paths cover a module. A module is named as its
// identifier, which can leave out the extension of the file it is stored
// in, so one named that way is covered where its `.gts` or `.ts` file is.
function underPaths(grant: CompiledOperationGrant, module: string): boolean {
  if (!grant.paths) {
    return true;
  }
  let files = hasExecutableExtension(module)
    ? [module]
    : [module, `${module}.gts`, `${module}.ts`];
  return files.some((file) => pathSpecifierMatches(grant.paths!, file, 'file'));
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

// Which of a grant's callers a message is about: all of them, or the one kind
// no code grant covers where a code grant covers the other.
type Callers = 'any' | 'signed-in' | 'anonymous';

function message(
  rule: CompiledPolicyRule,
  lets: 'read' | 'find',
  callers: Callers,
  modules: string[],
): string {
  let who =
    callers === 'anonymous'
      ? "callers who aren't signed in"
      : callers === 'signed-in'
        ? 'signed-in callers'
        : 'its callers';
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
      : callers === 'signed-in'
        ? `The policy's \`readSource\` grants on code admit only callers who aren't signed in. Add one on \`TsFileDef\` (\`@cardstack/base/ts-file-def\`) that admits signed-in callers too.`
        : `Add a rule on \`TsFileDef\` (\`@cardstack/base/ts-file-def\`) that grants \`readSource\` to the same callers. A rule on \`FileDef\` doesn't reach code.`;
  return (
    `this grant lets ${who} ${lets} \`${rule.targetType.name}\` cards, and no grant in this policy lets them load the code those cards are defined in: ${named}${rest}. ` +
    `A caller who reaches the realm only through its policy can ${lets} such a card but can't render it.\n\n${fix}`
  );
}
