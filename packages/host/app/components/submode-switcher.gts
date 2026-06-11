import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import { capitalize } from '@ember/string';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import UserScreen from '@cardstack/boxel-icons/user-screen';

import {
  BoxelDropdown,
  Button,
  Menu,
  Tooltip,
} from '@cardstack/boxel-ui/components';

import type { MenuItem } from '@cardstack/boxel-ui/helpers';
import { cn } from '@cardstack/boxel-ui/helpers';
import { menuItemFunc } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown, Eye, IconCode } from '@cardstack/boxel-ui/icons';

import config from '@cardstack/host/config/environment';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';

import type { ComponentLike, ModifierLike } from '@glint/template';

export const Submodes = {
  Interact: 'interact',
  Code: 'code',
  Host: 'host',
} as const;
type Values<T> = T[keyof T];
export type Submode = Values<typeof Submodes>;

interface TriggerButtonSignature {
  Args: {
    submode: Submode;
    isCollapsed?: boolean;
    isExpanded: boolean;
    appVersion: string;
    bindings: ModifierLike<{
      Args: { Positional: unknown[] };
      Element: HTMLButtonElement | HTMLAnchorElement;
    }>;
    onToggle: () => void;
    icon: ComponentLike<{ Element: SVGSVGElement }>;
  };
  Element: HTMLButtonElement;
}

const SubmodeTriggerButton: TemplateOnlyComponent<TriggerButtonSignature> =
  <template>
    <Button
      class={{cn
        'submode-switcher-dropdown-trigger'
        submode-switcher-dropdown-trigger--collapsed=@isCollapsed
      }}
      @kind='primary-dark'
      @size='auto'
      @rectangular={{true}}
      aria-label='{{@submode}} submode'
      title={{@appVersion}}
      {{on 'click' @onToggle}}
      {{@bindings}}
      data-test-submode-switcher-button={{@submode}}
      ...attributes
    >
      <@icon width='18px' height='18px' role='presentation' />
      {{#unless @isCollapsed}}
        <span class='submode-switcher-label'>{{capitalize @submode}}</span>
        <DropdownArrowDown
          class='dropdown-arrow'
          width='12px'
          height='12px'
          role='presentation'
          data-test-submode-arrow-direction={{if @isExpanded 'up' 'down'}}
        />
      {{/unless}}
    </Button>
    <style scoped>
      .submode-switcher-dropdown-trigger {
        --icon-color: var(--boxel-highlight);
        position: relative;
        height: var(--submode-switcher-height);
        width: var(--submode-switcher-width);
        padding: var(--boxel-sp-2xs) var(--boxel-sp-xs);
        justify-content: flex-start;
        gap: var(--boxel-sp-2xs);
        flex-shrink: 0;
        transition:
          border-bottom-right-radius var(--boxel-transition),
          border-bottom-left-radius var(--boxel-transition);
      }
      .submode-switcher-dropdown-trigger[aria-expanded='true'] {
        border-bottom-right-radius: 0;
        border-bottom-left-radius: 0;
      }
      .submode-switcher-dropdown-trigger--collapsed {
        --submode-switcher-width: var(--container-button-size);
        justify-content: center;
        padding-inline: var(--boxel-sp-2xs);
        gap: 0;
      }
      .submode-switcher-dropdown-trigger--collapsed[aria-expanded='true'] {
        border-radius: var(--boxel-border-radius);
      }
      .dropdown-arrow {
        margin-left: auto;
      }
      .submode-switcher-dropdown-trigger[aria-expanded='true'] .dropdown-arrow {
        transform: rotate(180deg);
      }
    </style>
  </template>;

interface Signature {
  Element: HTMLElement;
  Args: {
    isCollapsed?: boolean;
    submode: Submode;
    onSubmodeSelect: (submode: Submode) => void;
  };
}

export default class SubmodeSwitcher extends Component<Signature> {
  <template>
    <div data-test-submode-switcher={{@submode}} ...attributes>
      <BoxelDropdown
        @contentClass={{if
          @isCollapsed
          'submode-switcher-dropdown submode-switcher-dropdown--detached gap-above'
          'submode-switcher-dropdown'
        }}
      >
        <:trigger as |bindings|>
          {{#if @isCollapsed}}
            <Tooltip @placement='right'>
              <:trigger>
                <SubmodeTriggerButton
                  @submode={{@submode}}
                  @isCollapsed={{@isCollapsed}}
                  @isExpanded={{this.isExpanded}}
                  @appVersion={{this.appVersion}}
                  @bindings={{bindings}}
                  @onToggle={{this.toggleDropdown}}
                  @icon={{this.currentSubmodeIcon}}
                />
              </:trigger>
              <:content>Change submode</:content>
            </Tooltip>
          {{else}}
            <SubmodeTriggerButton
              @submode={{@submode}}
              @isExpanded={{this.isExpanded}}
              @appVersion={{this.appVersion}}
              @bindings={{bindings}}
              @onToggle={{this.toggleDropdown}}
              @icon={{this.currentSubmodeIcon}}
            />
          {{/if}}
        </:trigger>
        <:content as |dd|>
          <Menu
            class='submode-switcher-dropdown-menu themeless'
            @closeMenu={{dd.close}}
            @items={{this.buildMenuItems}}
          />
        </:content>
      </BoxelDropdown>
    </div>
    <style scoped>
      :global(:root) {
        --submode-switcher-dropdown-content-border-radius: 0 0
          var(--boxel-border-radius) var(--boxel-border-radius);
        --submode-switcher-dropdown-content-bg-color: rgba(0, 0, 0, 0.5);
        --submode-switcher-width: 10.5rem; /* 168px */
        --submode-switcher-height: var(--container-button-size);
      }
      :global(.submode-switcher-dropdown) {
        --boxel-dropdown-content-border-radius: var(
          --submode-switcher-dropdown-content-border-radius
        );
        background-color: var(--submode-switcher-dropdown-content-bg-color);
      }
      :global(.submode-switcher-dropdown--detached) {
        --submode-switcher-dropdown-content-border-radius: var(
          --boxel-border-radius
        );
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

  @service declare private operatorModeStateService: OperatorModeStateService;

  submodeIcons = {
    [Submodes.Interact]: Eye,
    [Submodes.Code]: IconCode,
    [Submodes.Host]: UserScreen,
  };
  @tracked isExpanded = false;

  get currentSubmodeIcon() {
    return this.submodeIcons[this.args.submode];
  }

  @action
  toggleDropdown() {
    this.isExpanded = !this.isExpanded;
  }

  @action onSubmodeSelect(submode: Submode) {
    this.isExpanded = false;
    this.args.onSubmodeSelect(submode);
  }

  get appVersion() {
    return `yVersion ${config.APP.version}`;
  }

  get buildMenuItems(): MenuItem[] {
    return Object.values(Submodes)
      .filter((submode) => submode !== this.args.submode)
      .filter((submode) => {
        if (submode === Submodes.Host) {
          return this.operatorModeStateService.currentRealmInfo?.publishable;
        }

        return true;
      })
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
