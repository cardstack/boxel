import { fn } from '@ember/helper';
import Component from '@glimmer/component';
import type { ComponentLike } from '@glint/template';

import cn from '../../helpers/cn.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import {
  Card as CardIcon,
  Grid3x3 as GridIcon,
  Rows4 as StripIcon,
} from '../../icons.gts';
import RadioInput from '../radio-input/index.gts';

export interface ViewItem {
  disabled?: boolean;
  icon: ComponentLike;
  id: string;
}

interface Signature {
  Args: {
    disabled?: boolean;
    items?: ViewItem[];
    onChange: (id: string) => void;
    selectedId: string | undefined;
  };
  Blocks: { default: [] };
  Element: HTMLDivElement;
}

export const VIEW_OPTIONS: ViewItem[] = [
  { id: 'card', icon: CardIcon },
  { id: 'strip', icon: StripIcon },
  { id: 'grid', icon: GridIcon },
];

export default class ViewSelector extends Component<Signature> {
  private get viewOptions() {
    return this.args.items ?? VIEW_OPTIONS;
  }

  private get selectedId() {
    return this.args.selectedId ?? this.viewOptions[0]?.id;
  }

  <template>
    <div class={{cn 'view-options-group' is-disabled=@disabled}} ...attributes>
      {{! TODO: refactor styling of RadioInput component to display legend instead of repeating it here }}
      <span class='view-options-label'>View as</span>
      <RadioInput
        class='view-options'
        @groupDescription='View as'
        @name='view-options'
        @items={{this.viewOptions}}
        @spacing='compact'
        @hideRadio={{true}}
        @hideBorder={{true}}
        as |item|
      >
        {{#let item.data.id as |id|}}
          <item.component
            class={{cn 'view-option' is-selected=(eq this.selectedId id)}}
            @checked={{eq this.selectedId id}}
            @onChange={{fn @onChange id}}
            @disabled={{if @disabled @disabled item.data.disabled}}
            aria-label={{id}}
          >
            <item.data.icon
              width='20'
              height='20'
              alt={{id}}
              role='presentation'
            />
          </item.component>
        {{/let}}
      </RadioInput>
    </div>
    <style scoped>
      @layer {
        .view-options-group {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          column-gap: var(
            --boxel-view-option-group-column-gap,
            var(--boxel-sp-sm)
          );
          row-gap: var(--boxel-view-option-group-row-gap);
          text-wrap: nowrap;
        }
        .view-options-label {
          font-weight: 500;
        }
        .view-options {
          display: flex;
          column-gap: var(--boxel-view-option-column-gap, var(--boxel-sp-6xs));
          row-gap: var(--boxel-view-option-row-gap);
        }
        .view-option {
          display: flex;
          background-color: var(--boxel-view-option-background, transparent);
          color: var(
            --boxel-view-option-foreground,
            color-mix(
              in oklab,
              var(--foreground, var(--boxel-dark)) 42%,
              transparent
            )
          );
          border-radius: var(
            --boxel-view-option-radius,
            var(--boxel-border-radius-sm)
          );
          box-shadow: var(--boxel-view-option-shadow, none);
          transition: var(--boxel-view-option-transition, none);
          flex-shrink: 0;
        }
        .view-options > :deep(div),
        .view-option > :deep(div) {
          display: contents;
        }
        .view-option:not(:has(:disabled)):hover {
          background-color: var(
            --boxel-view-option-hover-background,
            transparent
          );
          color: var(--boxel-view-option-hover-foreground, var(--foreground));
        }
        .view-option.is-selected {
          background-color: var(
            --boxel-view-option-selected-background,
            transparent
          );
          color: var(
            --boxel-view-option-selected-foreground,
            var(--foreground, var(--boxel-dark))
          );
        }
        .view-option.is-selected:hover {
          background-color: var(
            --boxel-view-option-selected-hover-background,
            transparent
          );
          color: var(
            --boxel-view-option-selected-hover-foreground,
            color-mix(
              in oklab,
              var(--foreground, var(--boxel-dark)) 90%,
              transparent
            )
          );
        }
        .view-option:focus-within:has(input:focus-visible) {
          outline: 2px solid var(--ring, var(--boxel-highlight));
        }
        .view-option:has(:disabled) {
          opacity: 0.5;
          pointer-events: none;
        }
        .is-disabled {
          opacity: 0.5;
        }
      }
    </style>
  </template>
}
