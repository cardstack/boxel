import type { TemplateOnlyComponent } from '@ember/component/template-only';

import cn from '../../helpers/cn.ts';
import element from '../../helpers/element.ts';
import { bool, eq, not, or } from '../../helpers/truth-helpers.ts';
import type { Icon } from '../../icons/types.ts';
import Label from '../label/index.gts';

export interface Signature {
  Args: {
    centeredDisplay?: boolean;
    fieldId?: string;
    horizontalLabelSize?: string;
    icon?: Icon;
    label: string;
    tag?: keyof HTMLElementTagNameMap;
    vertical?: boolean;
  };
  Blocks: {
    default: [];
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
          <@icon class='boxel-field__icon' role='presentation' />
        {{/if}}
        <Label class='label' data-test-boxel-field-label>
          {{@label}}
        </Label>
      </div>
      <div class='content'>
        {{yield}}
      </div>
    </Tag>
  {{/let}}
  <style scoped>
    .boxel-field {
      --boxel-field-label-align: normal;
      --boxel-field-label-padding-top: 0;

      display: grid;
      overflow-wrap: anywhere;
    }
    .label-container {
      align-items: start;
    }
    .with-icon .label-container {
      display: flex;
      gap: var(--boxel-sp-xs);
    }
    .vertical {
      grid-template-rows: auto 1fr;
    }
    .vertical .label {
      --boxel-label-font: 600 var(--boxel-font-xs);
      grid-column: 2;
    }

    .centered-display {
      justify-items: center;
    }

    .horizontal {
      grid-template-columns: var(--boxel-field-label-size, minmax(4rem, 25%)) 1fr;
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

    :deep(.boxel-field__icon) {
      width: var(--boxel-icon-xs);
      height: var(--boxel-icon-xs);
      flex-shrink: 0;
    }

    .vertical.with-icon:not(.centered-display) .content {
      padding-left: calc(var(--boxel-icon-xs) + var(--boxel-sp-xs));
    }
  </style>
</template>;

export default FieldContainer;
