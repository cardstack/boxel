/* eslint-disable ember/no-classic-components */
import EmberComponent from '@ember/component';
import type { ComponentLike } from '@glint/template';

interface Signature<T extends keyof HTMLElementTagNameMap> {
  Blocks: { default: [] };
  Element: HTMLElementTagNameMap[T];
}

// One component per tag name. A template renders the component this returns,
// so a new one on each call would make the template tear down the element and
// draw a new one whenever the helper runs again, even for the same tag: an
// input being typed into would lose its focus and its caret.
const elements = new Map<string, ComponentLike<Signature<keyof HTMLElementTagNameMap>>>();

export default function element<T extends keyof HTMLElementTagNameMap>(
  tagName: T | undefined,
): ComponentLike<Signature<T>> {
  let tag = (tagName ?? 'div') as string;
  let found = elements.get(tag);
  if (!found) {
    found = class DynamicElement extends EmberComponent<Signature<keyof HTMLElementTagNameMap>> {
      tagName = tag;
    };
    elements.set(tag, found);
  }
  return found as ComponentLike<Signature<T>>;
}
