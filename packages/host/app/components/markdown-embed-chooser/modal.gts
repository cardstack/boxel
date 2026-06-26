import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import focusTrap from 'ember-focus-trap/modifiers/focus-trap';

import ModalContainer from '@cardstack/host/components/modal-container';

import type MarkdownEmbedChooserService from '@cardstack/host/services/markdown-embed-chooser';
import type {
  MarkdownEmbedChooserRequest,
  MarkdownEmbedRefType,
} from '@cardstack/host/services/markdown-embed-chooser';

import TabPanel from './tab-panel';
import Tabs from './tabs';

interface Signature {
  Args: {};
}

// Modal shell for the combined chooser. Driven by the
// `markdown-embed-chooser` service: opens when a `chooseCardOrFile` /
// `editEmbed` call lands, closes when the user picks/cancels or hits Escape.
// Both tabs stay mounted while the modal is open so each tab keeps its own
// search/selection/W×H state across switches.
export default class MarkdownEmbedChooserModal extends Component<Signature> {
  @service declare private markdownEmbedChooser: MarkdownEmbedChooserService;

  // User clicks pinned to the request they were made against. The getter
  // ignores them once a new request arrives so the next opening starts on
  // its own `defaultTab`.
  @tracked private manuallySelectedTab: MarkdownEmbedRefType | undefined;
  @tracked
  private manualSelectionRequest: MarkdownEmbedChooserRequest | undefined;

  private get request() {
    return this.markdownEmbedChooser.currentRequest;
  }

  get activeTab(): MarkdownEmbedRefType {
    let req = this.request;
    if (
      this.manualSelectionRequest === req &&
      this.manuallySelectedTab !== undefined
    ) {
      return this.manuallySelectedTab;
    }
    return req?.defaultTab ?? 'card';
  }

  @action
  private setActiveTab(tab: MarkdownEmbedRefType) {
    this.manualSelectionRequest = this.request;
    this.manuallySelectedTab = tab;
  }

  @action
  private handleInsertCard(bfm: string, url: string) {
    this.markdownEmbedChooser.resolve({ refType: 'card', url, bfm });
  }

  @action
  private handleInsertFile(bfm: string, url: string) {
    this.markdownEmbedChooser.resolve({ refType: 'file', url, bfm });
  }

  @action
  private handleRemove() {
    this.markdownEmbedChooser.resolve({ remove: true });
  }

  @action
  private handleClose() {
    this.markdownEmbedChooser.resolve(undefined);
  }

  @action
  private handleKeydown(event: Event) {
    if ((event as KeyboardEvent).key === 'Escape') {
      this.handleClose();
    }
  }

  // Edit-mode preload is scoped to the matching tab. The other tab still
  // opens its mini chooser per Zeplin 08B.
  private get cardInitialTarget() {
    let it = this.request?.initialTarget;
    return it?.refType === 'card' ? it : undefined;
  }

  private get fileInitialTarget() {
    let it = this.request?.initialTarget;
    return it?.refType === 'file' ? it : undefined;
  }

  <template>
    {{#if this.request}}
      <ModalContainer
        class='markdown-embed-chooser-modal'
        @title='Embed a card or file'
        @onClose={{this.handleClose}}
        @size='large'
        @centered={{true}}
        @cardContainerClass='markdown-embed-chooser-modal__container'
        {{focusTrap
          isActive=true
          focusTrapOptions=(hash allowOutsideClick=true)
        }}
        {{on 'keydown' this.handleKeydown}}
        data-test-markdown-embed-chooser-modal
      >
        <:content>
          <Tabs
            @activeTab={{this.activeTab}}
            @onTabChange={{this.setActiveTab}}
          >
            <:cards>
              <TabPanel
                @refType='card'
                @onInsert={{this.handleInsertCard}}
                @initialTarget={{this.cardInitialTarget}}
                @onRemove={{this.handleRemove}}
              />
            </:cards>
            <:files>
              <TabPanel
                @refType='file'
                @onInsert={{this.handleInsertFile}}
                @initialTarget={{this.fileInitialTarget}}
                @onRemove={{this.handleRemove}}
              />
            </:files>
          </Tabs>
        </:content>
      </ModalContainer>
    {{/if}}
    <style scoped>
      .markdown-embed-chooser-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
        padding: var(--boxel-sp-sm) var(--boxel-sp);
      }
      :deep(.markdown-embed-chooser-modal__container) {
        height: 36rem;
      }
    </style>
  </template>
}
