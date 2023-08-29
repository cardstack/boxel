/* eslint-disable ember/no-classic-components */
import EmberComponent from '@ember/component';
import { type ComponentLike } from '@glint/template';

interface Signature<T extends keyof HTMLElementTagNameMap> {
  Blocks: { default: [] };
  Element: HTMLElementTagNameMap[T];
}

export default function element<T extends keyof HTMLElementTagNameMap>(
  tagName: T | undefined,
): ComponentLike<Signature<T>> {
  return class DynamicElement extends EmberComponent<Signature<T>> {
    tagName = (tagName ?? ('div' as T)) as string;
  };
}
