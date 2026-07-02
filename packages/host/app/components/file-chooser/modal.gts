import { registerDestructor } from '@ember/destroyable';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import perform from 'ember-concurrency/helpers/perform';
import onKeyMod from 'ember-keyboard/modifiers/on-key';

import {
  BoxelButton,
  FieldContainer,
  LoadingIndicator,
} from '@cardstack/boxel-ui/components';

import { eq } from '@cardstack/boxel-ui/helpers';

import {
  Deferred,
  RealmPaths,
  isCardErrorJSONAPI,
  loadCardDef,
  type CodeRef,
  type LocalPath,
} from '@cardstack/runtime-common';

import ModalContainer from '@cardstack/host/components/modal-container';

import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type StoreService from '@cardstack/host/services/store';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import FileChooser, { type FileChooserRealm } from './panel';

interface Signature {
  Args: {};
}

export default class FileChooserModal extends Component<Signature> {
  @tracked deferred?: Deferred<FileDef | undefined>;
  @tracked selectedFile?: LocalPath;
  @tracked fileTypeFilter?: CodeRef;
  @tracked fileFieldFilter?: Record<string, unknown>;
  @tracked fileTypeName?: string;
  @tracked acceptTypes?: string;
  @tracked initialRealmURL?: string;

  @service declare private operatorModeStateService: OperatorModeStateService;
  @service declare private store: StoreService;
  @service('loader-service') declare private loaderService: LoaderService;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    (globalThis as any)._CARDSTACK_FILE_CHOOSER = this;
    registerDestructor(this, () => {
      delete (globalThis as any)._CARDSTACK_FILE_CHOOSER;
    });
  }

  private get modalTitle(): string {
    if (this.fileTypeName) {
      return `Choose ${this.fileTypeName}`;
    }
    return 'Choose a File';
  }

  // public API
  async chooseFile<T extends FileDef>(opts?: {
    fileType?: CodeRef;
    fileTypeName?: string;
    fileFieldFilter?: Record<string, unknown>;
  }): Promise<undefined | T> {
    this.deferred = new Deferred();
    this.fileTypeFilter = opts?.fileType;
    this.fileFieldFilter = opts?.fileFieldFilter;
    this.fileTypeName = opts?.fileTypeName;
    this.acceptTypes = undefined;
    this.selectedFile = undefined;
    this.initialRealmURL = this.operatorModeStateService.realmURL?.toString();

    if (opts?.fileType) {
      try {
        let cardDef = await loadCardDef(opts.fileType, {
          loader: this.loaderService.loader,
        });
        this.acceptTypes = (cardDef as any).acceptTypes;
      } catch {
        // If we can't load the def, acceptTypes stays undefined (allow all)
      }
    }

    let file = await this.deferred.promise;
    if (file) {
      return file as T;
    } else {
      return undefined;
    }
  }

  private pickTask = task(
    async (
      selectedRealm: FileChooserRealm | undefined,
      path: LocalPath | undefined,
    ) => {
      let deferred = this.deferred;
      try {
        if (deferred && selectedRealm && path) {
          let fileURL = new RealmPaths(selectedRealm.url).fileURL(path);
          let file = await this.store.get<FileDef>(fileURL.href, {
            type: 'file-meta',
          });
          if (isCardErrorJSONAPI(file)) {
            deferred.reject(
              new Error(
                `file-chooser/modal: failed to load file meta for ${fileURL.href}`,
              ),
            );
            return;
          }
          deferred.fulfill(file);
        } else {
          // Cancel / Escape / close with no selection: settle the promise with
          // undefined so callers awaiting chooseFile() resume. Otherwise the
          // deferred is dropped unsettled by resetState() and the await hangs
          // forever — leaving a trigger button stuck disabled/loading.
          deferred?.fulfill(undefined);
        }
      } finally {
        this.resetState();
      }
    },
  );

  @action
  private handleFileSelected(path: LocalPath) {
    this.selectedFile = path;
  }

  @action
  private handleRealmChange() {
    // Stage cleared on workspace switch — the previous pick lived in a
    // different realm.
    this.selectedFile = undefined;
  }

  @action
  private handleUploadComplete(fileDef: FileDef) {
    if (this.deferred) {
      this.deferred.fulfill(fileDef);
      this.resetState();
    }
  }

  private resetState() {
    this.selectedFile = undefined;
    this.fileTypeFilter = undefined;
    this.fileFieldFilter = undefined;
    this.fileTypeName = undefined;
    this.acceptTypes = undefined;
    this.initialRealmURL = undefined;
    this.deferred = undefined;
  }

  @action private handleKeydown(event: Event) {
    let kbEvent = event as KeyboardEvent;
    if (kbEvent.key === 'Escape') {
      this.pickTask.perform(undefined, undefined);
      return;
    }
    if (kbEvent.key === 'Tab') {
      this.trapFocus(kbEvent);
    }
  }

  private trapFocus(event: KeyboardEvent) {
    const container = event.currentTarget as HTMLElement;
    const focusableSelector = [
      'button:not([disabled]):not([tabindex="-1"])',
      '[tabindex="0"]',
      'input:not([disabled])',
      'select:not([disabled])',
      'a[href]',
    ].join(', ');
    const focusable = Array.from(
      container.querySelectorAll<HTMLElement>(focusableSelector),
    );
    if (focusable.length < 2) return;
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;

    if (event.shiftKey) {
      if (document.activeElement === first) {
        event.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  <template>
    <style scoped>
      .choose-file-modal {
        --horizontal-gap: var(--boxel-sp-xs);
        --stack-card-footer-height: auto;
      }
      .choose-file-modal :deep(.dialog-box__content) {
        display: flex;
        flex-direction: column;
      }
      .choose-file-modal[data-drop-zone-active]::before {
        content: '';
        position: absolute;
        inset: 0;
        background-color: var(--boxel-darker-hover);
        pointer-events: none;
        z-index: 2;
      }
      .choose-file-modal[data-drop-zone-active]::after {
        content: attr(data-drop-zone-label);
        position: absolute;
        inset: 0;
        padding: var(--boxel-sp-xl);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--boxel-light);
        font: 600 var(--boxel-font-lg);
        text-align: center;
        pointer-events: none;
        z-index: 3;
      }
      .choose-file-modal > :deep(.boxel-modal__inner) {
        display: flex;
        position: relative;
        z-index: 1;
      }
      :deep(.choose-file-modal__container) {
        height: 32rem;
      }
      .field + .field {
        margin-top: var(--boxel-sp-sm);
      }
      .field {
        display: flex;
        flex-wrap: wrap;
        gap: var(--boxel-sp-xxxs) var(--horizontal-gap);
      }
      .field :deep(.label-container) {
        width: 8rem;
      }
      .field :deep(.content) {
        flex-grow: 1;
        max-width: 100%;
        min-width: 13rem;
      }
      .footer {
        display: flex;
        flex: 1;
        justify-content: space-between;
        align-items: center;
        gap: var(--boxel-sp-xs);
      }
      .footer-left {
        min-width: 0;
        flex: 1;
      }
      .footer-buttons {
        display: flex;
        gap: var(--horizontal-gap);
        align-items: center;
        margin-left: auto;
      }
      .realm-chooser {
        width: 100%;
      }
      .choose-file {
        overflow: visible;
        flex-wrap: nowrap;
        align-items: flex-start;
      }
      .choose-file :deep(.label-container) {
        flex: 0 0 8rem;
      }
      .choose-file :deep(.content) {
        height: 230px;
        overflow: auto;
        align-items: flex-start;
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-xxs);
        flex: 1 1 auto;
        min-width: 0;
      }
      .choose-file :deep(.content:has(:focus-visible)) {
        outline: 2px solid var(--ring, var(--boxel-highlight-hover));
        outline-offset: 2px;
      }
      .upload-progress {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex: 1;
      }
      .upload-spinner {
        --boxel-loading-indicator-size: 1.25em;
      }
      .upload-file-name {
        font: var(--boxel-font-xs);
        color: var(--boxel-600);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 120px;
      }
      .upload-error-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        flex: 1;
        min-width: 0;
      }
      .upload-error {
        color: var(--boxel-error-200);
        font: var(--boxel-font-xs);
        overflow-wrap: anywhere;
      }

      /* Ensure keyboard focus indicators are always visible throughout the modal */
      :deep(:focus-visible) {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: 2px;
      }
    </style>
    {{#if this.deferred}}
      <FileChooser
        @initialRealmURL={{this.initialRealmURL}}
        @fileTypeFilter={{this.fileTypeFilter}}
        @fileFieldFilter={{this.fileFieldFilter}}
        @acceptTypes={{this.acceptTypes}}
        @onRealmChange={{this.handleRealmChange}}
        @onFileSelected={{this.handleFileSelected}}
        @onUploadComplete={{this.handleUploadComplete}}
        as |chooser|
      >
        <ModalContainer
          @title={{this.modalTitle}}
          @onClose={{fn
            (perform this.pickTask)
            chooser.selectedRealm
            undefined
          }}
          @size='medium'
          @centered={{true}}
          {{on 'keydown' this.handleKeydown}}
          {{on 'dragenter' chooser.onDragEnter}}
          {{on 'dragover' chooser.onDragOver}}
          {{on 'dragleave' chooser.onDragLeave}}
          {{on 'drop' chooser.onDrop}}
          @cardContainerClass='choose-file-modal__container'
          class='choose-file-modal'
          data-drop-zone-active={{chooser.dropZoneActive}}
          data-drop-zone-label={{chooser.dropZoneLabel}}
          data-test-choose-file-modal
        >
          <:content>
            <FieldContainer class='field' @label='Workspace'>
              <chooser.RealmDropdown
                class='realm-chooser'
                data-test-choose-file-modal-realm-chooser
              />
            </FieldContainer>
            <FieldContainer
              class='field choose-file'
              @label='Choose File'
              @tag='div'
            >
              {{#if chooser.selectedRealm}}
                {{! Force recreation when realm changes or chooser reopens }}
                {{#each (array chooser.fileTreeKey)}}
                  <chooser.FileTree
                    @realmURL={{chooser.selectedRealm.url.href}}
                    @onFileConfirmed={{fn
                      (perform this.pickTask)
                      chooser.selectedRealm
                    }}
                    @autoFocus={{true}}
                  />
                {{/each}}
              {{/if}}
            </FieldContainer>
          </:content>
          <:footer>
            <div class='footer'>
              <div class='footer-left'>
                {{#if (eq chooser.currentUpload.state 'picking')}}
                  <BoxelButton
                    @size='tall'
                    @disabled={{true}}
                    data-test-choose-file-modal-upload-button
                  >
                    Choose a file&hellip;
                  </BoxelButton>
                {{else if (eq chooser.currentUpload.state 'uploading')}}
                  <div
                    class='upload-progress'
                    data-test-choose-file-modal-upload-progress
                  >
                    <span
                      class='upload-file-name'
                    >{{chooser.currentUpload.fileName}}</span>
                    <LoadingIndicator class='upload-spinner' />
                  </div>
                {{else if (eq chooser.currentUpload.state 'error')}}
                  <div class='upload-error-row'>
                    <BoxelButton
                      @size='tall'
                      {{on 'click' chooser.triggerUpload}}
                      data-test-choose-file-modal-upload-button
                    >
                      Retry&hellip;
                    </BoxelButton>
                    <div
                      class='upload-error'
                      data-test-choose-file-modal-upload-error
                    >{{chooser.currentUpload.error}}</div>
                  </div>
                {{else}}
                  <BoxelButton
                    @size='tall'
                    {{on 'click' chooser.triggerUpload}}
                    data-test-choose-file-modal-upload-button
                  >
                    Upload&hellip;
                  </BoxelButton>
                {{/if}}
              </div>
              <div class='footer-buttons'>
                <BoxelButton
                  @size='tall'
                  {{on
                    'click'
                    (fn (perform this.pickTask) chooser.selectedRealm undefined)
                  }}
                  {{onKeyMod 'Escape'}}
                  data-test-choose-file-modal-cancel-button
                >
                  Cancel
                </BoxelButton>
                <BoxelButton
                  @kind='primary'
                  @size='tall'
                  @disabled={{chooser.isUploadBusy}}
                  {{on
                    'click'
                    (fn
                      (perform this.pickTask)
                      chooser.selectedRealm
                      this.selectedFile
                    )
                  }}
                  {{onKeyMod 'Enter'}}
                  data-test-choose-file-modal-add-button
                >
                  Add
                </BoxelButton>
              </div>
            </div>
          </:footer>
        </ModalContainer>
      </FileChooser>
    {{/if}}
  </template>
}
