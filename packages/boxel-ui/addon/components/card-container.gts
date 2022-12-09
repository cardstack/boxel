import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../attach-styles';

import BoxelHeader from './header';

interface Signature {
  Element: HTMLElement;
  Args: {
    header?: string;
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
    --boxel-field-label-align: center;
    border: 1px solid gray;
    border-radius: 10px;
    background-color: #fff;
    padding: 1rem;
  }
`);

const CardContainer: TemplateOnlyComponent<Signature> = <template>
  <div
    class="boxel-card-container"
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
  </div>
</template>;
export default CardContainer;
