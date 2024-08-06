import { TemplateOnlyComponent } from '@ember/component/template-only';

import { Label } from '@cardstack/boxel-ui/components';
import { cn } from '@cardstack/boxel-ui/helpers';

interface Signature {
  Element: HTMLElement;
  Args: {
    label: string;
    isCompact: boolean;
  };
  Blocks: {
    default: [];
  };
}
let ResultsSection: TemplateOnlyComponent<Signature> = <template>
  <div class={{cn 'section' is-compact=@isCompact}}>
    <Label data-test-search-label>{{@label}}</Label>
    <div class='section__body'>
      <div class='section__cards'>
        {{yield}}
      </div>
    </div>
  </div>
  <style>
    .section {
      display: flex;
      flex-direction: column;
      width: 100%;
    }
    .section .boxel-label {
      font: 700 var(--boxel-font);
      padding-right: var(--boxel-sp);
    }
    .section__body {
      overflow: auto;
    }
    .section__cards {
      display: flex;
      flex-direction: row;
      flex-wrap: wrap;
      padding: var(--boxel-sp) var(--boxel-sp-xxxs);
      gap: var(--boxel-sp);
    }
    .section.is-compact {
      flex-direction: row;
      align-items: center;
      height: 100%;
    }
    .is-compact .section__cards {
      display: flex;
      flex-wrap: nowrap;
      padding: var(--boxel-sp-xxs);
      gap: var(--boxel-sp-xs);
    }
  </style>
</template>;

export default ResultsSection;
