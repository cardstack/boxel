import { fn } from '@ember/helper';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';
import { TrackedObject } from 'tracked-built-ins';

import { IconX } from '@cardstack/boxel-ui/icons';

import {
  baseRealm,
  getPlural,
  isCardInstance,
} from '@cardstack/runtime-common';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import headerIcon from '../ai-assistant/ai-assist-icon@2x.webp';

import PillMenu from './index';

import type { PillMenuItem } from './index';

const sampleCardURLs = [
  `${baseRealm.url}SkillCard/card-editing`,
  `${baseRealm.url}SkillCard/source-code-editing`,
];

export default class PillMenuUsage extends Component {
  @service private declare store: StoreService;

  @tracked private title = 'Pill Menu';
  @tracked private isExpandableHeader = false;
  @tracked private items: PillMenuItem[] = [];
  @tracked private itemDisplayName = 'Card';
  @tracked private canAttachCard = false;
  private headerIconURL = headerIcon;

  constructor(owner: Owner, args: {}) {
    super(owner, args);
    this.attachSampleCards.perform();
  }

  private attachSampleCards = task(async () => {
    let cards = (
      await Promise.all(
        sampleCardURLs.map((url) =>
          this.store.getInstanceDetachedFromStore(url),
        ),
      )
    )
      .filter(Boolean)
      .filter(isCardInstance) as CardDef[];
    this.items = cards.map(
      (card) =>
        new TrackedObject({
          card,
          isActive: true,
        }),
    );
  });

  private get activeItems() {
    return this.items.filter((item) => item.isActive);
  }

  @action private headerAction() {
    console.log('Header button clicked');
  }

  @action private onChooseCard(card: CardDef) {
    this.items = [...this.items, new TrackedObject({ card, isActive: true })];
  }

  @action private onChangeItemIsActive(item: PillMenuItem, isActive: boolean) {
    item.isActive = isActive;
  }

  <template>
    <FreestyleUsage @name='PillMenu'>
      <:description>
        Component with a header and a list of card pills.
      </:description>
      <:example>
        <PillMenu
          @title={{this.title}}
          @items={{this.items}}
          @itemDisplayName={{this.itemDisplayName}}
          @isExpandableHeader={{this.isExpandableHeader}}
          @headerAction={{this.headerAction}}
          @canAttachCard={{this.canAttachCard}}
          @onChooseCard={{this.onChooseCard}}
          @onChangeItemIsActive={{this.onChangeItemIsActive}}
        >
          <:headerIcon>
            <img
              src={{this.headerIconURL}}
              width='18'
              height='18'
              alt='menu icon'
            />
          </:headerIcon>
          <:headerDetail>
            {{this.activeItems.length}}
            of
            {{this.items.length}}
            {{getPlural this.itemDisplayName}}
            Are Active
          </:headerDetail>
          <:headerButton>
            <IconX width='10' height='10' alt='Close' />
          </:headerButton>
          <:content>
            You have selected the following cards:
          </:content>
        </PillMenu>
      </:example>
      <:api as |Args|>
        <Args.String
          @name='title'
          @description='Menu title displayed on the header'
          @value={{this.title}}
          @onInput={{fn (mut this.title)}}
        />
        <Args.Object
          @name='items'
          @description='Cards to be displayed on the pill menu.'
          @value={{this.items}}
        />
        <Args.String
          @name='itemDisplayName'
          @description='Display name used when referring to menu items'
          @value={{this.itemDisplayName}}
          @onInput={{fn (mut this.itemDisplayName)}}
        />
        <Args.Bool
          @name='isExpandableHeader'
          @description='Whether the menu content can be hidden or shown by clicking the header button.'
          @defaultValue={{false}}
          @value={{this.isExpandableHeader}}
          @onInput={{fn (mut this.isExpandableHeader)}}
        />
        <Args.Action
          @name='headerAction'
          @description='Action to take when header button is clicked.'
        />
        <Args.Bool
          @name='canAttachCard'
          @description='Whether the user can add more items to the menu'
          @defaultValue={{false}}
          @value={{this.canAttachCard}}
          @onInput={{fn (mut this.canAttachCard)}}
        />
        <Args.Object
          @name='query'
          @description='Query for filtering the cards displayed in the catalog.'
        />
        <Args.Action
          @name='onChooseCard'
          @description='Action to take when a card is selected from the catalog. "@canAttachCard" must be set to true.'
        />
      </:api>
    </FreestyleUsage>
  </template>
}
