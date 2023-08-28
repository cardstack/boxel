import Component from '@glimmer/component';
import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { menuItemFunc, MenuItem } from '@cardstack/boxel-ui/helpers/menu-item';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { capitalize } from '@ember/string';
import get from 'lodash/get';

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
            {{svgJar
              (get this.submodeIcons @submode)
              width='18px'
              height='18px'
            }}
            {{capitalize @submode}}
            <div class='arrow-icon'>
              {{svgJar
                (if this.isExpanded 'dropdown-arrow-up' 'dropdown-arrow-down')
                width='22px'
                height='22px'
              }}
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
        width: 190px;
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
        width: 190px;
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
    [Submode.Interact]: 'eye',
    [Submode.Code]: 'icon-code',
  };
  @tracked isExpanded = false;

  @action
  toggleDropdown() {
    this.isExpanded = !this.isExpanded;
  }

  get buildMenuItems(): MenuItem[] {
    return Object.values(Submode)
      .filter((submode) => submode !== this.args.submode)
      .map((submode) =>
        menuItemFunc(
          [capitalize(submode), () => this.args.onSubmodeSelect(submode)],
          {
            icon: this.submodeIcons[submode],
          },
        ),
      );
  }
}
