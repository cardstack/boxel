import EmberComponent from '@ember/component';
import { ensureSafeComponent } from '@embroider/util';
import { ComponentLike } from '@glint/template';

export default function element(
  tagName: keyof HTMLElementTagNameMap
): ComponentLike<{ Element: HTMLElement; Blocks: { default: [] } }> {
  if (!tagName) {
    throw new Error(
      'The `element` helper requires a tag name as its first argument'
    );
  }

  if (typeof tagName !== 'string') {
    throw new Error(
      'The `element` helper only accepts strings as its first argument'
    );
  }

  return ensureSafeComponent(
    class DynamicElement extends EmberComponent {
      tagName = tagName;
    },
    undefined
  ) as ComponentLike<{ Element: HTMLElement; Blocks: { default: [] } }>;
}
