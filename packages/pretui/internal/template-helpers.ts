// Pretui — the kit's template-callable helpers: the comparisons strict-mode
// templates lack, and `element`, which renders a tag chosen at runtime. The
// vendored surfaces bundles import `add`, `element`, `eq` and `lt` from here,
// so their signatures stay as the bundles call them.

import EmberComponent from '@ember/component';
import type { ComponentLike } from '@glint/template';

export function eq<T>(a: T, b: T): boolean {
  return a === b;
}

export function not<T>(value: T): boolean {
  return !value;
}

export function lt<T>(a: T, b: T): boolean {
  return a < b;
}

export function add(a: number, b: number): number {
  return a + b;
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
