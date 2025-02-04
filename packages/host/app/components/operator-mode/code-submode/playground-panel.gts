import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import {
  CardHeader,
  LoadingIndicator,
  BoxelSelect,
} from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  cardTypeDisplayName,
  cardTypeIcon,
  getCards,
  type ResolvedCodeRef,
} from '@cardstack/runtime-common';

import { getCodeRef, type CardType } from '@cardstack/host/resources/card-type';
import { ModuleContentsResource } from '@cardstack/host/resources/module-contents';

import RealmService from '@cardstack/host/services/realm';
import type RealmServerService from '@cardstack/host/services/realm-server';

import type { CardDef, Format } from 'https://cardstack.com/base/card-api';

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
    <div class='playground-panel-content'>
      <BoxelSelect
        class='instance-chooser'
        @options={{this.instances}}
        @selected={{this.selectedItem}}
        @selectedItemComponent={{if
          this.selectedItem
          (component
            SelectedItem title=(getItemTitle this.selectedItem @displayName)
          )
        }}
        @onChange={{this.onSelect}}
        @placeholder='Please Select'
        data-test-instance-chooser
        as |item|
      >
        {{getItemTitle item @displayName}}
      </BoxelSelect>
      {{#if this.selectedItem}}
        <div class='selected-item'>
          <CardHeader
            @cardTypeDisplayName={{cardTypeDisplayName this.selectedItem}}
            @cardTypeIcon={{cardTypeIcon this.selectedItem}}
            @realmInfo={{this.realm.info this.selectedItem.id}}
            @onEdit={{if
              (this.realm.canWrite this.selectedItem.id)
              (fn this.chooseFormat 'edit')
            }}
            @onClose={{this.resetSelectedItem}}
          />
          <Preview
            class='instance-preview'
            @card={{this.selectedItem}}
            @format={{this.format}}
          />
        </div>
      {{/if}}
      <div class='format-chooser'>
        <div class='format-chooser__buttons'>
          <button
            class='format-chooser__button
              {{if (eq this.format "isolated") "active"}}'
            {{on 'click' (fn this.chooseFormat 'isolated')}}
            data-test-playground-panel-format-chooser-isolated
          >
            Isolated
          </button>
          <button
            class='format-chooser__button
              {{if (eq this.format "embedded") "active"}}'
            {{on 'click' (fn this.chooseFormat 'embedded')}}
            data-test-playground-panel-format-chooser-embedded
          >
            Embedded
          </button>
          <button
            class='format-chooser__button
              {{if (eq this.format "edit") "active"}}'
            {{on 'click' (fn this.chooseFormat 'edit')}}
            data-test-playground-panel-format-chooser-edit
          >
            Edit
          </button>
        </div>
      </div>
    </div>
    <style scoped>
      .playground-panel-content {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp);
        min-height: 100%;
      }
      .selected-item {
        display: flex;
        flex-direction: column;
      }
      .instance-preview {
        border-radius: 0;
        box-shadow: none;
        border-radius: 0 0 var(--boxel-border-radius) var(--boxel-border-radius);
        overflow: auto;
      }
      .instance-chooser {
        color: var(--boxel-dark);
        height: var(--boxel-form-control-height);
      }
      .format-chooser {
        position: sticky;
        bottom: 0;
        margin-top: auto;

        display: flex;
        justify-content: center;
        min-width: fit-content;
      }
      .format-chooser__buttons {
        display: flex;

        border: 0;
        border-radius: var(--boxel-border-radius);
        box-shadow: var(--boxel-deep-box-shadow);
      }
      .format-chooser__button:first-of-type {
        border-radius: var(--boxel-border-radius) 0 0 var(--boxel-border-radius);
        border-left: 1px solid #27232f;
      }
      .format-chooser__button:last-of-type {
        border-radius: 0 var(--boxel-border-radius) var(--boxel-border-radius) 0;
      }
      .format-chooser__button {
        width: 80px;
        min-width: 80px;
        padding: var(--boxel-sp-xs);
        font: 600 var(--boxel-font-xs);
        background-color: var(--boxel-light);
        color: var(--boxel-dark);
        border: 1px solid #27232f;
        border-left: 0;
      }
      .format-chooser__button.active {
        background: #27232f;
        color: var(--boxel-teal);
      }
    </style>
  </template>

  @service private declare realm: RealmService;
  @service private declare realmServer: RealmServerService;
  @tracked private selectedItem?: CardDef;
  @tracked format: Format = 'isolated';

  private options = getCards(
    () => ({
      filter: { type: this.args.codeRef },
      sort: [{ by: 'createdAt', direction: 'desc' }],
    }),
    () => this.realmServer.availableRealmURLs,
  );

  @cached
  private get instances() {
    if (this.options?.isLoading) {
      return undefined;
    }
    return this.options.instances;
  }

  @action private onSelect(item: CardDef) {
    this.selectedItem = item;
  }

  @action private resetSelectedItem() {
    this.selectedItem = undefined;
  }

  @action
  private chooseFormat(format: Format) {
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
