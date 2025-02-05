import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, task } from 'ember-concurrency';
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
  getCard,
  identifyCard,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getCodeRef, type CardType } from '@cardstack/host/resources/card-type';
import { ModuleContentsResource } from '@cardstack/host/resources/module-contents';

import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';
import type RecentFilesService from '@cardstack/host/services/recent-files-service';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

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

const getComponent = (card: CardDef) => {
  return card?.constructor?.getComponent(card);
};

const isMatchingCardType = (card: CardDef, ref: ResolvedCodeRef) => {
  let cardRef = identifyCard(card?.constructor);
  return (
    cardRef &&
    'module' in cardRef &&
    cardRef.module === ref.module &&
    cardRef.name === ref.name
  );
};

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
      {{#if this.getRecentCardInstances.isRunning}}
        <LoadingIndicator class='loading-icon' @color='var(--boxel-light)' />
      {{else}}
        <div class='instance-chooser-container'>
          <BoxelSelect
            class='instance-chooser'
            @options={{this.instances}}
            @selected={{this.card}}
            @selectedItemComponent={{if
              this.card
              (component
                SelectedItem title=(getItemTitle this.card @displayName)
              )
            }}
            @onChange={{this.onSelect}}
            @placeholder='Please Select'
            data-test-instance-chooser
            as |card|
          >
            {{#let (getComponent card) as |Card|}}
              <Card @format='fitted' />
            {{/let}}
          </BoxelSelect>
        </div>
      {{/if}}
      <div class='preview-area'>
        {{#if this.card}}
          {{#if (or (eq this.format 'isolated') (eq this.format 'edit'))}}
            <CardContainer class='preview-container'>
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
        min-height: 100%;
      }
      .instance-chooser-container {
        position: sticky;
        z-index: 1;
        top: 0;
        display: flex;
        justify-content: center;
      }
      .instance-chooser {
        max-width: 405px;
        height: var(--boxel-form-control-height);
        box-shadow: 0 5px 10px 0 rgba(0 0 0 / 40%);
      }
      .loading-icon {
        height: var(--boxel-form-control-height);
      }
      .preview-container {
        height: auto;
        z-index: 0;
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
      .playground-panel-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-height: 100%;
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
  @tracked private _card?: CardDef;
  @tracked private format: Format = 'isolated';
  @tracked private potentialOptions?: CardDef[] | [];
  playgroundSelections = new TrackedObject<Record<string, string>>();

  constructor(owner: Owner, args: PlaygroundContentSignature['Args']) {
    super(owner, args);
    this.getRecentCardInstances.perform();
    let selections = window.localStorage.getItem('playground-selections');
    if (selections?.length) {
      this.playgroundSelections = JSON.parse(selections);
    }
  }

  private loadSelectedCard = restartableTask(async (id: string) => {
    let r = getCard(new URL(id));
    await r.loaded;
    this._card = r.card;
  });

  private getRecentCardInstances = restartableTask(async () => {
    let cards = await Promise.all(
      this.recentFilesService.recentFiles
        .filter((f) => f.filePath.endsWith('.json'))
        .map(async (f) => {
          let r = getCard(new URL(`${f.realmURL}${f.filePath}`));
          await r.loaded;
          return r.card;
        }),
    );
    this.potentialOptions = cards.filter(Boolean) as CardDef[] | [];
  });

  private get instances() {
    let matches = this.potentialOptions
      ?.map((card) =>
        isMatchingCardType(card, this.args.codeRef) ? card : undefined,
      )
      .filter(Boolean);
    return matches;
  }

  private get card() {
    if (this._card && isMatchingCardType(this._card, this.args.codeRef)) {
      return this._card;
    }
    let selectedCardId = this.playgroundSelections[this.args.moduleId];
    if (selectedCardId) {
      this.loadSelectedCard.perform(selectedCardId);
    }
    return;
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

  @action private onSelect(card: CardDef) {
    this._card = card;
    this.persistSelections(card.id);
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
