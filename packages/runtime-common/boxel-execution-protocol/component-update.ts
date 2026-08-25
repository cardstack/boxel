/**
 * What one turn of caged component code produced, plus its gate.
 *
 * Part of the cross-boundary execution protocol (RP-14); see
 * `../boxel-execution-protocol.ts` for the properties every file here holds.
 */

import type * as JSONTypes from 'json-typescript';

import type { Cloneable } from './cloneable.ts';
import {
  MAX_LITERAL_VALUE_NODES,
  ProtocolRefusal,
  describeValue,
  joinTokens,
  newOffenderList,
  quoteToken,
  recordOffender,
} from './refusal.ts';
import {
  asRefusal,
  isPlainRecord,
  normalizeJsonData,
  newNormalizationBudget,
  normalizeJsonRecord,
  readMember,
} from './untrusted-input.ts';
import type { NormalizationBudget } from './untrusted-input.ts';
import { assertUsableExecutionRecord } from './version.ts';
import type { ProtocolEnvelope, ProtocolSupport } from './version.ts';

/**
 * What caged code asks the Host to do, expressed as intent rather than
 * action. Each kind names one of the capabilities the Host's own surface
 * service owns (RP-16.1); holding an effect grants nothing, and the Host
 * re-authorizes every one before performing it.
 *
 * `payload` is deliberately open: each capability's argument shape belongs to
 * that capability's own spec section, which versions independently of this
 * envelope.
 */
export const COMPONENT_EFFECT_KINDS = [
  'presentation',
  'layout',
  'observe',
  'view-card',
  'patch',
] as const;

export type ComponentEffectKind = (typeof COMPONENT_EFFECT_KINDS)[number];

export type ComponentEffect = Cloneable<{
  kind: ComponentEffectKind;
  /**
   * Optional, because not every capability takes an argument — `observe` is a
   * request with nothing to say beyond its own name.
   */
  payload?: JSONTypes.Value;
}>;

/**
 * What one turn of caged component code produced: the projected state that
 * changed, and the capability requests it queued.
 *
 * `generation` is the render-family sequence number the request carried. A
 * consumer applies an update only for the generation it is still waiting on,
 * so a burst of rapid edits or format switches cannot resurrect superseded
 * output.
 */
export type ComponentUpdate = Cloneable<
  ProtocolEnvelope & {
    generation: number;
    changed: Record<string, JSONTypes.Value>;
    effects: ComponentEffect[];
  }
>;

const componentEffectKinds: ReadonlySet<string> = new Set(
  COMPONENT_EFFECT_KINDS,
);

/**
 * The gate a consumer passes before it applies an update or dispatches its
 * effects, and the only update it may then apply.
 *
 * Normalized and returned for the same reason as a bundle: what a consumer
 * applies has to be what was checked, not an object that merely answered the
 * check that way once.
 *
 * An unrecognized effect kind rejects the whole update, changed state
 * included: applying the state while dropping the request that was supposed to
 * accompany it is how a surface ends up showing a half-performed intent.
 */
export function acceptComponentUpdate(
  update: ComponentUpdate,
  support: ProtocolSupport,
): ComponentUpdate {
  return asRefusal(() =>
    gateComponentUpdate(update, support, newNormalizationBudget()),
  );
}

function gateComponentUpdate(
  update: ComponentUpdate,
  support: ProtocolSupport,
  budget: NormalizationBudget,
): ComponentUpdate {
  let envelope = assertUsableExecutionRecord(update, support, budget);

  // The generation is the guard that stops superseded output being applied,
  // so a generation that cannot be compared defeats it silently.
  let generation = readMember(update, 'generation');
  if (typeof generation !== 'number' || !Number.isFinite(generation)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `an update's generation must be a finite number, received ${describeValue(generation)}`,
    );
  }
  let changed = normalizeJsonRecord(
    readMember(update, 'changed'),
    "an update's changed",
    budget,
  );

  let effects = readMember(update, 'effects');
  if (!Array.isArray(effects)) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `an update's effects must be an array, received ${describeValue(effects)}`,
    );
  }
  let unrecognized = newOffenderList();
  let normalized: ComponentEffect[] = [];
  let effectsLength = readMember(effects, 'length');
  if (
    typeof effectsLength !== 'number' ||
    !Number.isInteger(effectsLength) ||
    effectsLength < 0
  ) {
    throw new ProtocolRefusal(
      'BOXEL_RECORD_MALFORMED',
      `an update's effects must have a non-negative integer length, received ${describeValue(effectsLength)}`,
    );
  }
  for (let index = 0; index < effectsLength; index++) {
    // Charged before the kind is read: the recognized branch pays through
    // `normalizeJsonData`, the `continue` branch paid nothing.
    if (--budget.remaining < 0) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `an update carries more effects than the ${MAX_LITERAL_VALUE_NODES} values one record may hold`,
      );
    }
    let entry = readMember(effects, String(index));
    if (!isPlainRecord(entry)) {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `an update carries an entry that is not an effect, received ${describeValue(entry)}`,
      );
    }
    let kind = readMember(entry, 'kind');
    if (typeof kind !== 'string') {
      throw new ProtocolRefusal(
        'BOXEL_RECORD_MALFORMED',
        `an effect carries no kind, received ${describeValue(kind)}`,
      );
    }
    if (!componentEffectKinds.has(kind)) {
      recordOffender(unrecognized, quoteToken(kind));
      continue;
    }
    // A payload is the same kind of thing as a literal value — arbitrary,
    // author-chosen, and handed onward — so it is normalized on the same
    // terms rather than passed through because its shape is open.
    normalized.push({
      kind: kind as ComponentEffectKind,
      payload: normalizeJsonData(readMember(entry, 'payload'), budget),
    });
  }
  if (unrecognized.total > 0) {
    throw new ProtocolRefusal(
      'BOXEL_COMPONENT_EFFECT_KIND_UNKNOWN',
      `an update names effect kinds this consumer does not recognize: ${joinTokens(unrecognized)}`,
    );
  }

  return { ...envelope, generation, changed, effects: normalized };
}
