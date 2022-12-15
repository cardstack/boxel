import { ComponentLike } from '@glint/template';
import EmberComponent from '@ember/component';
import { ensureSafeComponent } from '@embroider/util';

export interface Signature {
  Element: HTMLElement;
  Args: {
    tagName: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
}

export default function element<T extends keyof HTMLElementTagNameMap>(
  tagName: T
): ComponentLike<Signature> {
  let componentClass: ComponentLike<Signature> | null = null;
  if (typeof tagName === 'string') {
    componentClass = ensureSafeComponent(
      class DynamicElement extends EmberComponent {
        tagName = tagName;
      },
      this as ComponentLike<Signature>
    ) as ComponentLike<Signature>;
  } else {
    componentClass = null;
    throw new Error(
      'The `element` helper only accepts strings as its first argument'
    );
  }
  return componentClass;
}
