import { registerDestructor } from '@ember/destroyable';
import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import { service } from '@ember/service';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { task } from 'ember-concurrency';
import onKeyMod from 'ember-keyboard/modifiers/on-key';
import pluralize from 'pluralize';

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
  type FileChooserOpts,
  type LocalPath,
} from '@cardstack/runtime-common';

import ModalContainer from '@cardstack/host/components/modal-container';

import type LoaderService from '@cardstack/host/services/loader-service';
import type OperatorModeStateService from '@cardstack/host/services/operator-mode-state-service';
import type StoreService from '@cardstack/host/services/store';

import FileChooser, { type FileChooserRealm } from './panel';

import type { FileDef } from '@cardstack/base/file-api';

interface Signature {
  Args: {};
}

export default class FileChooserModal extends Component<Signature> {
  @tracked deferred?: Deferred<FileDef[] | undefined>;
  @tracked multiSelect = false;
  @tracked selectedFiles: LocalPath[] = [];
  // The realm `selectedFiles` are paths in, captured when a file is picked so
  // they resolve against that realm even if the dropdown has moved on since.
  private selectionRealm?: FileChooserRealm;
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
    return this.multiSelect ? 'Choose Files' : 'Choose a File';
  }

  private get addButtonText(): string {
    let count = this.selectedFiles.length;
    if (!this.multiSelect || count === 0) {
      return 'Add';
    }
    return `Add ${count} ${pluralize('File', count)}`;
  }

  // public API
  async chooseFile<T extends FileDef>(
    opts?: FileChooserOpts & { multiSelect?: boolean },
  ): Promise<undefined | T | T[]> {
    let multiSelect = opts?.multiSelect ?? false;
    this.deferred = new Deferred();
    this.multiSelect = multiSelect;
    this.fileTypeFilter = opts?.fileType;
    this.fileFieldFilter = opts?.fileFieldFilter;
    this.fileTypeName = opts?.fileTypeName;
    this.acceptTypes = undefined;
    this.selectedFiles = [];
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

    let files = (await this.deferred.promise) as T[] | undefined;
    if (!files?.length) {
      return undefined;
    }
    return multiSelect ? files : files[0];
  }

  // `paths` are resolved against `selectedRealm`. `uploaded` holds files
  // already loaded by an upload; they are returned after the picked paths,
  // skipping any the paths already produced.
  private pickTask = task(
    async (
      selectedRealm: FileChooserRealm | undefined,
      paths: LocalPath[],
      uploaded: FileDef[],
    ) => {
      let deferred = this.deferred;
      try {
        let realmPaths = selectedRealm
          ? new RealmPaths(selectedRealm.id)
          : undefined;
        let fileIds = realmPaths
          ? paths.map((path) => realmPaths.fileRRI(path))
          : [];
        if (deferred && (fileIds.length || uploaded.length)) {
          let loaded = await Promise.all(
            fileIds.map((fileId) =>
              this.store.get(fileId, { type: 'file-meta' }),
            ),
          );
          let picked: FileDef[] = [];
          for (let [index, file] of loaded.entries()) {
            if (isCardErrorJSONAPI(file)) {
              deferred.reject(
                new Error(
                  `file-chooser/modal: failed to load file meta for ${fileIds[index]}`,
                ),
              );
              return;
            }
            picked.push(file);
          }
          for (let file of uploaded) {
            if (!picked.some((p) => p.id === file.id)) {
              picked.push(file);
            }
          }
          deferred.fulfill(picked);
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
  private handleFileSelected(path: LocalPath, realm: FileChooserRealm) {
    this.selectionRealm = realm;
    if (!this.multiSelect) {
      this.selectedFiles = [path];
    } else if (this.selectedFiles.includes(path)) {
      this.selectedFiles = this.selectedFiles.filter((p) => p !== path);
    } else {
      this.selectedFiles = [...this.selectedFiles, path];
    }
  }

  // Enter on a file in the tree. In multi-select it confirms the current
  // selection, falling back to the file under the cursor when nothing is
  // selected yet.
  @action
  private handleFileConfirmed(
    selectedRealm: FileChooserRealm | undefined,
    path: LocalPath,
  ) {
    let paths =
      this.multiSelect && this.selectedFiles.length
        ? this.selectedFiles
        : [path];
    this.pickTask.perform(selectedRealm, paths, []);
  }

  @action
  private addSelectedFiles(selectedRealm: FileChooserRealm | undefined) {
    this.pickTask.perform(selectedRealm, this.selectedFiles, []);
  }

  @action
  private cancel() {
    this.pickTask.perform(undefined, [], []);
  }

  @action
  private handleRealmChange() {
    // Stage cleared on workspace switch — the previous pick lived in a
    // different realm.
    this.selectedFiles = [];
    this.selectionRealm = undefined;
  }

  // An upload confirms the chooser. In multi-select the files already
  // selected are kept alongside the uploaded one. They resolve against the
  // realm they were picked in, which need not be the realm the upload went
  // to: the workspace can be switched while an upload is running.
  @action
  private handleUploadComplete(fileDef: FileDef) {
    if (!this.deferred) {
      return;
    }
    if (this.multiSelect) {
      this.pickTask.perform(this.selectionRealm, this.selectedFiles, [fileDef]);
      return;
    }
    this.deferred.fulfill([fileDef]);
    this.resetState();
  }

  private resetState() {
    this.multiSelect = false;
    this.selectedFiles = [];
    this.selectionRealm = undefined;
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
      this.cancel();
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
        @multiSelect={{this.multiSelect}}
        @selectedFiles={{this.selectedFiles}}
        @onRealmChange={{this.handleRealmChange}}
        @onFileSelected={{this.handleFileSelected}}
        @onUploadComplete={{this.handleUploadComplete}}
        as |chooser|
      >
        <ModalContainer
          @title={{this.modalTitle}}
          @onClose={{this.cancel}}
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
                    @realmURL={{chooser.selectedRealm.id}}
                    @onFileConfirmed={{fn
                      this.handleFileConfirmed
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
                  {{on 'click' this.cancel}}
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
                    (fn this.addSelectedFiles chooser.selectedRealm)
                  }}
                  {{onKeyMod 'Enter'}}
                  data-test-choose-file-modal-add-button
                >
                  {{this.addButtonText}}
                </BoxelButton>
              </div>
            </div>
          </:footer>
        </ModalContainer>
      </FileChooser>
    {{/if}}
  </template>
}
