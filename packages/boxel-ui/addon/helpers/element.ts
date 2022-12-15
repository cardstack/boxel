import EmberComponent from '@ember/component';
import { ensureSafeComponent } from '@embroider/util';
import { ComponentLike } from '@glint/template';

interface Signature<T extends keyof HTMLElementTagNameMap> {
  Element: HTMLElementTagNameMap[T];
  Blocks: { default: [] };
}

export default function element<T extends keyof HTMLElementTagNameMap>(
  tagName: T | undefined
): ComponentLike<Signature<T>> {
  let tag = tagName ? tagName : ('div' as T);
  if (typeof tag !== 'string') {
    throw new Error(
      'The `element` helper only accepts strings as its first argument'
    );
  }
  return ensureSafeComponent(
    class DynamicElement extends EmberComponent {
      tagName = tag;
    },
    undefined
  ) as ComponentLike<Signature<T>>;
}
