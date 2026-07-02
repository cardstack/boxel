import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import FreestyleUsage from 'ember-freestyle/components/freestyle/usage';

import { isCardErrorJSONAPI } from '@cardstack/runtime-common';

import MiniCardChooser from '@cardstack/host/components/card-chooser/mini';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef } from 'https://cardstack.com/base/card-api';

import EmbedFormatSelection from './format-selection';
import MarkdownEmbedPreviewPane from './pane';

export default class MarkdownEmbedPreviewPaneUsage extends Component {
  @service declare private store: StoreService;

  @tracked private target: CardDef | undefined;
  @tracked private inserted: string | undefined;
  @tracked private refType: 'card' | 'file' = 'card';
  private selection = new EmbedFormatSelection();

  @action private async onSelect(url: string) {
    let result = await this.store.get(url);
    if (!isCardErrorJSONAPI(result)) {
      this.target = result as CardDef;
    }
  }

  @action private onInsert(bfm: string) {
    this.inserted = bfm;
  }

  @action private setRefType(value: string) {
    this.refType = value === 'file' ? 'file' : 'card';
  }

  <template>
    <FreestyleUsage @name='MarkdownEmbedChooser::Pane'>
      <:description>
        The right-hand companion to the mini choosers: a live preview plus a
        format dropdown, always-on W×H inputs for Fitted (with smart variant
        matching), an independent Inline/Block placement toggle (every format
        works in both placements), and a dynamic "Insert as …" CTA. The CTA
        fires
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
                @refType={{this.refType}}
                @selection={{this.selection}}
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
          @value={{this.target}}
        />
        <Args.String
          @name='refType'
          @description="'card' or 'file' — which BFM keyword to emit."
          @required={{true}}
          @value={{this.refType}}
          @onInput={{this.setRefType}}
          @options={{this.refTypeOptions}}
        />
        <Args.Action
          @name='onInsert'
          @description='Called with the serialized BFM directive when the CTA is clicked. Watch the "Inserted:" readout above.'
          @required={{true}}
          @value={{this.onInsert}}
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

  private refTypeOptions = ['card', 'file'];
}
