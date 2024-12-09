import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import element from '../../helpers/element.ts';

interface Signature {
  Args: {
    displayBoundaries?: boolean;
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const CardContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag
      class={{cn 'boxel-card-container' boundaries=@displayBoundaries}}
      data-test-boxel-card-container
      ...attributes
    >
      {{yield}}
    </Tag>
  {{/let}}
  <style scoped>
    .boxel-card-container {
      position: relative;
      background-color: var(--boxel-light);
      border-radius: var(--boxel-border-radius);
      transition:
        max-width var(--boxel-transition),
        box-shadow var(--boxel-transition);
      height: 100%;
      width: 100%;
      overflow: hidden;
    }
    .boundaries {
      box-shadow: 0 0 0 1px var(--boxel-light-500);
    }
  </style>
</template>;

export default CardContainer;
