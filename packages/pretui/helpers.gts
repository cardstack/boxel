// Pretui — template helpers for host and card templates: comparisons and
// boolean logic, arithmetic, and `element`, which renders a tag chosen at
// runtime. They are the Pret UI counterparts of the same-named exports of
// `@cardstack/boxel-ui/helpers` (ADR 009 §1.3) and keep their signatures, so
// moving an import here changes only its path. The vendored surfaces bundles
// import `add`, `element`, `eq` and `lt` from this module.

import EmberComponent from '@ember/component';
import type { ComponentLike } from '@glint/template';

export function eq<T>(a: T, b: T): boolean {
  return a === b;
}

export function not<T>(value: T): boolean {
  return !value;
}

export function bool<T>(value: T): boolean {
  return Boolean(value);
}

export function and<T>(...args: [T, T, ...T[]]): boolean {
  return args.every(Boolean);
}

export function or<T>(...args: [T, T, ...T[]]): boolean {
  return args.some(Boolean);
}

/** `value`, or `fallback` when `value` is `null` or `undefined`. */
export function coalesce<T>(value: T | undefined | null, fallback: T): T {
  return value ?? fallback;
}

export function lt<T>(a: T, b: T): boolean {
  return a < b;
}

export function lte<T>(a: T, b: T): boolean {
  return a <= b;
}

export function gt<T>(a: T, b: T): boolean {
  return a > b;
}

export function gte<T>(a: T, b: T): boolean {
  return a >= b;
}

export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

export function multiply(a: number, b: number): number {
  return a * b;
}

/** Throws on a zero divisor rather than rendering `Infinity` or `NaN`. */
export function divide(a: number, b: number): number {
  if (b === 0) {
    throw new Error('Cannot divide by zero');
  }
  return a / b;
}

interface ElementSignature<T extends keyof HTMLElementTagNameMap> {
  Blocks: { default: [] };
  Element: HTMLElementTagNameMap[T];
}

/** A component whose root is `tagName` (`div` when none is given), for a
 * template that picks its element from an argument. */
export function element<T extends keyof HTMLElementTagNameMap>(
  tagName: T | undefined,
): ComponentLike<ElementSignature<T>> {
  return class DynamicElement extends EmberComponent<ElementSignature<T>> {
    tagName = (tagName ?? ('div' as T)) as string;
  };
}
