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
 * obvious `input` because the mutation profile denies `input`. Registry
 * resolution is per `NAME/arity`, so an `input("key")` accessor would land at
 * the free `input/1` and hide jq's `input/0` from nothing — but profile
 * classification is by base name without arity, so it would be refused
 * before it ran.
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

/**
 * How much of one key name a message shows. Keys come from host data, so a
 * count cap alone still lets a single long key dominate the message it is
 * attached to.
 */
const KEY_CHARS_IN_MESSAGE = 60;

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

/**
 * One key name, cut to {@link KEY_CHARS_IN_MESSAGE}.
 *
 * Cut by code point rather than by string index, so the cut cannot land
 * inside a surrogate pair and leave a lone surrogate in the message.
 */
function truncateKey(key: string): string {
  if (key.length <= KEY_CHARS_IN_MESSAGE) return key;
  const points = [...key];
  if (points.length <= KEY_CHARS_IN_MESSAGE) return key;
  return `${points.slice(0, KEY_CHARS_IN_MESSAGE).join('')}…`;
}

function describeKeys(source: Record<string, unknown>): string {
  // Own properties, enumerable or not, because that is what `requireKey`
  // accepts — listing only the enumerable ones would omit a key that works.
  // A key held with `undefined` is dropped, since naming it would point the
  // reader at one that fails exactly as the key they asked for did.
  //
  // Read through descriptors rather than by indexing: a diagnostic must not
  // invoke host getters, which would make one throwing getter anywhere in the
  // object replace this message with its own error.
  const keys = Object.getOwnPropertyNames(source)
    .filter((key) => {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      if (!descriptor) return false;
      // An accessor's value is unknown without calling it, so it is listed.
      return !('value' in descriptor) || descriptor.value !== undefined;
    })
    .sort();
  if (keys.length === 0) return 'it has no readable keys';
  const shown = keys.slice(0, KEYS_IN_MESSAGE);
  const rest = keys.length - shown.length;
  const quoted = shown.map((key) => `"${truncateKey(key)}"`);
  return `it has ${quoted.join(', ')}${rest > 0 ? ` and ${rest} more` : ''}`;
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
  // Two conditions, and both are load-bearing. The key has to be the object's
  // own, or `instance("toString")` would answer with a function off the
  // prototype chain; and its value has to be something other than
  // `undefined`, which a key can be held with and which is not a JSON value —
  // yielding it would put it in front of the planner as one, writing an
  // intent that unsets the field. That is the silent failure these builtins
  // exist to refuse. A JSON `null` is a real value and passes through.
  //
  // The descriptor supplies both the ownership answer and the value, so this
  // function reads an accessor once and hands back the value it checked
  // rather than whatever a second read would return. A host that supplies a
  // non-idempotent accessor still gets one read here and another from the
  // plan-time context check, which is a reason for a context to be plain
  // data.
  const descriptor = Object.getOwnPropertyDescriptor(source, key);
  const value =
    descriptor && !('value' in descriptor) ? source[key] : descriptor?.value;
  if (!descriptor || value === undefined) {
    const hint = OPTIONAL_KEY_HINTS[slot];
    throw new JqEvaluateError(
      `${call} asks for "${truncateKey(key)}", which is not in ${
        SLOT_DESCRIPTIONS[slot]
      } — ${describeKeys(source)}.${hint ? ` ${hint}` : ''}`,
    );
  }
  return value;
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
