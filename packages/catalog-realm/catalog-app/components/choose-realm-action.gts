import GlimmerComponent from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

import {
  BoxelDropdown,
  BoxelButton,
  Menu as BoxelMenu,
} from '@cardstack/boxel-ui/components';
import { MenuItem } from '@cardstack/boxel-ui/helpers';
import { CardContext } from 'https://cardstack.com/base/card-api';
import { task } from 'ember-concurrency';

interface ChooseRealmActionSignature {
  Element: HTMLElement;
  Args: {
    name: string;
    writableRealms: { name: string; url: string; iconURL?: string }[];
    onAction: (realmUrl: string) => Promise<void>;
    context?: CardContext;
    size?: 'extra-small';
  };
}

export default class ChooseRealmAction extends GlimmerComponent<ChooseRealmActionSignature> {
  get realmOptions() {
    return this.args.writableRealms.map((realm) => {
      return new MenuItem({
        label: realm.name,
        action: () => {
          this.runAction.perform(realm.url);
        },
        iconURL: realm.iconURL ?? '/default-realm-icon.png',
      });
    });
  }

  // this is neeeded to prevent click on the remix/build button
  // to affect the catalog image overlay that has a behaviour whereby
  // if you click on the info-section surrounding the remix
  // it will open the details of the card
  @action
  handleStopPropagation(e: MouseEvent) {
    e.stopPropagation();
  }

  runAction = task(async (realm: string) => {
    await this.args.onAction(realm);
  });

  <template>
    <BoxelDropdown>
      <:trigger as |bindings|>
        <BoxelButton
          data-test-catalog-listing-action={{@name}}
          class='card-action-button'
          @kind='primary'
          @size={{@size}}
          @loading={{this.runAction.isRunning}}
          {{on 'click' this.handleStopPropagation}}
          {{bindings}}
        >
          {{@name}}
        </BoxelButton>
      </:trigger>
      <:content as |dd|>
        <BoxelMenu
          class='realm-dropdown-menu'
          @closeMenu={{dd.close}}
          @items={{this.realmOptions}}
        />
      </:content>
    </BoxelDropdown>

    <style scoped>
      .realm-dropdown-menu {
        --boxel-menu-item-content-padding: var(--boxel-sp-xs);
        --boxel-menu-item-gap: var(--boxel-sp-xs);
        min-width: 13rem;
        max-height: 13rem;
        overflow-y: scroll;
      }
      .realm-dropdown-menu :deep(.menu-item__icon-url) {
        border-radius: var(--boxel-border-radius-xs);
      }

      .card-action-button {
        --boxel-button-font: 600 var(--boxel-font-sm);
        margin-left: auto;
        flex: 0 0 auto;
        line-height: 1;
        --boxel-button-padding: var(--boxel-sp-xs) var(--boxel-sp);
      }
    </style>
  </template>
}
