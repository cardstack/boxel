import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';
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
    default: [],
    header: [],
  };
}

let styles = initStyleSheet(`
  .boxel-card-container {
    position: relative;
    background-color: var(--boxel-light);
    border-radius: var(--boxel-border-radius);
    transition:
      max-width var(--boxel-transition),
      box-shadow var(--boxel-transition);
  }
  .boxel-card-container--boundaries {
    box-shadow: 0 0 0 1px var(--boxel-light-500);
  }
  .boxel-card-container--highlighted {
    box-shadow: 0 0 0 2px var(--boxel-highlight);
  }
`);

const CardContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag
      class={{cn
        "boxel-card-container"
        boxel-card-container--highlighted=@isHighlighted
        boxel-card-container--boundaries=@displayBoundaries
      }}
      {{attachStyles styles}}
      data-test-boxel-card-container
      ...attributes
    >
      {{#if (or (has-block "header") @label @title)}}
        <Header @label={{@label}} @title={{@title}}>
          {{yield to="header"}}
        </Header>
      {{/if}}

      {{yield}}
    </Tag>
  {{/let}}
</template>;

export default CardContainer;
