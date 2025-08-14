import type { TemplateOnlyComponent } from '@ember/component/template-only';

import { cn, element, eq } from '../../helpers.ts';

export type BoxelContainerDisplayOption =
  | 'default'
  | 'grid'
  | 'inline-grid'
  | 'flex'
  | 'inline-flex';

interface Signature {
  Args: {
    display?: BoxelContainerDisplayOption;
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
      class={{cn
        'boxel-container'
        boxel-grid=(eq @display 'grid')
        boxel-inline-grid=(eq @display 'inline-grid')
        boxel-flex=(eq @display 'flex')
        boxel-inline-flex=(eq @display 'inline-flex')
      }}
      ...attributes
    >
      {{yield}}
    </TagName>
  {{/let}}
  <style scoped>
    @layer {
      .boxel-container {
        padding: var(--boxel-container-padding, var(--boxel-sp));
      }
      .boxel-grid {
        display: grid;
        gap: var(--boxel-container-gap, var(--boxel-sp));
      }
      .boxel-inline-grid {
        display: inline-grid;
        gap: var(--boxel-container-gap, var(--boxel-sp));
      }
      .boxel-flex {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-container-gap, var(--boxel-sp));
        align-items: center;
      }
      .boxel-inline-flex {
        display: inline-flex;
        flex-wrap: wrap;
        gap: var(--boxel-container-gap, var(--boxel-sp));
        align-items: center;
      }
    }
  </style>
</template>;

export default Container;
