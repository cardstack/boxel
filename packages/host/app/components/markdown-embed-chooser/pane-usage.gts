import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { isCardErrorJSONAPI } from '@cardstack/runtime-common';

import MiniCardChooser from '@cardstack/host/components/card-chooser/mini';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import MarkdownEmbedPreviewPane from './pane';

export default class MarkdownEmbedPreviewPaneUsage extends Component {
  @service declare private store: StoreService;

  @tracked private target: CardDef | undefined;
  @tracked private inserted: string | undefined;

  @action private async onSelect(url: string) {
    let result = await this.store.get(url);
    if (!isCardErrorJSONAPI(result)) {
      this.target = result as CardDef;
    }
  }

  @action private onInsert(bfm: string) {
    this.inserted = bfm;
  }

  <template>
    <FreestyleUsage @name='MarkdownEmbedChooser::Pane'>
      <:description>
        The right-hand companion to the mini choosers: a live preview plus a
        format dropdown, always-on W×H inputs for Fitted (with smart variant
        matching), an Inline/Block toggle (Block is disabled while Atom is
        selected, since atom has no block form), and a dynamic "Insert as …"
        CTA. The CTA fires
        <code>onInsert</code>
        with the serialized BFM — the host owns cursor insertion.
      </:description>
      <:example>
        <div class='side-by-side'>
          <div class='panel'>
            <MiniCardChooser @onSelect={{this.onSelect}} />
          </div>
          <div class='panel'>
            {{#if this.target}}
              <MarkdownEmbedPreviewPane
                @target={{this.target}}
                @refType='card'
                @onInsert={{this.onInsert}}
              />
            {{else}}
              <p class='hint'>Pick a card to configure its embed.</p>
            {{/if}}
          </div>
        </div>
        {{#if this.inserted}}
          <p class='readout' data-test-pane-usage-readout>
            Inserted:
            <code>{{this.inserted}}</code>
          </p>
        {{/if}}
      </:example>
      <:api as |Args|>
        <Args.Object
          @name='target'
          @description='Resolved CardDef or FileDef being previewed; its id is the BFM ref URL.'
          @required={{true}}
        />
        <Args.String
          @name='refType'
          @description="'card' or 'file' — which BFM keyword to emit."
          @required={{true}}
        />
        <Args.Action
          @name='onInsert'
          @description='Called with the serialized BFM directive when the CTA is clicked.'
          @required={{true}}
        />
      </:api>
    </FreestyleUsage>
    <style scoped>
      .side-by-side {
        display: flex;
        gap: var(--boxel-sp);
        height: 480px;
      }
      .panel {
        flex: 1 1 0;
        min-width: 0;
        border: 1px solid var(--boxel-border-color, var(--boxel-300));
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
      }
      .hint {
        padding: var(--boxel-sp);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
      }
      .readout {
        margin-top: var(--boxel-sp-xs);
        font: var(--boxel-font-sm);
      }
    </style>
  </template>
}
