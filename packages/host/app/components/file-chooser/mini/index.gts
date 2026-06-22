import { array, fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { BoxelButton, LoadingIndicator } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import { RealmPaths, type LocalPath } from '@cardstack/runtime-common';

import type { FileDef } from 'https://cardstack.com/base/file-api';

import FileChooser, { type FileChooserRealm } from '../panel';

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
  // The user's most recent in-tree pick, relative to the selected realm. Seeds
  // the tree's highlight and takes precedence over @selected once the user acts.
  @tracked private userSelectedFile?: LocalPath;

  // Highlighted tree row: the user's own pick wins; otherwise derive a local
  // path from @selected when it lives inside the open workspace.
  private selectedFileFor = (
    selectedRealm: FileChooserRealm | undefined,
  ): LocalPath | undefined => {
    if (this.userSelectedFile) {
      return this.userSelectedFile;
    }
    let { selected } = this.args;
    if (!selected || !selectedRealm) {
      return undefined;
    }
    let paths = new RealmPaths(selectedRealm.url);
    try {
      let url = new URL(selected);
      if (paths.inRealm(url)) {
        return paths.local(url);
      }
    } catch {
      // malformed URL or outside the realm — nothing to highlight
    }
    return undefined;
  };

  @action
  private handleRealmChange() {
    this.userSelectedFile = undefined;
  }

  @action
  private handleFileSelected(
    realm: FileChooserRealm | undefined,
    path: LocalPath,
  ) {
    if (!realm) {
      return;
    }
    this.userSelectedFile = path;
    let url = new RealmPaths(realm.url).fileURL(path);
    this.args.onSelect(url.href);
  }

  @action
  private handleUploadComplete(fileDef: FileDef) {
    if (fileDef.sourceUrl) {
      this.userSelectedFile = undefined;
      this.args.onSelect(fileDef.sourceUrl);
    }
  }

  <template>
    <FileChooser
      @initialRealmURL={{@initialRealmURL}}
      @onRealmChange={{this.handleRealmChange}}
      @onUploadComplete={{this.handleUploadComplete}}
      as |chooser|
    >
      <div
        class='mini-file-chooser'
        data-test-mini-file-chooser
        data-drop-zone-active={{chooser.dropZoneActive}}
        data-drop-zone-label={{chooser.dropZoneLabel}}
        {{on 'dragenter' chooser.onDragEnter}}
        {{on 'dragover' chooser.onDragOver}}
        {{on 'dragleave' chooser.onDragLeave}}
        {{on 'drop' chooser.onDrop}}
        ...attributes
      >
        <div class='mini-file-chooser__field'>
          <span class='mini-file-chooser__label'>Workspace</span>
          <chooser.RealmDropdown
            class='mini-file-chooser__realm-chooser'
            data-test-mini-file-chooser-realm-chooser
          />
        </div>

        <div class='mini-file-chooser__field mini-file-chooser__tree-field'>
          <span class='mini-file-chooser__label'>Choose File</span>
          <div class='mini-file-chooser__tree'>
            {{#if chooser.selectedRealm}}
              {{! Force recreation when the realm changes }}
              {{#each (array chooser.fileTreeKey)}}
                <chooser.FileTree
                  @realmURL={{chooser.selectedRealm.url.href}}
                  @selectedFile={{this.selectedFileFor chooser.selectedRealm}}
                  @onFileSelected={{fn
                    this.handleFileSelected
                    chooser.selectedRealm
                  }}
                  @onFileConfirmed={{fn
                    this.handleFileSelected
                    chooser.selectedRealm
                  }}
                  @autoFocus={{true}}
                />
              {{/each}}
            {{/if}}
          </div>
        </div>

        <div class='mini-file-chooser__footer'>
          {{#if (eq chooser.currentUpload.state 'picking')}}
            <BoxelButton
              @disabled={{true}}
              data-test-mini-file-chooser-upload-button
            >
              Choose a file&hellip;
            </BoxelButton>
          {{else if (eq chooser.currentUpload.state 'uploading')}}
            <div
              class='mini-file-chooser__upload-progress'
              data-test-mini-file-chooser-upload-progress
            >
              <span
                class='mini-file-chooser__upload-name'
              >{{chooser.currentUpload.fileName}}</span>
              <LoadingIndicator class='mini-file-chooser__upload-spinner' />
            </div>
          {{else if (eq chooser.currentUpload.state 'error')}}
            <div class='mini-file-chooser__upload-error-row'>
              <BoxelButton
                {{on 'click' chooser.triggerUpload}}
                data-test-mini-file-chooser-upload-button
              >
                Retry&hellip;
              </BoxelButton>
              <div
                class='mini-file-chooser__upload-error'
                data-test-mini-file-chooser-upload-error
              >{{chooser.currentUpload.error}}</div>
            </div>
          {{else}}
            <BoxelButton
              {{on 'click' chooser.triggerUpload}}
              data-test-mini-file-chooser-upload-button
            >
              Upload&hellip;
            </BoxelButton>
          {{/if}}
        </div>
      </div>
    </FileChooser>

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
      /* Drag-and-drop overlay: dim the chooser and surface the drop label. */
      .mini-file-chooser[data-drop-zone-active]::before {
        content: '';
        position: absolute;
        inset: 0;
        background-color: var(--boxel-darker-hover);
        pointer-events: none;
        z-index: 2;
      }
      .mini-file-chooser[data-drop-zone-active]::after {
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
