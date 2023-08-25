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
            class='trigger'
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
            class='menu'
            @closeMenu={{dd.close}}
            @items={{this.buildMenuItems}}
          />
        </:content>
      </BoxelDropdown>
    </div>
    <style>
      .trigger {
        border: none;
        padding: var(--boxel-sp-xs);
        border-radius: var(--boxel-border-radius);
        background: var(--boxel-purple-700);
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);

        position: relative;
        display: flex;
        justify-content: flex-start;
        align-items: center;
        width: 190px;
        gap: var(--boxel-sp-sm);

        --icon-color: var(--boxel-cyan);
      }
      .arrow-icon {
        margin-left: auto;

        display: flex;
      }
      :global(.submode-switcher-dropdown) {
        background: none;
      }
      .menu {
        border-radius: var(--boxel-border-radius);
        width: 190px;
        color: var(--boxel-light);
        font: 500 var(--boxel-font-sm);

        --icon-color: var(--boxel-light);
        --boxel-menu-color: rgba(0, 0, 0, 0.45);
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
