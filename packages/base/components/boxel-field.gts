import GlimmerComponent from '@glimmer/component';
import { initStyleSheet, attachStyles } from '../attach-styles';
// import type { TemplateOnlyComponent } from '@ember/component/template-only';
// import cn from '@cardstack/boxel/helpers/cn';
// import element from 'ember-element-helper/helpers/element';
// import eq from 'ember-truth-helpers/helpers/eq';
// import not from 'ember-truth-helpers/helpers/not';
// import or from 'ember-truth-helpers/helpers/or';
// import { svgJar } from '@cardstack/boxel/utils/svg-jar';

export interface Signature {
  Element: HTMLElement;
  Args: {
    // tag?: keyof HTMLElementTagNameMap;
    // centeredDisplay?: boolean;
    fieldId?: string;
    label: string;
    // horizontalLabelSize?: string;
    icon?: string;
    // vertical?: boolean;
  };
  Blocks: {
    'default': [],
  };
}

let styles = initStyleSheet(`
  this {
    --boxel-sp-xs: 1em;
    --boxel-lsp-xl: 0.05em;
    --boxel-purple-400: #6b6a80;
    --boxel-font-size-xs: 0.6875rem;
    --boxel-font-family: "Open Sans", helvetica, arial, sans-serif;
    --boxel-font-xs: var(--boxel-font-size-xs)/calc(15 / 11) var(--boxel-font-family);

    --boxel-field-label-align: normal;
    --boxel-field-label-padding-top: 0;

    display: grid;
    gap: var(--boxel-sp-xs) 0;
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
`);

// const DIV: keyof HTMLElementTagNameMap = "div";
export default class BoxelField extends GlimmerComponent<Signature> {
  <template>
    {{!-- {{#let (or @tag DIV) as |tag|}} --}}
      {{!-- {{#let (element tag) as |Tag|}} --}}
        <div
          {{!-- class={{cn "boxel-field"
            boxel-field--vertical=(or @vertical @centeredDisplay)
            boxel-field--horizontal=(not (or @vertical @centeredDisplay))
            boxel-field--small-label=(eq @horizontalLabelSize "small")
            boxel-field--centered-display=@centeredDisplay
          }} --}}
          data-test-boxel-field
          data-test-boxel-field-id={{@fieldId}}
          {{attachStyles styles}}
          ...attributes
        >
          <div class="boxel-field__label" data-test-boxel-field-label>
            <span>{{@label}}</span>
          </div>

          {{#if @icon}}
            <div class="boxel-field--with-icon">
              {{!-- {{svgJar @icon class="boxel-field__icon" role="presentation"}} --}}
              <div class="boxel-field__yield--with-icon">
                {{yield}}
              </div>
            </div>
          {{else}}
            {{yield}}
          {{/if}}
        </div>
      {{!-- {{/let}} --}}
    {{!-- {{/let}} --}}
  </template>
}
