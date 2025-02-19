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

    :deep(.boxel-field__icon) {
      width: var(--boxel-icon-xs);
      height: var(--boxel-icon-xs);
      flex-shrink: 0;
    }

    .content {
      max-width: 100%;
      overflow: hidden;
      padding: var(
        --boxel-field-content-padding,
        var(--boxel-outline-width)
      ); /* necessary for our various overlays utilizing box-shadow */
    }

    .horizontal {
      grid-template-columns:
        var(--boxel-field-label-size, minmax(8rem, 25%))
        1fr;
    }

    .horizontal > .label-container {
      padding-top: var(--boxel-sp-sm);
    }

    .horizontal > .content {
      min-height: var(--boxel-form-control-height);
      display: flex;
      align-items: center;
    }
    /* TODO: refactor field-container so it doesn't impose flex on field contents */
    .horizontal
      > .content
      > :deep(*):not(.ember-basic-dropdown-trigger):not(
        .realm-dropdown-trigger
      ) {
      flex: 1;
    }

    .vertical {
      --boxel-label-font: 600 var(--boxel-font-xs);
      grid-template-rows: auto 1fr;
    }

    .vertical .label {
      grid-column: 2;
      line-height: 1rem;
      margin-bottom: var(--boxel-sp-4xs);
    }

    .vertical.with-icon:not(.centered-display) .content {
      padding-left: calc(var(--boxel-icon-xs) + var(--boxel-sp-xs));
    }
  </style>
</template>;

export default FieldContainer;
