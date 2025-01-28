import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { LoadingIndicator, BoxelSelect } from '@cardstack/boxel-ui/components';

import { ModuleContentsResource } from '@cardstack/host/resources/module-contents';

import { getCards, type ResolvedCodeRef } from '@cardstack/runtime-common';

import { getCodeRef, type CardType } from '@cardstack/host/resources/card-type';

import type RealmServerService from '@cardstack/host/services/realm-server';

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
    <style scoped>
      .instance-chooser {
        color: var(--boxel-dark);
        height: var(--boxel-form-control-height);
      }
    </style>
  </template>

  @service private declare realmServer: RealmServerService;
  @tracked private selectedItem?: CardDef;

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
      return;
    }
    return this.options.instances;
  }

  @action private onSelect(item: CardDef) {
    this.selectedItem = item;
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
