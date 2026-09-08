/**
 * The request-context builtins: `params`, `actor` and `instance`.
 *
 * A mutation program can see the document it is editing through `.`. These
 * three add the rest of what a card operation needs — what the caller sent,
 * who the caller is, and the stored document behind the edit — each supplied
 * by the host and scoped to one evaluation by `withRequestContext`.
 *
 * They are functions rather than `$`-prefixed variables, matching the form
 * card operations are authored in, and named `params` rather than the more
 * obvious `input` because jq owns `input/0`: a second definition at that key
 * would hide jq's, which the mutation profile bans by name anyway.
 *
 * Every failure here throws. A program that asks for a value the host did not
 * supply, or for a key that is not there, has a defect in it — answering
 * `null` would let that defect through as a missing comment author or a
 * silently unset field.
 */
import {
  type BareNativeFilter,
  wrapBareNativeFilters,
} from '../../jqtools/evaluate/filters/lib/nativeFilter.ts';
import {
  currentRequestContext,
  type NativeRequestContext,
} from '../../jqtools/evaluate/runtimeState.ts';
import { JqArgumentError, JqEvaluateError } from '../../jqtools/errors.ts';

/** How many key names an error message lists before it truncates. */
const KEYS_IN_MESSAGE = 12;

type ContextSlot = keyof NativeRequestContext;

/** What each slot holds, for error messages that say who should have set it. */
const SLOT_DESCRIPTIONS: Record<ContextSlot, string> = {
  params: 'the payload the caller sent',
  actor: 'the caller identity',
  instance: 'the stored document being edited',
};

/**
 * How to ask for a key that may legitimately be absent. `actor` and
 * `instance` hand back the whole object with no argument, so a program that
 * wants a default rather than a failure has somewhere to go; a missing
 * payload key has no such reading, since the operation declares its keys.
 */
const OPTIONAL_KEY_HINTS: Partial<Record<ContextSlot, string>> = {
  actor: 'Use `actor()` and index it if the key may be absent.',
  instance: 'Use `instance()` and index it if the key may be absent.',
};

function slotObject(slot: ContextSlot, call: string): Record<string, unknown> {
  const context = currentRequestContext();
  if (!context) {
    throw new JqEvaluateError(
      `${call} needs a request context, which the host supplies when it runs ` +
        'a mutation program. This program was evaluated without one.',
    );
  }

  const value = context[slot];
  if (value === undefined || value === null) {
    throw new JqEvaluateError(
      `${call} needs ${SLOT_DESCRIPTIONS[slot]}, which the host did not ` +
        `supply in this request's context.`,
    );
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new JqEvaluateError(
      `${call} needs ${SLOT_DESCRIPTIONS[slot]} to be an object, but the ` +
        `host supplied ${Array.isArray(value) ? 'an array' : typeof value}.`,
    );
  }
  return value as Record<string, unknown>;
}

function describeKeys(source: Record<string, unknown>): string {
  // Only keys carrying a value are listed. A key present with `undefined` is
  // not one a program can read, so naming it in the message would point the
  // reader at a key that fails the same way the one they asked for did.
  const keys = Object.keys(source)
    .filter((key) => source[key] !== undefined)
    .sort();
  if (keys.length === 0) return 'it has no readable keys';
  const shown = keys.slice(0, KEYS_IN_MESSAGE);
  const rest = keys.length - shown.length;
  return `it has ${shown.map((key) => `"${key}"`).join(', ')}${
    rest > 0 ? ` and ${rest} more` : ''
  }`;
}

function requireKey(slot: ContextSlot, call: string, key: unknown): unknown {
  if (typeof key !== 'string') {
    throw new JqArgumentError(
      `${call} takes a key name as a string, not ${
        Array.isArray(key) ? 'an array' : key === null ? 'null' : typeof key
      }.`,
    );
  }
  const source = slotObject(slot, call);
  // A key held with an explicit `undefined` counts as absent. `undefined` is
  // not a JSON value, and yielding it would put it in front of the planner as
  // one — writing an intent that unsets the field, which is the silent
  // failure these builtins exist to refuse. A JSON `null` is a real value and
  // passes through.
  if (source[key] === undefined) {
    const hint = OPTIONAL_KEY_HINTS[slot];
    throw new JqEvaluateError(
      `${call} asks for "${key}", which is not in ${
        SLOT_DESCRIPTIONS[slot]
      } — ${describeKeys(source)}.${hint ? ` ${hint}` : ''}`,
    );
  }
  return source[key];
}

const bareNativeFilters: Record<string, BareNativeFilter> = {
  'params/1': function* (_input, key) {
    yield requireKey('params', 'params(key)', key);
  },
  'actor/0': function* () {
    yield slotObject('actor', 'actor()');
  },
  'actor/1': function* (_input, key) {
    yield requireKey('actor', 'actor(key)', key);
  },
  'instance/0': function* () {
    yield slotObject('instance', 'instance()');
  },
  'instance/1': function* (_input, key) {
    yield requireKey('instance', 'instance(key)', key);
  },
};

export const requestContextNativeFilters =
  wrapBareNativeFilters(bareNativeFilters);
