import type { BoxelExecutionMode } from '@cardstack/runtime-common/boxel-execution-protocol';
import type { CodeRef } from '@cardstack/runtime-common/code-ref';

import config from '@cardstack/host/config/environment';

/**
 * Where a consumer read a path the projection does not carry.
 *
 * The four members are what it takes to act on one. The path alone says a
 * member is missing; the type says whose projection was supposed to carry it,
 * the format says which template asked, and the mode says which tier produced
 * the projection — which is the difference between "the pipeline does not
 * project this" and "this tier's adapter dropped it".
 */
export interface MissingProjectionPath {
  path: string;
  type: CodeRef;
  format: string;
  mode: BoxelExecutionMode;
}

export type MissingProjectionPathReporter = (
  missing: MissingProjectionPath,
) => void;

export interface MissingProjectionPathContext {
  type: CodeRef;
  format: string;
  mode: BoxelExecutionMode;
  /** Where the reported path starts, e.g. `model`. Defaults to `model`. */
  root?: string;
  /** Defaults to one `console.warn` per distinct path. */
  report?: MissingProjectionPathReporter;
}

/**
 * Watches reads of a projection and reports the paths it does not carry.
 *
 * A projection is data, so a member the pipeline failed to project is not an
 * error anywhere — it reads as `undefined`, the binding renders empty, and the
 * card is subtly wrong with nothing in any log. That silence is the specific
 * problem here: the record is built by one pipeline and read by templates
 * nobody enumerated, so the only way to learn which members a real card
 * actually wants is to watch a real card read them.
 *
 * Two properties make this safe to leave in the code:
 *
 * - **It never synthesizes.** A missing member reads as `undefined` through
 *   this wrapper exactly as it does without it. Nothing here can make a card
 *   render differently, so a report is evidence about the projection rather
 *   than a change to it.
 * - **It never ships.** In a production build this is the identity function,
 *   returning the record itself — no proxy is created, no read is intercepted,
 *   and the reporter is unreachable. Diagnostics that observe every property
 *   read belong to the loop that finds the gaps, not to the app.
 *
 * What comes back is a read-only observer view of the record, not the record.
 * Hand the original to anything that stores, clones, or sends it; this one is
 * for reading through. A view does not survive `structuredClone` — a Proxy
 * never does — which is the same rule stated from the other side.
 */
export function observeMissingProjectionPaths<T>(
  record: T,
  context: MissingProjectionPathContext,
): T {
  if (config.environment === 'production') {
    return record;
  }
  let report = context.report ?? warnOnce();
  return watch(record, context.root ?? 'model', context, report);
}

/**
 * String keys that are a probe of the value rather than a path through the
 * card.
 *
 * `then` is how anything awaited is tested for thenability. `toJSON` is what
 * `JSON.stringify` reaches for on every object it walks — and unlike
 * `toString` or `valueOf` it is not on `Object.prototype`, so a presence test
 * reports it missing. Serializing a watched projection while debugging is the
 * likeliest thing anyone does with one, and left unhandled it emits a bogus
 * report per object in the graph, burying the real gaps.
 */
const VALUE_PROBES = new Set(['then', 'toJSON']);

function watch<T>(
  value: T,
  path: string,
  context: MissingProjectionPathContext,
  report: MissingProjectionPathReporter,
  // One wrapper per underlying object, so two reads of a member answer with
  // the same view. A fresh Proxy per read makes `a.b !== a.b`, which re-keys
  // an `{{#each}}` on every re-render and makes an identity comparison of one
  // member against itself false — in a value whose intended consumer is a
  // template.
  wrappers = new WeakMap<object, unknown>(),
): T {
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  let existing = wrappers.get(value as object);
  if (existing !== undefined) {
    return existing as T;
  }
  let watched = new Proxy(value as object, {
    get(target, key, receiver) {
      // Symbols are the language's own protocol — iteration, primitive
      // coercion, `instanceof` — and never a projected path.
      if (typeof key !== 'string' || VALUE_PROBES.has(key)) {
        return Reflect.get(target, key, receiver);
      }
      let reached = `${path}.${key}`;
      if (!(key in target)) {
        report({
          path: reached,
          type: context.type,
          format: context.format,
          mode: context.mode,
        });
        return undefined;
      }
      let value = Reflect.get(target, key, receiver);
      // A proxy must hand back the exact value of a non-writable,
      // non-configurable own member, so wrapping one is a `TypeError` rather
      // than a diagnostic. Records this pipeline builds have neither, but a
      // consumer is free to freeze what it was given, and a diagnostic that
      // throws on frozen input is worse than one that stops watching below it.
      let own = Reflect.getOwnPropertyDescriptor(target, key);
      if (own && !own.configurable && !own.writable) {
        return value;
      }
      return watch(value, reached, context, report, wrappers);
    },
  });
  wrappers.set(value as object, watched);
  return watched as T;
}

/**
 * One warning per distinct path.
 *
 * A missing member is read on every re-render, and a template inside an
 * `{{#each}}` reads it once per row, so an un-deduplicated reporter buries the
 * second distinct gap under a thousand copies of the first.
 */
function warnOnce(): MissingProjectionPathReporter {
  let seen = new Set<string>();
  return ({ path, type, format, mode }) => {
    // Element positions are collapsed for the purpose of deciding what is new,
    // because a row's index is not what makes a gap distinct: a grid of a
    // thousand rows reads the same missing member a thousand times, at a
    // thousand paths. The warning still names the concrete path that reached
    // it, so the reader gets a member they can go and look at rather than a
    // pattern they have to instantiate.
    let key = `${mode}/${format}/${path.replace(/\.\d+(?=\.|$)/g, '.#')}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    console.warn(
      `Boxel projection has no '${path}' — read while rendering ` +
        `${describeRef(type)} as '${format}' in ${mode} execution`,
    );
  };
}

function describeRef(ref: CodeRef): string {
  if ('type' in ref) {
    return ref.type === 'ancestorOf'
      ? `the ancestor of ${describeRef(ref.card)}`
      : `the '${ref.field}' field of ${describeRef(ref.card)}`;
  }
  return `${ref.name} from ${ref.module}`;
}
