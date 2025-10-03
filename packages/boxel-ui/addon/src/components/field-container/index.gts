import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import element from '../../helpers/element.ts';
import { bool, eq, not, or } from '../../helpers/truth-helpers.ts';
import type { Icon } from '../../icons/types.ts';
import Label, { type BoxelLabelFontSize } from '../label/index.gts';

export interface Signature {
  Args: {
    centeredDisplay?: boolean;
    fieldId?: string;
    horizontalLabelSize?: string;
    icon?: Icon;
    iconHeight?: string;
    iconWidth?: string;
    label: string;
    labelFontSize?: BoxelLabelFontSize;
    tag?: keyof HTMLElementTagNameMap;
    vertical?: boolean;
  };
  Blocks: {
    default: [];
    label: [];
  };
  Element: HTMLElement;
}

const FieldContainer: TemplateOnlyComponent<Signature> = <template>
  {{#let (element @tag) as |Tag|}}
    <Tag
      class={{cn
        'boxel-field'
        vertical=(or @vertical @centeredDisplay)
        horizontal=(not (or @vertical @centeredDisplay))
        small-label=(eq @horizontalLabelSize 'small')
        centered-display=@centeredDisplay
        with-icon=(bool @icon)
      }}
      data-test-boxel-field
      data-test-boxel-field-id={{@fieldId}}
      ...attributes
    >
      <div class='label-container'>
        {{#if @icon}}
          <@icon
            class='boxel-field__icon'
            width={{unless @iconWidth '1rem'}}
            height={{unless @iconHeight '1rem'}}
            role='presentation'
          />
        {{/if}}
        <Label
          class='label'
          @size={{@labelFontSize}}
          data-test-boxel-field-label
        >
          {{@label}}
        </Label>
        {{yield to='label'}}
      </div>
      <div class='content'>
        {{yield}}
      </div>
    </Tag>
  {{/let}}
  <style scoped>
    @layer boxelComponentL2 {
      .boxel-field {
        --boxel-field-label-align: normal;
        --boxel-field-label-padding-top: 0;

        display: grid;
        width: 100%;
        max-width: 100%;
        overflow-wrap: break-word;
      }
      .label-container {
        align-items: start;
      }
      .with-icon .label-container {
        display: flex;
        gap: var(--boxel-sp-xs);
      }

      .centered-display {
        justify-items: center;
      }

      .small-label {
        --boxel-field-label-size: minmax(4rem, 10%);
      }

      .label {
        --boxel-label-letter-spacing: var(--boxel-lsp-xs);

        display: flex;
        align-items: var(--boxel-field-label-align);
        padding-top: var(--boxel-field-label-padding-top);
      }

      .boxel-field__icon {
        flex-shrink: 0;
      }

      .content {
        max-width: 100%;
        padding: var(
          --boxel-field-content-padding,
          var(--boxel-outline-width)
        ); /* necessary for our various overlays utilizing box-shadow */
        word-break: break-word;
      }

      .horizontal {
        grid-template-columns:
          var(--boxel-field-label-size, minmax(8rem, 25%))
          1fr;
        min-height: var(--boxel-form-control-height);
      }

      .horizontal > .label-container {
        padding-top: var(--boxel-sp-sm);
      }

      .horizontal > .content {
        align-self: center;
      }

      .vertical {
        grid-template-rows: auto 1fr;
        gap: var(--boxel-sp-4xs);
      }

      .vertical .label {
        grid-column: 2;
      }

      .boxel-field :deep(.boxel-field .boxel-label:not(.boxel-label--default)) {
        font-size: var(
          --boxel-field-label-font-size-small,
          var(--boxel-font-size-xs)
        );
        line-height: var(--boxel-field-label-line-height-small, calc(15 / 11));
      }
    }
  </style>
</template>;

export default FieldContainer;
