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
import { eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import { IconLink } from '@cardstack/boxel-ui/icons';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  getCards,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getCodeRef, type CardType } from '@cardstack/host/resources/card-type';
import { ModuleContentsResource } from '@cardstack/host/resources/module-contents';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

import type RealmService from '../../../services/realm';
import type RealmServerService from '../../../services/realm-server';

import Preview from '../../preview';

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
        {{#if (eq this.format 'isolated')}}
          <CardContainer class='isolated-preview-container'>
            {{#let (this.realm.info this.card.id) as |realmInfo|}}
              <CardHeader
                class='isolated-preview-header'
                @cardTypeDisplayName={{cardTypeDisplayName this.card}}
                @cardTypeIcon={{cardTypeIcon this.card}}
                @realmInfo={{realmInfo}}
                @isTopCard={{true}}
                @moreOptionsMenuItems={{this.moreOptionsMenuItems}}
              />
            {{/let}}
            <Preview
              class='isolated-preview'
              @card={{this.card}}
              @format={{this.format}}
            />
          </CardContainer>
        {{/if}}
      {{/if}}
    </div>
    <style scoped>
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
      .isolated-preview-container {
        height: auto;
        margin-top: var(--boxel-sp-sm);
        color: var(--boxel-dark);
        z-index: 0;
      }
      .isolated-preview-header {
        background-color: var(--boxel-100);
        box-shadow: 0 1px 0 0 rgba(0 0 0 / 15%);
        z-index: 1;
      }
      .isolated-preview {
        box-shadow: none;
        border-radius: 0;
      }
    </style>
  </template>

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

  private copyToClipboard = task(async (id: string | undefined) => {
    if (!id) {
      return;
    }
    await navigator.clipboard.writeText(id);
  });

  private get moreOptionsMenuItems() {
    let menuItems: MenuItem[] = [
      new MenuItem('Copy Card URL', 'action', {
        action: () => this.copyToClipboard.perform(this.card?.id),
        icon: IconLink,
      }),
    ];
    return menuItems;
  }

  @action private onSelect(card: CardDef) {
    this.card = card;
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
        color: var(--boxel-light);
        font: var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
        overflow: auto;
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
