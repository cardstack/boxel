import { tracked } from '@glimmer/tracking';

import {
  CardDef,
  Component,
  field,
  contains,
  linksTo,
  Theme,
} from 'https://cardstack.com/base/card-api';
import StringField from 'https://cardstack.com/base/string';
import { CardsGrid } from 'https://cardstack.com/base/cards-grid';

import { TabbedHeader } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import LayoutGridPlus from '@cardstack/boxel-icons/layout-grid-plus';
import Factory from '@cardstack/boxel-icons/factory';

import { FactoryIssueTracker } from './factory-issue-tracker';

const TABS = [
  { displayName: 'Board', tabId: 'board' },
  { displayName: 'Catalog', tabId: 'catalog' },
];

class FactoryIndexIsolated extends Component<typeof FactoryIndex> {
  @tracked activeTabId = 'board';

  setActiveTab = (tabId: string): void => {
    this.activeTabId = tabId;
  };

  <template>
    <div class='factory-index'>
      <TabbedHeader
        @headerTitle={{@model.cardTitle}}
        @headerBackgroundColor={{@model.constructor.headerColor}}
        @tabs={{TABS}}
        @activeTabId={{this.activeTabId}}
        @setActiveTab={{this.setActiveTab}}
      >
        <:headerIcon>
          <Factory class='header-icon' aria-hidden='true' />
        </:headerIcon>
      </TabbedHeader>

      <div class='tab-panel'>
        {{#if (eq this.activeTabId 'board')}}
          <div class='board-panel'>
            {{#if @model.board}}
              <@fields.board @format='isolated' @displayContainer={{false}} />
            {{else}}
              <p class='empty-state'>No board linked. Edit this card to connect
                one.</p>
            {{/if}}
          </div>
        {{else}}
          <div class='catalog-panel'>
            {{#if @model.cardsGrid}}
              <@fields.cardsGrid
                @format='isolated'
                @displayContainer={{false}}
              />
            {{else}}
              <p class='empty-state'>No catalog linked. Edit this card to
                connect one.</p>
            {{/if}}
          </div>
        {{/if}}
      </div>
    </div>
    <style scoped>
      .factory-index {
        height: 100%;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        background: var(--background, var(--boxel-light));
        color: var(--foreground, var(--boxel-dark));
      }
      .header-icon {
        width: 1.25rem;
        height: 1.25rem;
        flex-shrink: 0;
      }
      .tab-panel {
        flex: 1;
        min-height: 0;
        overflow: hidden;
      }
      .board-panel,
      .catalog-panel {
        height: 100%;
        overflow: hidden;
      }
      .empty-state {
        padding: var(--boxel-sp-xl);
        text-align: center;
        color: var(--muted-foreground, var(--boxel-500));
        font-size: 0.875rem;
      }
    </style>
  </template>
}

export class FactoryIndex extends CardDef {
  static displayName = 'Factory Index';
  static icon = LayoutGridPlus;
  static prefersWideFormat = true;
  static headerColor = '#ffba00';

  @field cardsGrid = linksTo(() => CardsGrid);
  @field board = linksTo(() => FactoryIssueTracker);

  @field cardTitle = contains(StringField, {
    computeVia: function (this: FactoryIndex) {
      return this.cardInfo.name?.trim() ?? 'Software Factory';
    },
  });

  @field cardTheme = linksTo(() => Theme, {
    computeVia: function (this: FactoryIndex) {
      return this.cardInfo?.theme;
    },
  });

  static isolated = FactoryIndexIsolated;
}
