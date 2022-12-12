import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { concat } from '@ember/helper';
import { initStyleSheet, attachStyles } from '../attach-styles';

export interface Signature {
  Element: HTMLElement;
  Args: {
    label: string;
    display?: 'vertical' | 'horizontal' | 'horizontal-dense' | 'centered';
    fieldId?: string;
    icon?: string;
  };
  Blocks: {
    default: [],
  };
}

let styles = initStyleSheet(`
  .boxel-label {
    display: grid;
    gap: var(--boxel-sp-xs) 0;
  }

  .boxel-label--vertical {
    grid-template-rows: auto 1fr;
  }

  .boxel-label--centered {
    justify-items: center;
  }
  .boxel-label--centered > *:last-child {
    order: -1;
  }

  .boxel-label--horizontal {
    grid-template-columns: minmax(4rem, 25%) 1fr;
    gap: 0 var(--boxel-sp-lg);
  }

  .boxel-label--horizontal-dense {
    grid-template-columns: minmax(4rem, 10%) 1fr;
    gap: 0 var(--boxel-sp-lg);
  }

  .boxel-label__name {
    color: var(--boxel-purple-400);
    font: 600 var(--boxel-font-xs);
    letter-spacing: var(--boxel-lsp-xl);
    text-transform: uppercase;
    display: flex;
    align-items: var(--boxel-field-label-align);
    padding-top: var(--boxel-field-label-padding-top);
  }

  .boxel-label--with-icon {
    display: flex;
  }

  .boxel-label__icon {
    width: var(--boxel-icon-sm);
    height: var(--boxel-icon-sm);
    margin-right: var(--boxel-sp-xxs);
  }

  .boxel-label__yield--with-icon {
    width: 100%;
  }

  .boxel-label + .boxel-label {
    margin-top: var(--boxel-sp);
  }
`);

const Label: TemplateOnlyComponent<Signature> = <template>
  <label
    class="boxel-label {{if @display (concat "boxel-label--" @display) "boxel-label--vertical"}}"
    data-test-boxel-field
    data-test-boxel-field-id={{@fieldId}}
    {{attachStyles styles}}
    ...attributes
  >
    <span class="boxel-label__name" data-test-boxel-label-name>
      {{@label}}
    </span>

    {{#if @icon}}
      <div class="boxel-label--with-icon">
        <img src={{@icon}} class="boxel-label__icon" role="presentation" />
        <div class="boxel-label__yield--with-icon">
          {{yield}}
        </div>
      </div>
    {{else}}
      {{yield}}
    {{/if}}
  </label>
</template>;

export default Label;
