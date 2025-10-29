import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { element } from '../../helpers.ts';

interface Signature {
  Args: {
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const GridContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |TagName|}}
    <TagName class='grid-container' ...attributes>
      {{yield}}
    </TagName>
  {{/let}}

  <style scoped>
    .grid-container {
      display: grid;
      gap: var(--boxel-sp);
    }

    .grid-container :deep(h2),
    .grid-container :deep(h3) {
      margin: 0;
    }
  </style>
</template>;

export default GridContainer;
