import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';
// import cn from '@cardstack/boxel/helpers/cn';
import BoxelHeader from './header';

interface Signature {
  Element: HTMLElement;
  Args: {
    header?: string;
    isHighlighted?: boolean;
    displayBoundaries?: boolean;
  };
  Blocks: {
    'default': [],
    'header': [],
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
  <article
    class="boxel-card-container {{if @displayBoundaries "boxel-card-container--boundaries"}}"
    {{!-- class={{cn
      "boxel-card-container"
      boxel-card-container--highlighted=@isHighlighted
      boxel-card-container--boundaries=@displayBoundaries
    }} --}}
    {{attachStyles styles}}
    data-test-boxel-card-container
    ...attributes
  >
    {{#if (has-block "header")}}
      <BoxelHeader @header={{@header}}>
        {{yield to="header"}}
      </BoxelHeader>
    {{/if}}

    {{yield}}
  </article>
</template>;

export default CardContainer;
