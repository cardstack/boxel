import type { TemplateOnlyComponent } from '@ember/component/template-only';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import { LoadingIndicator, BoxelSelect } from '@cardstack/boxel-ui/components';

import { ModuleContentsResource } from '@cardstack/host/resources/module-contents';

import { getCards, type Query } from '@cardstack/runtime-common';

import type { CardType } from '@cardstack/host/resources/card-type';

import type RealmServerService from '@cardstack/host/services/realm-server';

interface Signature {
  Args: {
    moduleContentsResource: ModuleContentsResource;
    cardType?: CardType;
  };
  Element: HTMLElement;
}

const SelectedItem: TemplateOnlyComponent<{ Args: { title?: string } }> =
  <template>
    <span class='selected-item'>
      Instance:
      {{@title}}
    </span>
    <style scoped>
      .selected-item {
        font: 600 var(--boxel-font-xs);
        letter-spacing: var(--boxel-lsp-sm);
      }
    </style>
  </template>;

interface PlaygroundContentSignature {
  Args: {
    cardType?: CardType;
  };
}

class PlaygroundPanelContent extends Component<PlaygroundContentSignature> {
  <template>
    {{#if this.isLoading}}
      <LoadingIndicator class='loading-icon' />
      Loading...
    {{else if this.instances.length}}
      <BoxelSelect
        class='instance-chooser'
        @options={{this.instances}}
        @selected={{this.selectedItem}}
        @selectedItemComponent={{component
          SelectedItem
          title=this.selectedItem.title
        }}
        @onChange={{this.onSelect}}
        @placeholder='Please Select'
        as |item|
      >
        {{item.title}}
      </BoxelSelect>
    {{/if}}
    <style scoped>
      .instance-chooser {
        color: var(--boxel-dark);
      }
      .loading-icon {
        display: inline-block;
        margin-right: var(--boxel-sp-xxxs);
        vertical-align: middle;
      }
    </style>
  </template>

  @service private declare realmServer: RealmServerService;
  @tracked private selectedItem?: CardDef;
  @tracked private options?: {
    instances: CardDef[];
    isLoading: boolean;
    loaded: Promise<void>;
  };

  constructor(owner: Owner, args: PlaygroundContentSignature['Args']) {
    super(owner, args);
    this.loadInstances.perform();
  }

  private loadInstances = restartableTask(async () => {
    if (this.args.cardType) {
      await this.args.cardType.ready;
      let codeRef = this.args.cardType?.type?.codeRef;
      if (codeRef) {
        let query: Query = {
          filter: { type: codeRef },
          sort: [{ by: 'createdAt', direction: 'desc' }],
        };
        this.options = getCards(query, this.realms);
      }
    }
  });

  private get isLoading() {
    return (
      this.loadInstances.isRunning ||
      this.args.cardType?.isLoading ||
      this.options?.isLoading
    );
  }

  private get realms() {
    return this.realmServer.availableRealmURLs;
  }

  private get instances() {
    return this.options?.instances;
  }

  @action private onSelect(item: CardDef) {
    this.selectedItem = item;
  }
}

const PlaygroundPanel: TemplateOnlyComponent<Signature> = <template>
  <section class='playground-panel' data-test-playground-panel>
    {{#if @moduleContentsResource.isLoadingNewModule}}
      <LoadingIndicator class='loading-icon' />
      Loading...
    {{else}}
      <PlaygroundPanelContent @cardType={{@cardType}} />
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
      overflow: auto;
    }
    .loading-icon {
      display: inline-block;
      margin-right: var(--boxel-sp-xxxs);
      vertical-align: middle;
    }
  </style>
</template>;

export default PlaygroundPanel;
