import type { TemplateOnlyComponent } from '@ember/component/template-only';
import element from '../helpers/element';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [],
  };
}

const Label: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag class="boxel-label" ...attributes>
      {{yield}}
    </Tag>
  {{/let}}
</template>;

export default Label;
