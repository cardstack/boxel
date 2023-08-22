import Component from '@glimmer/component';
import { BoxelDropdown, Button, Menu } from '@cardstack/boxel-ui';
import { svgJar } from '@cardstack/boxel-ui/helpers/svg-jar';
import { menuItemFunc, MenuItem } from '@cardstack/boxel-ui/helpers/menu-item';
import { action } from '@ember/object';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';

export enum Submode {
  INTERACT = 'Interact',
  CODE = 'Code',
}

interface Signature {
  Element: HTMLElement;
  Args: {
    submode?: Submode;
    onSubmodeSelect?: (submode: Submode) => void;
  };
}

export default class SubmodeSwitcher extends Component<Signature> {
  <template>
    <div
      class='submode-switcher' 
      data-test-submode-switcher
      ...attributes>
      <BoxelDropdown
        @contentClass='submode-switcher__content'>
        <:trigger as |bindings|>
          <Button
            class='trigger'
            aria-label='Options'
            {{on 'click' this.toogleDropdown}}
            {{bindings}}
          >
            {{svgJar this.selectedSubmodeIcon width='18px' height='18px'}}
            {{this.selectedSubmode}}
            <div class='arrow-icon'>
              {{svgJar (if this.isExpanded 'dropdown-arrow-up' 'dropdown-arrow-down') width='22px' height='22px'}}
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
      .submode-switcher {
        position: absolute;
        top: 0;
        left: 0;

        padding: var(--boxel-sp);
      }
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
      :global(.submode-switcher__content) {
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
    [Submode.INTERACT]: 'eye',
    [Submode.CODE]: 'icon-code',
  };
  @tracked selectedSubmode: Submode = this.args.submode ?? Submode.INTERACT;
  @tracked isExpanded = false;

  @action
  toogleDropdown() {
    this.isExpanded = !this.isExpanded;
  }

  get buildMenuItems(): MenuItem[] {
    return Object.values(Submode).map((submode) =>
      menuItemFunc([submode, () => this.select(submode)], {
        icon: this.submodeIcons[submode],
      }),
    );
  }

  get selectedSubmodeIcon() {
    return this.submodeIcons[this.selectedSubmode];
  }

  @action
  select(submode: Submode) {
    if (this.selectedSubmode === submode) return;
    this.selectedSubmode = submode;
    this.args.onSubmodeSelect?.(submode);
  }
}
