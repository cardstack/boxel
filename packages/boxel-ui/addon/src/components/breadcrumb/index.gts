import { BoxelButton } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { CaretRight, Slash } from '@cardstack/boxel-ui/icons';
import type { TemplateOnlyComponent } from '@ember/component/template-only';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

import type {
  BoxelButtonSize as BreadcrumbItemSize,
  Signature as BoxelButtonSignature,
} from '../button/index.gts';
import BoxelIconButton from '../icon-button/index.gts';
import { concat } from '@ember/helper';

export type BoxelSeparatorVariant = 'caretRight' | 'slash';

interface BreadcrumbSignature {
  Args: {
    breadcrumbItemSize?: BreadcrumbItemSize;
    separatorVariant?: BoxelSeparatorVariant;
  };
  Blocks: {
    default: [ComponentLike<BoxelButtonSignature>];
  };
  Element: HTMLDivElement;
}

export default class Breadcrumb extends Component<BreadcrumbSignature> {
  <template>
    <div class='breadcrumb-list' data-test-breadcrumb-list>
      {{yield (component BreadcrumbItem size=@breadcrumbItemSize)}}
    </div>
    <style>
      .breadcrumb-list {
        --boxel-button-border-color: transparent;
        --breadcrumb-button-min-width: 0px;
        --breadcrumb-button-min-height: 0px;
        --breadcrumb-button-padding: 0px;
        --breadcrumb-button-text-color: var(
          --boxel-button-text-color,
          var(--boxel-teal)
        );
        --breadcrumb-button-text-highlight-color: var(
          --boxel-button-text-highlight-color,
          var(--boxel-400)
        );
        --breadcrumb-icon-color: var(
          --boxel-breadcrumb-icon-color,
          var(--boxel-400)
        );
        --breadcrumb-icon-button-width: var(
          --boxel-breadcrumb-icon-width,
          14px
        );
        --breadcrumb-icon-button-height: var(
          --boxel-breadcrumb-icon-height,
          14px
        );
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-sm);
        align-items: center;
        list-style: none;
      }
    </style>
  </template>
}

interface BreadcrumbItemSignature {
  Args: BoxelButtonSignature['Args'] & {
    isSelected?: boolean; // 添加这一行
  };
  Blocks: {
    default: [];
  };
  Element: BoxelButtonSignature['Element'];
}

export const BreadcrumbItem: TemplateOnlyComponent<BreadcrumbItemSignature> =
  <template>
    <BoxelButton
      @href={{@href}}
      @size={{@size}}
      @kind='text-only'
      @disabled={{@disabled}}
      class={{concat 'breadcrumb-item' (if @isSelected ' is-selected')}}
      ...attributes
    >
      {{yield}}
    </BoxelButton>

    <style>
      .breadcrumb-item {
        color: var(--breadcrumb-button-text-color);
        padding: var(--breadcrumb-button-padding);
        min-width: var(--breadcrumb-button-min-width);
        min-height: var(--breadcrumb-button-min-height);
      }
      .breadcrumb-item.is-selected {
        color: var(--breadcrumb-button-text-highlight-color);
      }
      .breadcrumb-item:hover:not(:disabled) {
        filter: brightness(70%);
      }
    </style>
  </template>;

interface SeparatorSignature {
  Args: {
    variant: BoxelSeparatorVariant;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

export const BreadcrumbSeparator: TemplateOnlyComponent<SeparatorSignature> =
  <template>
    <div class='breadcrumb-separator'>
      {{#if (eq @variant 'slash')}}
        <BoxelIconButton @icon={{Slash}} class='breadcrumb-separator-icon' />
      {{else}}
        <BoxelIconButton
          @icon={{CaretRight}}
          class='breadcrumb-separator-icon'
        />
      {{/if}}
    </div>

    <style>
      .breadcrumb-separator {
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100%;
      }
      .breadcrumb-separator svg {
        --boxel-icon-button-width: var(--breadcrumb-icon-button-width);
        --boxel-icon-button-height: var(--breadcrumb-icon-button-height);
        --icon-color: var(--breadcrumb-icon-color);
        width: var(--boxel-icon-button-width);
        height: var(--boxel-icon-button-height);
      }
      .breadcrumb-separator-icon {
        --boxel-icon-button-width: auto !important;
        --boxel-icon-button-height: auto !important;
        display: flex;
        align-items: center;
        justify-content: center;
      }
    </style>
  </template>;
