import { registerDestructor } from '@ember/destroyable';
import { hash } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
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

import {
  deriveFormatSeeds,
  type FormatSelectionSeeds,
} from './format-selection';
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

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    // Registers the global bridge `chooseMarkdownEmbed` / `editMarkdownEmbed`
    // in runtime-common dispatch to. Mirrors the card-chooser/file-chooser
    // pattern so the base-realm markdown editor can open the modal without a
    // direct host import.
    (globalThis as any)._CARDSTACK_MARKDOWN_EMBED_CHOOSER = {
      chooseCardOrFile: (opts: { defaultTab?: MarkdownEmbedRefType }) =>
        this.markdownEmbedChooser.chooseCardOrFile(opts),
      editEmbed: (
        target: Parameters<MarkdownEmbedChooserService['editEmbed']>[0],
      ) => this.markdownEmbedChooser.editEmbed(target),
    };
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_MARKDOWN_EMBED_CHOOSER;
    });
  }

  private get request() {
    return this.markdownEmbedChooser.currentRequest;
  }

  // The editing document's own URL, threaded to both tabs so the chooser
  // relativizes the picked ref against it (matching the format-picker path).
  private get documentBaseUrl(): string | undefined {
    return this.request?.documentBaseUrl;
  }

  // Seeds for the shared format selection. `Tabs` owns the actual
  // `EmbedFormatSelection` instance — it lives inside the `{{#if this.request}}`
  // block, so it's created once per chooser invocation (seeded here from the
  // edited directive in edit mode) and torn down on close. Owning it there,
  // rather than in a getter on this persistent component, keeps the instance
  // stable across re-renders so the user's choice actually sticks.
  get formatSeeds(): FormatSelectionSeeds {
    let it = this.request?.initialTarget;
    return it ? deriveFormatSeeds(it.sizeSpec, it.kind) : {};
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
      // Own the Escape here: stop it before it reaches the document-level
      // operator-mode handler, which would otherwise flip the card out of edit
      // format once closing this modal has cleared the `has-modal` guard.
      event.preventDefault();
      event.stopPropagation();
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
        @title=''
        @onClose={{this.handleClose}}
        @closeButtonLabel='close'
        @closeButtonShortcut='ESC'
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
          <Tabs @activeTab={{this.activeTab}} @seeds={{this.formatSeeds}}>
            <:cards as |selection|>
              <TabPanel
                @refType='card'
                @activeTab={{this.activeTab}}
                @onTabChange={{this.setActiveTab}}
                @onInsert={{this.handleInsertCard}}
                @selection={{selection}}
                @initialTarget={{this.cardInitialTarget}}
                @documentBaseUrl={{this.documentBaseUrl}}
                @onRemove={{this.handleRemove}}
              />
            </:cards>
            <:files as |selection|>
              <TabPanel
                @refType='file'
                @activeTab={{this.activeTab}}
                @onTabChange={{this.setActiveTab}}
                @onInsert={{this.handleInsertFile}}
                @selection={{selection}}
                @initialTarget={{this.fileInitialTarget}}
                @documentBaseUrl={{this.documentBaseUrl}}
                @onRemove={{this.handleRemove}}
              />
            </:files>
          </Tabs>
        </:content>
      </ModalContainer>
    {{/if}}
    <style scoped>
      /* Collapse the (empty) modal header band to nothing. With @title='' and
         no <:header> content it holds only the built-in close button, which is
         position:absolute and out of flow — so the band disappears while the
         × keeps floating at the modal's top-right corner. */
      .markdown-embed-chooser-modal :deep(.dialog-box__header) {
        min-height: 0;
        padding: 0;
      }
      /* Full-bleed body: the two columns and the divider between them run to
         the modal edges, so the content gets no padding of its own — each
         column's inner components supply their own insets. */
      .markdown-embed-chooser-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
        padding: 0;
      }
      :deep(.markdown-embed-chooser-modal__container) {
        height: 36rem;
      }
      /* Re-center the fixed-height modal box vertically. Operator mode ships a
         global `.operator-mode .boxel-modal__inner { display: block }` that
         outranks boxel-ui's base `.boxel-modal__inner { display: flex }`, which
         drops the inner's flex centering and top-aligns our 36rem box. Restore
         flex on our own inner so `@centered` actually centers it. */
      .markdown-embed-chooser-modal > :deep(.boxel-modal__inner) {
        display: flex;
      }
    </style>
  </template>
}
