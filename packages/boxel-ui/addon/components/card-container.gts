import type { TemplateOnlyComponent } from '@ember/component/template-only';
import element from '../helpers/element';
import cn from '../helpers/cn';
import { or } from '../helpers/truth-helpers';
import Header from './header';

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
        boxel-card-container--highlighted=@isHighlighted
        boxel-card-container--boundaries=@displayBoundaries
      }}
      data-test-boxel-card-container
      ...attributes
    >
      {{#if (or (has-block 'header') @label @title)}}
        <Header @label={{@label}} @title={{@title}}>
          {{yield to='header'}}
        </Header>
      {{/if}}

      {{yield}}
    </Tag>
  {{/let}}
</template>;

export default CardContainer;
