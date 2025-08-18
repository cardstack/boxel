import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import cn from '../../helpers/cn.ts';
import type { MenuDivider } from '../../helpers/menu-divider.ts';
import type { MenuItem } from '../../helpers/menu-item.ts';
import { ThreeDotsHorizontal } from '../../icons.gts';
import BoxelButton from '../button/index.gts';
import Dropdown from '../dropdown/index.gts';
import IconButton from '../icon-button/index.gts';
import Menu from '../menu/index.gts';

interface Signature {
  Args: {
    menuItems: (MenuItem | MenuDivider)[];
    onDeselectAll: () => void;
    onSelectAll: () => void;
    selectedCount: number;
    totalCount: number;
  };
  Blocks: {
    default: [];
    menu: [{ close: () => void }];
  };
  Element: HTMLDivElement;
}

export default class SelectionSummary extends Component<Signature> {
  @tracked dropdownApi: unknown;

  get hasSelection() {
    return this.args.selectedCount > 0;
  }

  get hasPartialSelection() {
    return this.hasSelection && this.args.selectedCount < this.args.totalCount;
  }

  get selectionAriaPressed(): 'true' | 'false' | 'mixed' {
    if (this.hasPartialSelection) {
      return 'mixed';
    }
    return this.hasSelection ? 'true' : 'false';
  }

  get selectionAriaLabel() {
    if (this.hasSelection) {
      // Communicate current count to assistive tech
      return `${this.args.selectedCount} selected. Deselect all`;
    }
    return 'Select all';
  }

  @action toggleSelect() {
    if (this.hasSelection) {
      this.args.onDeselectAll?.();
    } else {
      this.args.onSelectAll?.();
    }
  }

  <template>
    <div class='boxel-selection-summary' ...attributes>
      <button
        class={{cn
          'selection-circle'
          selection-circle--selected=this.hasSelection
          selection-circle--partial=this.hasPartialSelection
        }}
        type='button'
        aria-pressed={{this.selectionAriaPressed}}
        aria-label={{this.selectionAriaLabel}}
        {{on 'click' this.toggleSelect}}
      ></button>

      {{#if this.hasSelection}}
        <Dropdown @autoClose={{true}}>
          <:trigger as |ddModifier|>
            <div class='buttonesque'>
              <span>
                {{@selectedCount}}
                Selected
              </span>
              <IconButton
                class='summary-overflow'
                aria-label='Selection actions'
                @icon={{ThreeDotsHorizontal}}
                @width='24'
                @height='24'
                {{ddModifier}}
              />
            </div>
          </:trigger>
          <:content as |dd|>
            <Menu @items={{@menuItems}} @closeMenu={{dd.close}} />
          </:content>
        </Dropdown>
      {{else}}
        <BoxelButton {{on 'click' this.toggleSelect}} class='select-all-button'>
          Select All
        </BoxelButton>
      {{/if}}
    </div>

    <style scoped>
      .boxel-selection-summary {
        display: inline-flex;
        align-items: center;
        gap: var(--boxel-sp-xxs);
      }

      .selection-circle {
        border: 2px solid var(--boxel-dark);
        border-radius: 50%;
        width: 18px;
        height: 18px;
        background: transparent;
      }

      .selection-circle--selected {
        background: var(--boxel-highlight);
      }

      .selection-circle--partial {
        background: linear-gradient(
          90deg,
          var(--boxel-highlight) 50%,
          var(--boxel-dark) 50%
        );
      }

      .select-all-button {
        padding: var(--boxel-sp-xxxs) var(--boxel-sp);
      }

      .buttonesque {
        --boxel-icon-button-width: 40px;
        --boxel-icon-button-height: 20px;

        display: flex;
        gap: var(--boxel-sp);
        box-sizing: border-box;
        justify-content: center;
        height: min-content;
        align-items: center;
        border-radius: 100px;
        transition:
          background-color var(--boxel-transition),
          border var(--boxel-transition);
        border: 1px solid var(--boxel-button-border-color);
        color: var(--boxel-dark);
        background-color: transparent;
        font: 600 var(--boxel-font-sm);
        min-height: var(--boxel-button-min-height);
        min-width: var(--boxel-button-min-width, 5rem);
        padding: var(--boxel-sp-xxxs) var(--boxel-sp);
        letter-spacing: var(--boxel-lsp);
      }
      .buttonesque:hover {
        border: 1px solid var(--boxel-dark);
      }
    </style>
  </template>
}

declare module '@glint/environment-ember-loose/registry' {
  export default interface Registry {
    'Boxel::SelectionSummary': typeof SelectionSummary;
  }
}
