import type { SpringSpec } from '@cardstack/choreo';
import { tracked } from '@glimmer/tracking';
import type {
  DialConfig,
  DialValue,
  EasingConfig,
  SpringConfig,
} from 'dialkit/vanilla';
import type { Transition } from 'motion-dom';

/** Each control is registered at the demo's actual call site, with its own default. */
class Tuning {
  @tracked values: Record<string, DialValue> = {};
  definitions: DialConfig = {};
  listeners = new Set<() => void>();
  pending = false;
  register(key: string, definition: DialConfig[string]) {
    if (key in this.definitions) {
      return;
    }
    this.definitions[key] = definition;
    if (this.pending) {
      return;
    }
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      for (const listener of this.listeners) {
        listener();
      }
    });
  }
}
const states = new Map<string, Tuning>();
export function demoTuning(id: string) {
  let state = states.get(id);
  if (!state) {
    state = new Tuning();
    states.set(id, state);
  }
  return state;
}

function keyOf(label: string) {
  return label.replace(/[._]+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function tuneNumber(
  id: string,
  original: number,
  label: string,
  min?: number,
  max?: number,
  step?: number
): number {
  const state = demoTuning(id);
  const unit = /\((s|px|deg|×|ratio|units)\)$/.test(label)
    ? ''
    : /duration|seconds|delay/i.test(label)
      ? 's'
      : /rotate|rotation|yaw|pitch/i.test(label)
        ? 'deg'
        : /scale|zoom|dolly/i.test(label)
          ? '×'
          : /opacity|bounce|elastic|strength|haze|fraction/i.test(label)
            ? 'ratio'
            : /travel|(?:^| )x$|(?:^| )y$|width|height/i.test(label)
              ? 'px'
              : '';
  const key = keyOf(
    unit ? `${label.replace(/ seconds/i, '')} (${unit})` : label
  );
  const magnitude = Math.max(Math.abs(original), 1);
  state.register(key, [
    original,
    Number((min ?? (original < 0 ? -magnitude * 3 : 0)).toFixed(6)),
    Number((max ?? magnitude * 3).toFixed(6)),
    step ?? (magnitude > 10 ? 1 : 0.01),
  ]);
  const value = state.values[key];
  return typeof value === 'number' ? value : original;
}

/** Keep independent transitions independent: editing a spring never replaces a color tween. */
export function tuneObject<T>(id: string, original: T, label: string): T {
  if (!original || typeof original !== 'object' || Array.isArray(original)) {
    return original;
  }
  const record = original as Record<string, unknown>;
  if (
    record.type === 'spring' ||
    ('stiffness' in record && 'damping' in record) ||
    ('visualDuration' in record && 'bounce' in record)
  ) {
    const state = demoTuning(id);
    const key = keyOf(label);
    const spec = { type: 'spring', ...record } as SpringConfig;
    state.register(key, spec);
    const value = state.values[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const next = value as unknown as Record<string, unknown>;
      if (
        Object.entries(next).every(([k, v]) => k === 'type' || record[k] === v)
      ) {
        return original;
      }
      const result = { ...record };
      for (const k of [
        'stiffness',
        'damping',
        'mass',
        'visualDuration',
        'bounce',
      ]) {
        delete result[k];
      }
      return { ...result, ...next } as T;
    }
    return original;
  }
  if (
    typeof record.duration === 'number' &&
    Array.isArray(record.ease) &&
    record.ease.length === 4
  ) {
    const state = demoTuning(id);
    const key = keyOf(label);
    state.register(key, {
      type: 'easing',
      duration: record.duration,
      ease: [...record.ease],
    } as EasingConfig);
    const value = state.values[key];
    if (value && typeof value === 'object' && 'type' in value) {
      const base = { ...record };
      delete base.duration;
      delete base.ease;
      return {
        ...base,
        ...value,
        type: value.type === 'easing' ? 'tween' : 'spring',
      } as T;
    }
    return original;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(original)) {
    const name = `${label} ${key}`;
    if (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      !['repeat', 'repeatDelay'].includes(key)
    ) {
      const unit = ['opacity', 'bounce', 'dragElastic'].includes(key);
      result[key] = tuneNumber(
        id,
        value,
        name,
        unit ? 0 : undefined,
        unit ? 1 : undefined
      );
    } else if (typeof value === 'string' && /^#[0-9a-f]{3,8}$/i.test(value)) {
      const state = demoTuning(id);
      const control = keyOf(name);
      state.register(control, value);
      result[key] = state.values[control] ?? value;
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      result[key] = tuneObject(id, value, name);
    } else {
      result[key] = value;
    }
  }
  return Object.entries(result).every(
    ([key, value]) => value === (original as Record<string, unknown>)[key]
  )
    ? original
    : (result as T);
}
export function tuneMotion(
  id: string,
  original?: Transition,
  label = 'Transition'
): Transition | undefined {
  return tuneObject(id, original, label);
}
export function tuneSpring(
  id: string,
  original?: SpringSpec,
  label = 'Spring'
): SpringSpec | undefined {
  return tuneObject(id, original, label);
}
export function tuneVariants<T>(
  id: string,
  original: T,
  label = 'Variants'
): T {
  return tuneObject(id, original, label);
}
export function tuneSeconds(
  id: string,
  original: number,
  label = 'Duration'
): number {
  return tuneNumber(
    id,
    original,
    `${label} seconds`,
    0.02,
    Math.max(3, original * 3),
    0.01
  );
}
