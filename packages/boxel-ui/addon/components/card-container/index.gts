import type { TemplateOnlyComponent } from '@ember/component/template-only';
import element from '../../helpers/element';
import cn from '../../helpers/cn';
import { or, bool } from '../../helpers/truth-helpers';
import Header from '../header';

interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
    label?: string;
    title?: string;
    isHighlighted?: boolean;
    displayBoundaries?: boolean;
  };
  Blocks: {
    default: [];
    header: [];
  };
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
        <Header @label={{@label}} @title={{@title}}>
          {{yield to='header'}}
        </Header>
      {{/if}}

      {{yield}}
    </Tag>
  {{/let}}
  <style>
    .boxel-card-container {
      position: relative;
      background-color: var(--boxel-light);
      border-radius: var(--boxel-border-radius);
      transition:
        max-width var(--boxel-transition),
        box-shadow var(--boxel-transition);
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
