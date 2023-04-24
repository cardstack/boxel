import type { TemplateOnlyComponent } from '@ember/component/template-only';
import cn from '../../helpers/cn';
import element from '../../helpers/element';
import { eq, not, or } from '../../helpers/truth-helpers';
import { svgJar } from '../../helpers/svg-jar';
import Label from '../label';

export interface Signature {
  Element: HTMLElement;
  Args: {
    tag?: keyof HTMLElementTagNameMap;
    centeredDisplay?: boolean;
    fieldId?: string;
    label: string;
    horizontalLabelSize?: string;
    icon?: string;
    vertical?: boolean;
  };
  Blocks: {
    default: [];
  };
}

const FieldContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag
      class={{cn
        'boxel-field'
        boxel-field--vertical=(or @vertical @centeredDisplay)
        boxel-field--horizontal=(not (or @vertical @centeredDisplay))
        boxel-field--small-label=(eq @horizontalLabelSize 'small')
        boxel-field--centered-display=@centeredDisplay
      }}
      data-test-boxel-field
      data-test-boxel-field-id={{@fieldId}}
      ...attributes
    >
      <Label class='boxel-field__label' data-test-boxel-field-label>
        {{@label}}
      </Label>

      {{#if @icon}}
        <div class='boxel-field--with-icon'>
          {{svgJar @icon class='boxel-field__icon' role='presentation'}}
          <div class='boxel-field__yield--with-icon'>
            {{yield}}
          </div>
        </div>
      {{else}}
        {{yield}}
      {{/if}}
    </Tag>
  {{/let}}

  <style>
    .boxel-field {
      --boxel-field-label-align: normal;
      --boxel-field-label-justify-content: normal;
      --boxel-field-label-padding-top: 0;

      display: grid;
      gap: var(--boxel-sp-xs) 0;
    }

    .boxel-field--vertical {
      grid-template-rows: auto 1fr;
    }

    .boxel-field--centered-display {
      justify-items: center;
    }

    .boxel-field--centered-display > *:last-child {
      order: -1;
    }

    .boxel-field--horizontal {
      grid-template-columns: var(--boxel-field-label-size, minmax(4rem, 25%)) 1fr;
      gap: 0 var(--boxel-sp-lg);
    }

    .boxel-field--small-label {
      --boxel-field-label-size: minmax(4rem, 10%);
    }

    .boxel-field__label {
      color: var(--boxel-purple-400);
      font: 600 var(--boxel-font-xs);
      letter-spacing: var(--boxel-lsp-xl);
      text-transform: uppercase;
      display: flex;
      align-items: var(--boxel-field-label-align);
      justify-content: var(--boxel-field-label-justify-content);
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

    .boxel-field--vertical + .boxel-field--vertical {
      margin-top: var(--boxel-sp);
    }
  </style>
</template>;

export default FieldContainer;
