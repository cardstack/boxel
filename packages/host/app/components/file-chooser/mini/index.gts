import { array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { service } from '@ember/service';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { BoxelButton, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { RealmPaths, type LocalPath } from '@cardstack/runtime-common';

import type FileUploadService from '@cardstack/host/services/file-upload';
import type { FileUploadTask } from '@cardstack/host/services/file-upload';
import type RealmService from '@cardstack/host/services/realm';

import IndexedFileTree from '../../editor/indexed-file-tree';
import RealmDropdown, { type RealmDropdownItem } from '../../realm-dropdown';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    // Fired with the absolute URL of the file the user picks from the tree or
    // finishes uploading. The hosting container decides what to do with it
    // (this primitive never confirms or dismisses on its own).
    onSelect: (url: string) => void;
    // Workspace to open on first render. Read once at mount; later parent
    // updates are ignored. Defaults to the first known realm.
    initialRealmURL?: string;
    // Absolute URL of the currently selected file — the matching tree row gets
    // the selection highlight. Omit for a chooser with no pinned selection.
    selected?: string;
  };
}

export default class MiniFileChooser extends Component<Signature> {
  @service declare private realm: RealmService;
  @service('file-upload') declare private fileUpload: FileUploadService;

  @tracked private selectedRealm = this.initialRealm;
  // The user's most recent in-tree pick, relative to the selected realm. Seeds
  // the tree's highlight and takes precedence over @selected once the user acts.
  @tracked private userSelectedFile?: LocalPath;
  @tracked private currentUpload?: FileUploadTask;
  @tracked private isDropZoneActive = false;
  // Bumped on realm switch so IndexedFileTree (which keys off realm internally)
  // is fully recreated rather than reused across workspaces.
  @tracked private fileTreeRenderNonce = 0;
  private dropZoneDragDepth = 0;

  private get knownRealms() {
    return Object.entries(this.realm.allRealmsInfo).map((entry) => ({
      url: new URL(entry[0]),
      info: entry[1].info,
    }));
  }

  private get initialRealm() {
    let realms = this.knownRealms;
    let match = this.args.initialRealmURL
      ? realms.find((r) => r.url.href === this.args.initialRealmURL)
      : undefined;
    return match ?? realms[0];
  }

  // Highlighted tree row: the user's own pick wins; otherwise derive a local
  // path from @selected when it lives inside the open workspace.
  private get selectedFile(): LocalPath | undefined {
    if (this.userSelectedFile) {
      return this.userSelectedFile;
    }
    let { selected } = this.args;
    if (!selected || !this.selectedRealm) {
      return undefined;
    }
    let paths = new RealmPaths(this.selectedRealm.url);
    try {
      let url = new URL(selected);
      if (paths.inRealm(url)) {
        return paths.local(url);
      }
    } catch {
      // malformed URL or outside the realm — nothing to highlight
    }
    return undefined;
  }

  private get fileTreeRenderKey(): string {
    return `${this.fileTreeRenderNonce}:${this.selectedRealm.url.href}`;
  }

  private get isUploadBusy(): boolean {
    let state = this.currentUpload?.state;
    return state === 'picking' || state === 'uploading';
  }

  private get dropZoneLabel() {
    return `Drop file to upload to ${this.selectedRealm.info.name}`;
  }

  @action
  private selectRealm({ path }: RealmDropdownItem) {
    let realm = this.knownRealms.find((r) => r.url.href === path);
    if (realm) {
      this.selectedRealm = realm;
      this.userSelectedFile = undefined;
      this.fileTreeRenderNonce++;
    }
  }

  @action
  private selectFile(path: LocalPath) {
    this.userSelectedFile = path;
    let url = new RealmPaths(this.selectedRealm.url).fileURL(path);
    this.args.onSelect(url.href);
  }

  @action
  private triggerUpload() {
    let task = this.fileUpload.uploadFile({
      realmURL: this.selectedRealm.url,
    });
    this.beginUpload(task);
  }

  @action
  private handleDragEnter(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer)) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth++;
    this.isDropZoneActive = true;
  }

  @action
  private handleDragOver(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer)) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.isDropZoneActive = true;
    if (dragEvent.dataTransfer) {
      dragEvent.dataTransfer.dropEffect = 'copy';
    }
  }

  @action
  private handleDragLeave(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer) && !this.isDropZoneActive) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth = Math.max(0, this.dropZoneDragDepth - 1);
    if (this.dropZoneDragDepth === 0) {
      this.isDropZoneActive = false;
    }
  }

  @action
  private handleDrop(event: Event) {
    let dragEvent = event as DragEvent;
    if (!this.isFileDrag(dragEvent.dataTransfer)) {
      return;
    }
    dragEvent.preventDefault();
    dragEvent.stopPropagation();
    this.dropZoneDragDepth = 0;
    this.isDropZoneActive = false;
    if (this.isUploadBusy) {
      return;
    }
    let file = dragEvent.dataTransfer?.files?.[0];
    if (!file) {
      return;
    }
    let task = this.fileUpload.uploadProvidedFile({
      realmURL: this.selectedRealm.url,
      file,
    });
    this.beginUpload(task);
  }

  private beginUpload(task: FileUploadTask) {
    this.currentUpload = task;
    task.result.then((fileDef) => {
      if (fileDef?.sourceUrl) {
        this.userSelectedFile = undefined;
        this.currentUpload = undefined;
        this.args.onSelect(fileDef.sourceUrl);
      } else if (task.state !== 'error') {
        this.currentUpload = undefined;
      }
    });
  }

  private isFileDrag(dataTransfer: DataTransfer | null | undefined): boolean {
    if (!dataTransfer) {
      return false;
    }
    return Array.from(dataTransfer.types ?? []).includes('Files');
  }

  <template>
    <div
      class='mini-file-chooser'
      data-test-mini-file-chooser
      data-drop-zone-active={{this.isDropZoneActive}}
      data-drop-zone-label={{this.dropZoneLabel}}
      {{on 'dragenter' this.handleDragEnter}}
      {{on 'dragover' this.handleDragOver}}
      {{on 'dragleave' this.handleDragLeave}}
      {{on 'drop' this.handleDrop}}
      ...attributes
    >
      <div class='mini-file-chooser__field'>
        <span class='mini-file-chooser__label'>Workspace</span>
        <RealmDropdown
          class='mini-file-chooser__realm-chooser'
          @selectedRealmURL={{this.selectedRealm.url.href}}
          @onSelect={{this.selectRealm}}
          @displayReadOnlyTag={{true}}
          data-test-mini-file-chooser-realm-chooser
        />
      </div>

      <div class='mini-file-chooser__field mini-file-chooser__tree-field'>
        <span class='mini-file-chooser__label'>Choose File</span>
        <div class='mini-file-chooser__tree'>
          {{! Force recreation when the realm changes }}
          {{#each (array this.fileTreeRenderKey)}}
            <IndexedFileTree
              @realmURL={{this.selectedRealm.url.href}}
              @selectedFile={{this.selectedFile}}
              @onFileSelected={{this.selectFile}}
              @onFileConfirmed={{this.selectFile}}
              @autoFocus={{true}}
            />
          {{/each}}
        </div>
      </div>

      <div class='mini-file-chooser__footer'>
        {{#if (eq this.currentUpload.state 'picking')}}
          <BoxelButton
            @disabled={{true}}
            data-test-mini-file-chooser-upload-button
          >
            Choose a file&hellip;
          </BoxelButton>
        {{else if (eq this.currentUpload.state 'uploading')}}
          <div
            class='mini-file-chooser__upload-progress'
            data-test-mini-file-chooser-upload-progress
          >
            <span
              class='mini-file-chooser__upload-name'
            >{{this.currentUpload.fileName}}</span>
            <LoadingIndicator class='mini-file-chooser__upload-spinner' />
          </div>
        {{else if (eq this.currentUpload.state 'error')}}
          <div class='mini-file-chooser__upload-error-row'>
            <BoxelButton
              {{on 'click' this.triggerUpload}}
              data-test-mini-file-chooser-upload-button
            >
              Retry&hellip;
            </BoxelButton>
            <div
              class='mini-file-chooser__upload-error'
              data-test-mini-file-chooser-upload-error
            >{{this.currentUpload.error}}</div>
          </div>
        {{else}}
          <BoxelButton
            {{on 'click' this.triggerUpload}}
            data-test-mini-file-chooser-upload-button
          >
            Upload&hellip;
          </BoxelButton>
        {{/if}}
      </div>
    </div>

    <style scoped>
      .mini-file-chooser {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xs);
        width: 100%;
        height: 100%;
        min-height: 0;
        padding: var(--boxel-sp-xs);
        background-color: var(--boxel-light);
      }
      .mini-file-chooser__field {
        display: flex;
        flex-direction: column;
        gap: var(--boxel-sp-xxxs);
        flex: 0 0 auto;
      }
      .mini-file-chooser__tree-field {
        flex: 1 1 auto;
        min-height: 0;
      }
      .mini-file-chooser__label {
        font: 600 var(--boxel-font-sm);
        color: var(--boxel-dark);
      }
      .mini-file-chooser__realm-chooser {
        width: 100%;
      }
      .mini-file-chooser__tree {
        flex: 1 1 auto;
        min-height: 0;
        overflow: auto;
        border: var(--boxel-border);
        border-radius: var(--boxel-border-radius);
        padding: var(--boxel-sp-xxs);
      }
      .mini-file-chooser__tree:focus-within {
        outline: 2px solid var(--ring, var(--boxel-highlight-hover));
        outline-offset: 2px;
      }
      .mini-file-chooser__tree :deep([data-file-tree-nav]:focus-visible) {
        outline: none;
      }
      .mini-file-chooser__footer {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .mini-file-chooser__upload-progress {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .mini-file-chooser__upload-name {
        font: var(--boxel-font-xs);
        color: var(--boxel-600);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        max-width: 120px;
      }
      .mini-file-chooser__upload-spinner {
        --boxel-loading-indicator-size: 1.25em;
      }
      .mini-file-chooser__upload-error-row {
        display: flex;
        align-items: center;
        gap: var(--boxel-sp-xs);
        min-width: 0;
      }
      .mini-file-chooser__upload-error {
        color: var(--boxel-error-200);
        font: var(--boxel-font-xs);
        overflow-wrap: anywhere;
      }
      /* Drag-and-drop overlay: dim the chooser and surface the drop label,
         mirroring choose-file-modal's drop-zone treatment. */
      .mini-file-chooser[data-drop-zone-active='true']::before {
        content: '';
        position: absolute;
        inset: 0;
        background-color: var(--boxel-darker-hover);
        pointer-events: none;
        z-index: 2;
      }
      .mini-file-chooser[data-drop-zone-active='true']::after {
        content: attr(data-drop-zone-label);
        position: absolute;
        inset: 0;
        padding: var(--boxel-sp-lg);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--boxel-light);
        font: 600 var(--boxel-font);
        text-align: center;
        pointer-events: none;
        z-index: 3;
      }
    </style>
  </template>
}
