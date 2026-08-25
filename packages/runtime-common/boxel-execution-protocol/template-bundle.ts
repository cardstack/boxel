/**
 * Captured template instructions and their resolved names, plus the gate a
 * consumer passes before it reifies any of them.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type * as JSONTypes from 'json-typescript';

import type { Cloneable } from './cloneable.ts';
import {
  ProtocolRefusal,
  describeValue,
  joinTokens,
  quoteToken,
} from './refusal.ts';
import {
  asRefusal,
  isPlainRecord,
  normalizeJsonData,
  normalizeJsonRecord,
  normalizeString,
  normalizeStringArray,
  readMember,
} from './untrusted-input.ts';
import { assertUsableExecutionRecord } from './version.ts';
import type { ProtocolEnvelope, ProtocolSupport } from './version.ts';

/**
 * What a name in a captured template resolves to. Every entry is a token the
 * Host redeems against a vocabulary — never the value itself, and never
 * anything executable.
 *
 * A `trusted-export` is a portal token — the module and export name of
 * something the Host owns. Whether that export may be used as a component, a
 * helper, or a modifier is decided where the token is redeemed, against the
 * Host's vocabulary for the position it appears in; a token naming a real
 * export used in the wrong position is refused there rather than invoked.
 * Splitting the token itself by category would require the capture side to
 * classify an export it only holds a reference to.
 *
 * An `authored-component` names another captured template in the same bundle,
 * which goes through capture, validation, and rebuild exactly like the one
 * referencing it.
 *
 * A `literal-value` is the plain data a template closed over: a module-level
 * constant a template interpolates is neither a component nor a Host export,
 * and it crosses as cloned JSON.
 *
 * Three kinds, because scope classification has three outcomes. A vocabulary
 * admitting a fourth that no producer emits would be a kind the Host has no
 * rule to redeem and no rule to refuse it against, which is the wrong default
 * for a boundary.
 *
 * A name that fits none of these kinds — a locally defined function used as a
 * template helper, most often — has no safe category and is refused by name
 * at capture time rather than smuggled across.
 */
export const TEMPLATE_DEPENDENCY_KINDS = [
  'trusted-export',
  'authored-component',
  'literal-value',
] as const;

export type TemplateDependencyKind = (typeof TEMPLATE_DEPENDENCY_KINDS)[number];

export type TemplateDependency = Cloneable<
  | { kind: 'trusted-export'; module: string; name: string }
  // `templateId` keys into the bundle's `templates` map. Not `template`,
  // which reads as the template itself — that is `TemplateDescriptor.block`.
  | { kind: 'authored-component'; templateId: string }
  | { kind: 'literal-value'; value: JSONTypes.Value }
>;

/**
 * The projected state of one captured component instance. The authored
 * instance itself stays with its execution owner; this is the cloneable view
 * of it a rebuilt Host component reads, and the baseline that a
 * `ComponentUpdate` reports changes against.
 */
export type ComponentInstanceDescriptor = Cloneable<{
  handle: string;
  state: Record<string, JSONTypes.Value>;
  getters: string[];
  actions: string[];
}>;

export type TemplateDescriptor = Cloneable<{
  id: string;
  block: string;
  moduleName: string;
  isStrictMode: boolean;
  stylesheets: string[];
  scope: TemplateDependency[];
  instance: ComponentInstanceDescriptor;
}>;

/**
 * Validated template instructions plus their resolved names. It never holds
 * an authored closure; the Host reifies it into private component definitions
 * only after validation.
 */
export type TemplateBundle = Cloneable<
  ProtocolEnvelope & {
    root: string;
    templates: Record<string, TemplateDescriptor>;
  }
>;

const templateDependencyKinds: ReadonlySet<string> = new Set(
  TEMPLATE_DEPENDENCY_KINDS,
);

/**
 * The gate a consumer passes before it reifies any part of a bundle, and the
 * only bundle it may then reify.
 *
 * It returns a normalized bundle rather than approving the caller's. A gate
 * that validates in place answers a question about the adversary's object and
 * then hands that same object on, so every member it checked can differ by the
 * time the consumer reads it — a Proxy re-answers, an accessor runs again, a
 * non-enumerable member appears. Everything here is read once as own data and
 * rebuilt; what comes back is a plain graph whose members are what they were
 * checked to be.
 *
 * A single unrecognized dependency kind rejects the whole generation, not the
 * one template that carries it: a bundle is a template and everything its
 * templates reference, so reifying the recognized part of it would render a
 * component whose scope is missing exactly the name nobody understood. Every
 * unrecognized kind is reported at once, so one diagnostic names all of them.
 *
 * A dangling reference is that same failure reached by a different route, so
 * it is refused here too: a `root` or an `authored-component` naming a
 * template the bundle does not carry would otherwise reify into a component
 * whose scope resolves to nothing at render time, past every gate.
 */
export function acceptTemplateBundle(
  bundle: TemplateBundle,
  support: ProtocolSupport,
): TemplateBundle {
  return asRefusal(() => gateTemplateBundle(bundle, support));
}

function gateTemplateBundle(
  bundle: TemplateBundle,
  support: ProtocolSupport,
): TemplateBundle {
  let envelope = assertUsableExecutionRecord(bundle, support);

  let root = normalizeString(readMember(bundle, 'root'), "a bundle's root");
  let templates = readMember(bundle, 'templates');
  if (!isPlainRecord(templates)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `a bundle's templates must be an object keyed by template id, received ${describeValue(templates)}`,
    );
  }

  let unrecognized: string[] = [];
  let dangling: string[] = [];
  // Own names only. `in` would resolve `root: 'toString'` against
  // Object.prototype and report a template the bundle does not carry.
  let keys = Object.getOwnPropertyNames(templates);
  let carried = new Set(keys);
  if (!carried.has(root)) {
    dangling.push(`root ${quoteToken(root)}`);
  }

  let normalized: Record<string, TemplateDescriptor> = {};
  for (let key of keys) {
    let descriptor = readMember(templates, key);
    if (!isPlainRecord(descriptor)) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(key)} must be a descriptor, received ${describeValue(descriptor)}`,
      );
    }
    let scope = readMember(descriptor, 'scope');
    if (!Array.isArray(scope)) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(key)} must carry a scope array, received ${describeValue(scope)}`,
      );
    }

    let dependencies: TemplateDependency[] = [];
    let scopeLength = readMember(scope, 'length');
    if (typeof scopeLength !== 'number' || !Number.isInteger(scopeLength)) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(key)}'s scope must have an integer length, received ${describeValue(scopeLength)}`,
      );
    }
    for (let index = 0; index < scopeLength; index++) {
      let entry = readMember(scope, String(index));
      if (!isPlainRecord(entry)) {
        throw new ProtocolRefusal(
          'BOXEL_RECORD_MALFORMED',
          `template ${quoteToken(key)} carries a scope entry that is not a dependency, received ${describeValue(entry)}`,
        );
      }
      // Read once. A kind read a second time is a kind a Proxy may answer
      // differently, so the gate would bless one and the consumer redeem
      // another.
      let kind = readMember(entry, 'kind');
      if (typeof kind !== 'string') {
        throw new ProtocolRefusal(
          'BOXEL_RECORD_MALFORMED',
          `template ${quoteToken(key)} carries a dependency with no kind, received ${describeValue(kind)}`,
        );
      }
      if (!templateDependencyKinds.has(kind)) {
        unrecognized.push(`${quoteToken(key)}: ${quoteToken(kind)}`);
        continue;
      }
      let dependency = normalizeDependency(
        key,
        kind as TemplateDependencyKind,
        entry,
      );
      if (
        dependency.kind === 'authored-component' &&
        !carried.has(dependency.templateId)
      ) {
        dangling.push(
          `${quoteToken(key)} references authored component ${quoteToken(dependency.templateId)}`,
        );
      }
      dependencies.push(dependency);
    }

    normalized[key] = normalizeDescriptor(key, descriptor, dependencies);
  }

  if (unrecognized.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_TEMPLATE_DEPENDENCY_KIND_UNKNOWN',
      `template bundle ${quoteToken(root)} names dependency kinds this consumer does not recognize — ${joinTokens(unrecognized, '; ')}`,
    );
  }
  if (dangling.length > 0) {
    throw new ProtocolRefusal(
      'BOXEL_TEMPLATE_BUNDLE_INCOMPLETE',
      `template bundle ${quoteToken(root)} cannot be reified — ${joinTokens(dangling, '; ')}`,
    );
  }

  return { ...envelope, root, templates: normalized };
}

/**
 * Rebuilds a dependency from own-data reads, refusing one that lacks the
 * members its own kind is redeemed through.
 *
 * The kind allowlist alone establishes almost nothing: a `trusted-export`
 * with no `module` passes it and then fails at resolution, past every gate,
 * which is the class of escape this gate exists to prevent.
 */
function normalizeDependency(
  templateKey: string,
  kind: TemplateDependencyKind,
  entry: Record<string, unknown>,
): TemplateDependency {
  let member = (name: string) => {
    let value = readMember(entry, name);
    if (typeof value !== 'string') {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `template ${quoteToken(templateKey)} carries a ${quoteToken(kind)} dependency whose ${name} is ${describeValue(value)}`,
      );
    }
    return value;
  };
  switch (kind) {
    case 'trusted-export':
      return {
        kind,
        module: member('module'),
        name: member('name'),
      };
    case 'authored-component':
      return { kind, templateId: member('templateId') };
    case 'literal-value':
      // The kind that carries an arbitrary value is the one most worth
      // checking. `readMember` refuses an accessor rather than running it,
      // and `normalizeJsonData` refuses anything that is not data — a
      // function here would otherwise survive to the redeemer, failing
      // `structuredClone` with a bare error past every gate, or on a tier
      // that shares a heap and does not clone, reaching authored scope as
      // the live object.
      return { kind, value: normalizeJsonData(readMember(entry, 'value')) };
  }
}

/**
 * Rebuilds a descriptor from own-data reads, refusing one a consumer could
 * not reify.
 *
 * Checked here rather than left to the consumer because `block` is compiled,
 * `stylesheets` is iterated, and `instance` is dereferenced — so a descriptor
 * that is merely shaped like one turns into a compile of arbitrary data, a
 * loop over the characters of a string, or the same bare TypeError this
 * module refuses everywhere else.
 */
function normalizeDescriptor(
  key: string,
  descriptor: Record<string, unknown>,
  scope: TemplateDependency[],
): TemplateDescriptor {
  let where = (name: string) => `template ${quoteToken(key)}'s ${name}`;
  // Deliberately NOT `descriptor.id === key`. The map key is the bundle's own
  // reference space and the descriptor's id is the compiler's, and the two are
  // allowed to differ — a class inheriting its template from an ancestor
  // legitimately yields two entries carrying one compiler id. What a consumer
  // needs is that the id is nameable at all, since it names the reified
  // factory.
  let id = normalizeString(readMember(descriptor, 'id'), where('id'));
  let block = normalizeString(readMember(descriptor, 'block'), where('block'));
  let moduleName = normalizeString(
    readMember(descriptor, 'moduleName'),
    where('moduleName'),
  );
  let isStrictMode = readMember(descriptor, 'isStrictMode');
  if (typeof isStrictMode !== 'boolean') {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${where('isStrictMode')} must be a boolean, received ${describeValue(isStrictMode)}`,
    );
  }
  let stylesheets = normalizeStringArray(
    readMember(descriptor, 'stylesheets'),
    where('stylesheets'),
  );

  let instance = readMember(descriptor, 'instance');
  if (!isPlainRecord(instance)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `${where('instance')} must be a component descriptor, received ${describeValue(instance)}`,
    );
  }
  return {
    id,
    block,
    moduleName,
    isStrictMode,
    stylesheets,
    scope,
    instance: {
      handle: normalizeString(
        readMember(instance, 'handle'),
        where('instance.handle'),
      ),
      // The state a Capsule installs into authored scope, so it is data on
      // the same terms as a literal value.
      state: normalizeJsonRecord(
        readMember(instance, 'state'),
        where('instance.state'),
      ),
      getters: normalizeStringArray(
        readMember(instance, 'getters'),
        where('instance.getters'),
      ),
      actions: normalizeStringArray(
        readMember(instance, 'actions'),
        where('instance.actions'),
      ),
    },
  };
}
