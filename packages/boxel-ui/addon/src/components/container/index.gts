import type { TemplateOnlyComponent } from '@ember/component/template-only';

import {
  type BoxelSpacing,
  calcBoxelSpacing,
  cn,
  cssVar,
  element,
  eq,
} from '../../helpers.ts';

export type BoxelContainerDisplayOption =
  | 'default'
  | 'grid'
  | 'inline-grid'
  | 'flex'
  | 'inline-flex';

interface Signature {
  Args: {
    alignContent?: string;
    alignItems?: string;
    alignSelf?: string;
    display?: BoxelContainerDisplayOption;
    flexDirection?: 'column' | 'row';
    flexWrap?: 'nowrap' | 'wrap';
    gap?: BoxelSpacing | string;
    justifyContent?: string;
    justifyItems?: string;
    justifySelf?: string;
    padding?: BoxelSpacing | string;
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
      style={{cssVar
        boxel-container-padding=(calcBoxelSpacing @padding)
        boxel-container-gap=(calcBoxelSpacing @gap)
        boxel-container-flex-direction=@flexDirection
        boxel-container-flex-wrap=@flexWrap
        boxel-container-align-content=@alignContent
        boxel-container-align-items=@alignItems
        boxel-container-align-self=@alignSelf
        boxel-container-justify-content=@justifyContent
        boxel-container-justify-items=@justifyItems
        boxel-container-justify-self=@justifySelf
      }}
      ...attributes
    >
      {{yield}}
    </TagName>
  {{/let}}
  <style scoped>
    @layer boxelComponentL1 {
      .boxel-container {
        padding: var(--boxel-container-padding, var(--boxel-sp));
      }
      .boxel-grid {
        display: grid;
      }
      .boxel-inline-grid {
        display: inline-grid;
      }
      .boxel-grid,
      .boxel-inline-grid,
      .boxel-flex,
      .boxel-inline-flex {
        gap: var(--boxel-container-gap, var(--boxel-sp));
        align-items: var(--boxel-container-align-items);
        align-content: var(--boxel-container-align-content);
        align-self: var(--boxel-container-align-self);
        justify-content: var(--boxel-container-justify-content);
        justify-items: var(--boxel-container-justify-items);
        justify-self: var(--boxel-container-justify-self);
      }
      .boxel-flex {
        display: flex;
      }
      .boxel-inline-flex {
        display: inline-flex;
      }
      .boxel-flex,
      .boxel-inline-flex {
        flex-direction: var(--boxel-container-flex-direction);
        flex-wrap: var(--boxel-container-flex-wrap);
      }
    }
  </style>
</template>;

export default Container;
