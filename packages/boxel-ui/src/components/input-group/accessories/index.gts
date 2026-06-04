import type { TemplateOnlyComponent } from '@ember/component/template-only';
import type { ComponentLike } from '@glint/template';

import cn from '../../../helpers/cn.ts';
import setCssVar from '../../../modifiers/set-css-var.ts';
import BoxelButton, { type BoxelButtonKind } from '../../button/index.gts';
import BoxelIconButton, {
  type Signature as BoxelIconButtonSignature,
} from '../../icon-button/index.gts';
import BoxelSelect, { type BoxelSelectArgs } from '../../select/index.gts';

interface ButtonSignature {
  Args: {
    disabled?: boolean;
    kind?: BoxelButtonKind;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

export const Button: TemplateOnlyComponent<ButtonSignature> = <template>
  <BoxelButton
    class='accessory button-accessory'
    @kind={{@kind}}
    @disabled={{@disabled}}
    data-test-boxel-input-group-button-accessory
    ...attributes
  >
    {{yield}}
  </BoxelButton>
</template>;

interface IconButtonSignature {
  Args: Pick<
    BoxelIconButtonSignature['Args'],
    'icon' | 'width' | 'height' | 'disabled'
  >;
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement | HTMLAnchorElement;
}

export const IconButton: TemplateOnlyComponent<IconButtonSignature> = <template>
  <BoxelIconButton
    class='accessory icon-button-accessory'
    @icon={{@icon}}
    @height={{@height}}
    @width={{@width}}
    @disabled={{@disabled}}
    data-test-boxel-input-group-icon-button-accessory
    ...attributes
  />
</template>;

interface TextSignature {
  Args: unknown;
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

export const Text: TemplateOnlyComponent<TextSignature> = <template>
  <span
    class='text-accessory'
    data-test-boxel-input-group-text-accessory
    ...attributes
  >{{yield}}</span>
  <style scoped>
    @layer boxelComponentL1 {
      .text-accessory {
        align-items: center;
        color: var(--muted-foreground, var(--boxel-700));
        display: flex;
        font-size: var(--boxel-font-size-sm);
        padding: var(--boxel-input-group-padding-y)
          var(--boxel-input-group-padding-x);
        text-align: center;
        white-space: nowrap;
      }
    }
  </style>
</template>;

interface SelectAccessorySignature<ItemT = any> {
  Args: BoxelSelectArgs<ItemT>;
  Blocks: {
    default: [ItemT];
  };
  Element: HTMLElement;
}

export const Select: TemplateOnlyComponent<SelectAccessorySignature> =
  <template>
    <div
      class={{cn
        'accessory'
        'boxel-input-group__accessory'
        'boxel-input-group__select-accessory'
        boxel-input-group__select-accessory--disabled=@disabled
      }}
      data-test-boxel-input-group-select-accessory
      {{setCssVar boxel-form-control-border-color='transparent'}}
    >
      <BoxelSelect
        @disabled={{@disabled}}
        @dropdownClass={{cn
          'boxel-input-group__select-accessory__dropdown'
          @dropdownClass
        }}
        @placeholder={{@placeholder}}
        @options={{@options}}
        @searchField={{@searchField}}
        @searchEnabled={{@searchEnabled}}
        @selected={{@selected}}
        @onChange={{@onChange}}
        @onBlur={{@onBlur}}
        @matchTriggerWidth={{@matchTriggerWidth}}
        @selectedItemComponent={{@selectedItemComponent}}
        data-test-boxel-input-group-select-accessory-trigger
        ...attributes
        as |item|
      >
        {{#if (has-block)}}
          {{yield item}}
        {{else}}
          <div>{{item}}</div>
        {{/if}}
      </BoxelSelect>
    </div>
    <style scoped>
      .boxel-input-group__accessory {
        background: none;
        border: none;
        border-radius: 0;
        margin: 0;
        min-height: var(--boxel-input-group-height);
        outline-offset: 0;
      }

      .boxel-input-group__select-accessory {
        z-index: 2;
      }

      .boxel-input-group__select-accessory :deep(.boxel-select) {
        min-height: inherit;
        background: none;
        border: none;
        font-weight: 600;
        outline-offset: 0px;
      }

      .boxel-input-group__select-accessory
        :deep(.boxel-select .ember-power-select-placeholder) {
        font-weight: 600;
      }
      .boxel-input-group__select-accessory
        :deep([aria-expanded='true'] .ember-power-select-status-icon) {
        transform: rotate(180deg);
      }

      .boxel-input-group__select-accessory--disabled {
        opacity: 0.5;
      }

      .boxel-input-group--invalid .boxel-input-group__select-accessory {
        border-color: var(--destructive, var(--boxel-error-100));
      }

      .boxel-input-group__select-accessory
        :deep(.ember-power-select-status-icon) {
        position: relative;
      }

      :global(
        .boxel-input-group__select-accessory__dropdown
          .ember-power-select-option
      ) {
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs) var(--boxel-sp-xs)
          var(--boxel-sp-xs);
      }
    </style>
  </template>;

export interface AccessoriesBlockArg {
  Button: ComponentLike<ButtonSignature>;
  IconButton: ComponentLike<IconButtonSignature>;
  Select: ComponentLike<SelectAccessorySignature>;
  Text: ComponentLike<TextSignature>;
}
