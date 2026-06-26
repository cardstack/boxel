import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask } from 'ember-concurrency';

import { eq } from '@cardstack/boxel-ui/helpers';

import { isCardErrorJSONAPI } from '@cardstack/runtime-common';

import MiniCardChooser from '@cardstack/host/components/card-chooser/mini';
import MiniFileChooser from '@cardstack/host/components/file-chooser/mini';

import type StoreService from '@cardstack/host/services/store';

import type { CardDef, FileDef } from 'https://cardstack.com/base/card-api';

import MarkdownEmbedPreviewPane from './pane';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    refType: 'card' | 'file';
    onInsert: (bfm: string, url: string) => void;
  };
}

// One tab of the combined chooser: pairs the matching mini chooser (left
// panel) with the shared preview pane (right panel). Owns the tab-local
// `selectedTarget` so left-panel state — search query, highlighted row,
// scroll position — and pane state survive a switch to the other tab.
export default class MarkdownEmbedChooserTabPanel extends Component<Signature> {
  @service declare private store: StoreService;

  @tracked private selectedTarget: CardDef | FileDef | undefined;
  @tracked private selectedUrl: string | undefined;

  @action
  private onCardSelect(url: string) {
    this.loadTarget.perform(url, 'card');
  }

  @action
  private onFileSelect(url: string) {
    this.loadTarget.perform(url, 'file');
  }

  // Restart on every pick so a slow earlier load can't stomp the newer one.
  private loadTarget = restartableTask(
    async (url: string, refType: 'card' | 'file') => {
      this.selectedUrl = url;
      let result =
        refType === 'card'
          ? await this.store.get(url)
          : await this.store.get<FileDef>(url, { type: 'file-meta' });
      if (isCardErrorJSONAPI(result)) {
        this.selectedTarget = undefined;
        return;
      }
      this.selectedTarget = result as CardDef | FileDef;
    },
  );

  @action
  private handleInsert(bfm: string) {
    let url = this.selectedTarget?.id ?? this.selectedUrl;
    if (!url) return;
    this.args.onInsert(bfm, url);
  }

  <template>
    <div
      class='markdown-embed-chooser-tab-panel'
      data-test-markdown-embed-chooser-tab-panel={{@refType}}
      ...attributes
    >
      <div class='markdown-embed-chooser-tab-panel__left'>
        {{#if (eq @refType 'card')}}
          <MiniCardChooser
            @onSelect={{this.onCardSelect}}
            @selected={{this.selectedUrl}}
          />
        {{else}}
          <MiniFileChooser
            @onSelect={{this.onFileSelect}}
            @selected={{this.selectedUrl}}
          />
        {{/if}}
      </div>
      <div class='markdown-embed-chooser-tab-panel__right'>
        <MarkdownEmbedPreviewPane
          @target={{this.selectedTarget}}
          @refType={{@refType}}
          @onInsert={{this.handleInsert}}
        />
      </div>
    </div>
    <style scoped>
      .markdown-embed-chooser-tab-panel {
        display: flex;
        gap: var(--boxel-sp);
        width: 100%;
        height: 100%;
        min-height: 0;
      }
      .markdown-embed-chooser-tab-panel__left,
      .markdown-embed-chooser-tab-panel__right {
        flex: 1 1 0;
        min-width: 0;
        min-height: 0;
        border: 1px solid var(--boxel-300);
        border-radius: var(--boxel-border-radius);
        overflow: hidden;
        background-color: var(--boxel-light);
      }
    </style>
  </template>
}
