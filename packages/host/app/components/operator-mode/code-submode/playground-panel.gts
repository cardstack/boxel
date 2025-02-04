import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';

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
  getCards,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getCodeRef, type CardType } from '@cardstack/host/resources/card-type';
import { ModuleContentsResource } from '@cardstack/host/resources/module-contents';

import OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

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

interface PlaygroundContentSignature {
  Args: {
    codeRef: ResolvedCodeRef;
    displayName?: string;
  };
}
class PlaygroundPanelContent extends Component<PlaygroundContentSignature> {
  <template>
    <div class='playground-panel-content'>
      <div class='instance-chooser-container'>
        <BoxelSelect
          class='instance-chooser'
          @options={{this.options.instances}}
          @selected={{this.card}}
          @selectedItemComponent={{if
            this.card
            (component SelectedItem title=(getItemTitle this.card @displayName))
          }}
          @onChange={{this.onSelect}}
          @placeholder='Please Select'
          data-test-instance-chooser
          as |item|
        >
          {{getItemTitle item @displayName}}
        </BoxelSelect>
      </div>
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
        color: var(--boxel-dark);
        max-width: 405px;
        height: var(--boxel-form-control-height);
        box-shadow: 0 5px 10px 0 rgba(0 0 0 / 40%);
      }
      .preview-container {
        height: auto;
        color: var(--boxel-dark);
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
  @tracked private card?: CardDef;
  @tracked private format: Format = 'isolated';

  private options = getCards(
    () => ({
      filter: { type: this.args.codeRef },
      sort: [{ by: 'createdAt', direction: 'desc' }],
    }),
    () => this.realmServer.availableRealmURLs,
  );

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

  @action private onSelect(card: CardDef) {
    this.card = card;
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
        <LoadingIndicator class='loading-icon' />
        Loading...
      {{else if @cardType.type}}
        {{#let (getCodeRef @cardType.type) as |codeRef|}}
          {{#if codeRef}}
            <PlaygroundPanelContent
              @codeRef={{codeRef}}
              @displayName={{@cardType.type.displayName}}
            />

          {{else}}
            Error: Playground could not be loaded.
          {{/if}}
        {{/let}}
      {{else}}
        {{! TODO: error state }}
        Error: Playground could not be loaded.
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
        position: relative;
      }
      .loading-icon {
        display: inline-block;
        margin-right: var(--boxel-sp-xxxs);
        vertical-align: middle;
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
