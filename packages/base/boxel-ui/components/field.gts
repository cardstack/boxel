import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { initStyleSheet, attachStyles } from '../../attach-styles';
import { concat } from '@ember/helper';
import { boxelCssVariables } from './boxel-css-variables';

export interface Signature {
  Element: HTMLElement;
  Args: {
    label: string;
    display?: 'vertical' | 'horizontal' | 'horizontal-dense' | 'centered';
    fieldId?: string;
    icon?: string;
  };
  Blocks: {
    'default': [],
  };
}

let styles = initStyleSheet(`
  this {
    ${boxelCssVariables};
  }

  .boxel-field {
    display: grid;
    gap: var(--boxel-sp-xs) 0;
  }

  .boxel-field--vertical {
    grid-template-rows: auto 1fr;
  }

  .boxel-field--centered {
    justify-items: center;
  }
  .boxel-field--centered > *:last-child {
    order: -1;
  }

  .boxel-field--horizontal {
    grid-template-columns: minmax(4rem, 25%) 1fr;
    gap: 0 var(--boxel-sp-lg);
  }

  .boxel-field--horizontal-dense {
    grid-template-columns: minmax(4rem, 10%) 1fr;
    gap: 0 var(--boxel-sp-lg);
  }

  .boxel-field__label {
    color: var(--boxel-purple-400);
    font: 600 var(--boxel-font-xs);
    letter-spacing: var(--boxel-lsp-xl);
    text-transform: uppercase;
    display: flex;
    align-items: var(--boxel-field-label-align);
    padding-top: var(--boxel-field-label-padding-top);
  }

  .boxel-field--with-icon {
    display: flex;
  }

  .boxel-field__icon {
    width: var(--boxel-icon-sm);
    height: var(--boxel-icon-sm);
    margin-right: var(--boxel-sp-xxs);
  }

  .boxel-field__yield--with-icon {
    width: 100%;
  }

  .boxel-field + .boxel-field {
    margin-top: var(--boxel-sp);
  }
`);

const BoxelField: TemplateOnlyComponent<Signature> = <template>
  <label
    class="boxel-field {{if @display (concat "boxel-field--" @display) "boxel-field--horizontal"}}"
    data-test-boxel-field
    data-test-boxel-field-id={{@fieldId}}
    {{attachStyles styles}}
    ...attributes
  >
    <span class="boxel-field__label" data-test-boxel-field-label>
      {{@label}}
    </span>

    {{#if @icon}}
      <div class="boxel-field--with-icon">
        <img src={{@icon}} class="boxel-field__icon" role="presentation" />
        <div class="boxel-field__yield--with-icon">
          {{yield}}
        </div>
      </div>
    {{else}}
      {{yield}}
    {{/if}}
  </label>
</template>;

export default BoxelField;
