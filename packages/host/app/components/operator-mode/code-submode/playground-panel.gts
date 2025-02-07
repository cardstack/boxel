import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import window from 'ember-window-mock';
import { TrackedObject } from 'tracked-built-ins';

import {
  LoadingIndicator,
  BoxelSelect,
  CardContainer,
  CardHeader,
} from '@cardstack/boxel-ui/components';
import { eq, or, MenuItem } from '@cardstack/boxel-ui/helpers';
import { Eye, IconCode, IconLink } from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  type Query,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getCard } from '@cardstack/host/resources/card-resource';

import { getCodeRef, type CardType } from '@cardstack/host/resources/card-type';
import { ModuleContentsResource } from '@cardstack/host/resources/module-contents';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import PrerenderedCardSearch, {
  type PrerenderedCard,
} from '../../prerendered-card-search';

import Preview from '../../preview';

import FormatChooser from './format-chooser';

const getItemTitle = (item: CardDef, displayName?: string) => {
  if (!item) {
    return;
  }
  if (item.title) {
    return item.title;
  }
  let fallbackName = displayName ?? item.constructor.displayName ?? 'Card';
  return `Untitled ${fallbackName}`;
};

const SelectedItem: TemplateOnlyComponent<{ Args: { title?: string } }> =
  <template>
    <div class='selected-item'>
      Instance:
      <span class='title' data-test-selected-item>
        {{@title}}
      </span>
    </div>
    <style scoped>
      .selected-item {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        overflow: hidden;
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
      .title {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
      }
    </style>
  </template>;

interface PlaygroundContentSignature {
  Args: {
    codeRef: ResolvedCodeRef;
    moduleId: string;
    displayName?: string;
  };
}
class PlaygroundPanelContent extends Component<PlaygroundContentSignature> {
  <template>
    <div class='playground-panel-content'>
      <PrerenderedCardSearch
        @query={{this.query}}
        @format='fitted'
        @realms={{this.recentRealms}}
      >
        <:loading>
          <LoadingIndicator class='loading-icon' @color='var(--boxel-light)' />
        </:loading>
        <:response as |cards|>
          <div class='instance-chooser-container'>
            <BoxelSelect
              class='instance-chooser'
              @dropdownClass='instances-dropdown-content'
              @options={{cards}}
              @selected={{this.card}}
              @selectedItemComponent={{if
                this.card
                (component
                  SelectedItem title=(getItemTitle this.card @displayName)
                )
              }}
              @renderInPlace={{true}}
              @onChange={{this.onSelect}}
              @placeholder='Please Select'
              data-test-instance-chooser
              as |card|
            >
              <CardContainer class='card' @displayBoundaries={{true}}>
                <card.component />
              </CardContainer>
            </BoxelSelect>
          </div>
        </:response>
      </PrerenderedCardSearch>
      <div class='preview-area'>
        {{#if this.card}}
          {{#if (or (eq this.format 'isolated') (eq this.format 'edit'))}}
            <CardContainer class='preview-container full-height-preview'>
              {{#let (this.realm.info this.card.id) as |realmInfo|}}
                <CardHeader
                  class='preview-header'
                  @cardTypeDisplayName={{cardTypeDisplayName this.card}}
                  @cardTypeIcon={{cardTypeIcon this.card}}
                  @realmInfo={{realmInfo}}
                  @isTopCard={{true}}
                  @moreOptionsMenuItems={{this.contextMenuItems}}
                />
              {{/let}}
              <Preview
                class='preview'
                @card={{this.card}}
                @format={{this.format}}
              />
            </CardContainer>
          {{else if (eq this.format 'embedded')}}
            <CardContainer class='preview-container'>
              <Preview
                class='preview'
                @card={{this.card}}
                @format={{this.format}}
              />
            </CardContainer>
          {{/if}}
        {{/if}}
      </div>
      <FormatChooser
        class='format-chooser'
        @format={{this.format}}
        @setFormat={{this.setFormat}}
      />
    </div>
    <style scoped>
      .playground-panel-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-height: 100%;
      }
      .loading-icon {
        height: var(--boxel-form-control-height);
      }
      .instance-chooser-container {
        position: sticky;
        z-index: 1;
        top: 0;
        display: flex;
        justify-content: center;
      }
      .instance-chooser-container > :deep(.ember-basic-dropdown) {
        max-width: 100%;
      }
      .instance-chooser {
        width: 405px;
        max-width: 100%;
        height: var(--boxel-form-control-height);
        box-shadow: 0 5px 10px 0 rgba(0 0 0 / 40%);
      }
      :deep(.instances-dropdown-content > .ember-power-select-options) {
        max-height: 20rem;
      }
      .card {
        height: 75px;
        width: 375px;
        max-width: 100%;
        container-name: fitted-card;
        container-type: size;
      }
      .preview-area {
        flex-grow: 1;
        z-index: 0;
        display: flex;
        flex-direction: column;
      }
      .preview-container {
        height: auto;
      }
      .full-height-preview {
        flex-grow: 1;
        display: grid;
        grid-auto-rows: max-content 1fr;
      }
      .preview-header {
        background-color: var(--boxel-100);
        box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
        z-index: 1;
      }
      .preview {
        box-shadow: none;
        border-radius: 0;
      }
      .format-chooser {
        position: sticky;
        bottom: 0;
        margin-top: auto;

        --boxel-format-chooser-button-bg-color: var(--boxel-light);
        --boxel-format-chooser-button-width: 80px;
        --boxel-format-chooser-button-min-width: 80px;
      }
    </style>
  </template>

  @service private declare operatorModeStateService: OperatorModeStateService;
  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @service declare recentFilesService: RecentFilesService;
  @tracked private format: Format = 'isolated';
  private playgroundSelections: Record<string, string>;

  constructor(owner: Owner, args: PlaygroundContentSignature['Args']) {
    super(owner, args);
    let selections = window.localStorage.getItem('playground-selections');

    this.playgroundSelections = new TrackedObject(
      selections?.length ? JSON.parse(selections) : {},
    );
  }

  get recentCardIds() {
    return this.recentFilesService.recentFiles
      .map((f) => `${f.realmURL}${f.filePath}`)
      .filter((id) => id.endsWith('.json'))
      .map((id) => id.slice(0, -1 * '.json'.length));
  }

  get recentRealms() {
    return [
      ...new Set(
        this.recentFilesService.recentFiles.map((f) => f.realmURL.href),
      ),
    ];
  }

  get query(): Query {
    return {
      filter: {
        every: [
          {
            type: this.args.codeRef,
          },
          {
            any: this.recentCardIds.map((id) => ({ eq: { id } })).slice(0, 20),
          },
        ],
      },
      sort: [
        {
          by: 'createdAt',
          direction: 'desc',
        },
      ],
    };
  }

  private cardResource = getCard(this, () =>
    this.playgroundSelections[this.args.moduleId]?.replace(/\.json$/, ''),
  );

  private get card(): CardDef | undefined {
    return this.cardResource.card;
  }

  private copyToClipboard = task(async (id: string) => {
    await navigator.clipboard.writeText(id);
  });

  private openInInteractMode = task(async (id: string, format: Format) => {
    await this.operatorModeStateService.openCardInInteractMode(
      new URL(id),
      format,
    );
  });

  private get contextMenuItems() {
    if (!this.card?.id) {
      return undefined;
    }
    let cardId = this.card.id;
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () => this.copyToClipboard.perform(cardId),
        icon: IconLink,
      }),
      new MenuItem('Open in Code Mode', 'action', {
        action: () =>
          this.operatorModeStateService.updateCodePath(new URL(cardId)),
        icon: IconCode,
      }),
      new MenuItem('Open in Interact Mode', 'action', {
        action: () => this.openInInteractMode.perform(cardId, this.format),
        icon: Eye,
      }),
    ];
    return menuItems;
  }

  private persistSelections = (cardId: string) => {
    this.playgroundSelections[this.args.moduleId] = cardId;
    window.localStorage.setItem(
      'playground-selections',
      JSON.stringify(this.playgroundSelections),
    );
  };

  @action private onSelect(card: PrerenderedCard) {
    this.persistSelections(card.url);
  }

  @action
  private setFormat(format: Format) {
    this.format = format;
  }
}

interface Signature {
  Args: {
    moduleContentsResource: ModuleContentsResource;
    cardType?: CardType;
  };
  Element: HTMLElement;
}
export default class PlaygroundPanel extends Component<Signature> {
  <template>
    <section class='playground-panel' data-test-playground-panel>
      {{#if this.isLoading}}
        <LoadingIndicator @color='var(--boxel-light)' />
      {{else if @cardType.type}}
        {{#let (getCodeRef @cardType.type) as |codeRef|}}
          {{#if codeRef}}
            <PlaygroundPanelContent
              @codeRef={{codeRef}}
              @moduleId={{@cardType.type.id}}
              @displayName={{@cardType.type.displayName}}
            />
          {{else}}
            <p class='error'>
              Error: Selected module is not for an exported card, or its code
              ref could not be loaded.
            </p>
          {{/if}}
        {{/let}}
      {{else}}
        {{! TODO: error state }}
        <p class='error'>Error: Playground could not be loaded.</p>
      {{/if}}
    </section>
    <style scoped>
      .playground-panel {
        position: relative;
        background-image: url('./playground-background.png');
        background-position: left top;
        background-repeat: repeat;
        background-size: 22.5px;
        height: 100%;
        width: 100%;
        padding: var(--boxel-sp);
        background-color: var(--boxel-dark);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: auto;
      }
      .error {
        margin: 0;
        color: var(--boxel-light);
      }
    </style>
  </template>

  get isLoading() {
    return (
      this.args.moduleContentsResource.isLoadingNewModule ||
      this.args.cardType?.isLoading
    );
  }
}
