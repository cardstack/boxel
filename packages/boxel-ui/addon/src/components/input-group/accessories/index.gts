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
    data-test-boxel-input-group-button-accessory
    ...attributes
  >
    {{yield}}
  </BoxelButton>
  <style scoped>
    .accessory {
      border: 1px solid var(--boxel-input-group-border-color);
      border-radius: var(--boxel-input-group-border-radius);
      transition: border-color var(--boxel-transition);
      margin: 0;
      min-height: var(--boxel-input-group-height);
      outline-offset: 0;
    }

    .button-accessory {
      z-index: 2;
    }

    .button-accessory:focus {
      z-index: 5;
    }
  </style>
</template>;

interface IconButtonSignature {
  Args: Pick<BoxelIconButtonSignature['Args'], 'icon' | 'width' | 'height'>;
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement;
}

export const IconButton: TemplateOnlyComponent<IconButtonSignature> = <template>
  <BoxelIconButton
    class='accessory icon-button-accessory'
    @icon={{@icon}}
    @height={{@height}}
    @width={{@width}}
    data-test-boxel-input-group-icon-button-accessory
    ...attributes
  />
  <style scoped>
    .accessory {
      border: 1px solid var(--boxel-input-group-border-color);
      border-radius: var(--boxel-input-group-border-radius);
      transition: border-color var(--boxel-transition);
      margin: 0;
      min-height: var(--boxel-input-group-height);
      outline-offset: 0;
    }

    .icon-button-accessory {
      z-index: 2;
    }
  </style>
</template>;

interface TextSignature {
  Args: unknown;
  Blocks: { default: [] };
  Element: HTMLSpanElement;
}

export const Text: TemplateOnlyComponent<TextSignature> = <template>
  <span
    class='accessory text-accessory'
    data-test-boxel-input-group-text-accessory
    ...attributes
  >{{yield}}</span>
  <style scoped>
    .accessory {
      border: 1px solid var(--boxel-input-group-border-color);
      border-radius: var(--boxel-input-group-border-radius);
      transition: border-color var(--boxel-transition);
      margin: 0;
      min-height: var(--boxel-input-group-height);
      outline-offset: 0;
    }

    .text-accessory {
      align-items: center;
      background-color: var(--boxel-light);
      color: var(--boxel-purple-900);
      display: flex;
      font-size: var(--boxel-font-size-sm);
      line-height: var(--boxel-ratio);
      padding: var(--boxel-input-group-padding-y)
        var(--boxel-input-group-padding-x);
      text-align: center;
      white-space: nowrap;
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

// eslint-disable-next-line prettier/prettier
export const Select: TemplateOnlyComponent<SelectAccessorySignature> =
  <template>
    <div
      class={{cn
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
        border: 1px solid var(--boxel-input-group-border-color);
        border-radius: var(--boxel-input-group-border-radius);
        transition: border-color var(--boxel-transition);
        margin: 0;
        min-height: var(--boxel-input-group-height);
        outline-offset: 0;
      }

      .boxel-input-group__select-accessory {
        z-index: 2;
      }

      .boxel-input-group__select-accessory :deep(.boxel-select) {
        font: var(--boxel-button-font, var(--boxel-font-sm));
        font-weight: 600;
        padding: var(--boxel-sp-xs) var(--boxel-sp-xs) var(--boxel-sp-xs)
          var(--boxel-sp-xs);
      }

      .boxel-input-group__select-accessory
        :deep(.boxel-select .ember-power-select-placeholder) {
        font: var(--boxel-button-font, var(--boxel-font-sm));
        font-weight: 600;
      }
      .boxel-input-group__select-accessory
        :deep([aria-expanded='true'] .ember-power-select-status-icon) {
        transform: rotate(180deg);
      }

      .boxel-input-group__select-accessory--disabled {
        border-color: var(--boxel-input-group-border-color);
        color: rgb(0 0 0 / 50%);
        opacity: 0.5;
      }

      .boxel-input-group--invalid .boxel-input-group__select-accessory {
        border-color: var(--boxel-error-100);
      }

      .boxel-input-group__select-accessory
        :deep(.ember-power-select-status-icon) {
        position: relative;
      }

      :global(
        .boxel-input-group__select-accessory__dropdown
          .ember-power-select-option
      ) {
        font: var(--boxel-button-font, var(--boxel-font-sm));
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
