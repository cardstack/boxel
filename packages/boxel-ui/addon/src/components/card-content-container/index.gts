import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn, element } from '../../helpers.ts';

interface Signature {
  Args: {
    isFlex?: boolean;
    isGrid?: boolean;
    tag?: keyof HTMLElementTagNameMap;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLElement;
}

const Container: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |TagName|}}
    <TagName
      class={{cn 'container' is-grid=@isGrid is-flex=@isFlex}}
      ...attributes
    >
      {{yield}}
    </TagName>
  {{/let}}
  <style scoped>
    @layer {
      .card-content-container {
        padding: var(--boxel-sp);
      }
      .is-grid {
        display: grid;
        gap: var(--boxel-sp);
      }
      .is-flex {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp);
        align-items: center;
      }
    }
  </style>
</template>;

export default Container;
