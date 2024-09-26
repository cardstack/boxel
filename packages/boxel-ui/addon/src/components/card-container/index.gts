import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import element from '../../helpers/element.ts';
import { bool, or } from '../../helpers/truth-helpers.ts';
import Header from '../header/index.gts';

interface Signature {
  Args: {
    displayBoundaries?: boolean;
    isHighlighted?: boolean;
    label?: string;
    tag?: keyof HTMLElementTagNameMap;
    title?: string;
  };
  Blocks: {
    default: [];
    header: [];
  };
  Element: HTMLElement;
}

const CardContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag
      class={{cn
        'boxel-card-container'
        highlighted=@isHighlighted
        boundaries=@displayBoundaries
      }}
      data-test-boxel-card-container
      ...attributes
    >
      {{#if (or (has-block 'header') (bool @label) (bool @title))}}
        <Header @size='large' @subtitle={{@label}} @title={{@title}}>
          {{yield to='header'}}
        </Header>
      {{/if}}

      {{yield}}
    </Tag>
  {{/let}}
  <style scoped>
    .boxel-card-container {
      width: 100%;
      height: 100%;
      position: relative;
      background-color: var(--boxel-light);
      border-radius: var(--boxel-border-radius);
      transition:
        max-width var(--boxel-transition),
        box-shadow var(--boxel-transition);
      height: 100%;
      width: 100%;
    }
    .boundaries {
      box-shadow: 0 0 0 1px var(--boxel-light-500);
    }
    .highlighted {
      box-shadow: 0 0 0 2px var(--boxel-highlight);
    }
  </style>
</template>;

export default CardContainer;
