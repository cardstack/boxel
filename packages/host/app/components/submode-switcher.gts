import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { capitalize } from '@ember/string';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import get from 'lodash/get';
import {
  DropdownArrowUp,
  DropdownArrowDown,
  Eye,
  IconCode,
} from '@cardstack/boxel-ui/icons';

import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui/components';

import { menuItemFunc, MenuItem } from '@cardstack/boxel-ui/helpers';

export enum Submode {
  Interact = 'interact',
  Code = 'code',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    submode: Submode;
    onSubmodeSelect: (submode: Submode) => void;
  };
}

export default class SubmodeSwitcher extends Component<Signature> {
  <template>
    <div data-test-submode-switcher ...attributes>
      <BoxelDropdown @contentClass='submode-switcher-dropdown'>
        <:trigger as |bindings|>
          <Button
            class='submode-switcher-dropdown-trigger'
            aria-label='Options'
            {{on 'click' this.toggleDropdown}}
            {{bindings}}
          >
            {{#let (get this.submodeIcons @submode) as |SubmodeIcon|}}
              <SubmodeIcon width='18px' height='18px' />
            {{/let}}
            {{capitalize @submode}}
            <div
              class='arrow-icon'
              data-test-submode-arrow-direction={{if
                this.isExpanded
                'up'
                'down'
              }}
            >
              {{#if this.isExpanded}}
                <DropdownArrowUp width='22px' height='22px' />
              {{else}}
                <DropdownArrowDown width='22px' height='22px' />
              {{/if}}
            </div>
          </Button>
        </:trigger>
        <:content as |dd|>
          <Menu
            class='submode-switcher-dropdown-menu'
            @closeMenu={{dd.close}}
            @items={{this.buildMenuItems}}
          />
        </:content>
      </BoxelDropdown>
    </div>
    <style>
      :global(:root) {
        --submode-switcher-trigger-height: 2.5rem;
        --submode-switcher-dropdown-content-border-radius: 0 0
          var(--boxel-border-radius) var(--boxel-border-radius);
        --submode-switcher-dropdown-content-bg-color: rgba(0, 0, 0, 0.45);
        --submode-switcher-width: var(--operator-mode-left-column);
        --submode-switcher-height: 40px;
      }
      .submode-switcher-dropdown-trigger {
        --icon-color: var(--boxel-highlight);

        height: var(--submode-switcher-trigger-height);
        border: none;
        padding: var(--boxel-sp-xxs);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-dark);
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);

        position: relative;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        width: var(--submode-switcher-width);
        height: var(--submode-switcher-height);
        gap: var(--boxel-sp-sm);
      }
      .submode-switcher-dropdown-trigger[aria-expanded='true'] {
        border-bottom-right-radius: 0;
        border-bottom-left-radius: 0;
      }
      .arrow-icon {
        margin-left: auto;

        display: flex;
      }
      :global(.submode-switcher-dropdown) {
        --boxel-dropdown-content-border-radius: var(
          --submode-switcher-dropdown-content-border-radius
        );
        background-color: var(--submode-switcher-dropdown-content-bg-color);
      }
      .submode-switcher-dropdown-menu {
        width: var(--submode-switcher-width);
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);

        --icon-color: var(--boxel-light);
        --boxel-menu-border-radius: var(
          --submode-switcher-dropdown-content-border-radius
        );
        --boxel-menu-color: var(--submode-switcher-dropdown-content-bg-color);
        --boxel-menu-current-color: rgba(0, 0, 0, 0.3);
        --boxel-menu-item-gap: var(--boxel-sp-sm);
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
      }
    </style>
  </template>

  submodeIcons = {
    [Submode.Interact]: Eye,
    [Submode.Code]: IconCode,
  };
  @tracked isExpanded = false;

  @action
  toggleDropdown() {
    this.isExpanded = !this.isExpanded;
  }

  @action onSubmodeSelect(submode: Submode) {
    this.isExpanded = false;
    this.args.onSubmodeSelect(submode);
  }

  get buildMenuItems(): MenuItem[] {
    return Object.values(Submode)
      .filter((submode) => submode !== this.args.submode)
      .map((submode) =>
        menuItemFunc(
          [
            capitalize(submode),
            () => {
              this.onSubmodeSelect(submode);
            },
          ],
          {
            icon: this.submodeIcons[submode],
          },
        ),
      );
  }
}
