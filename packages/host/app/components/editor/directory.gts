import { fn, concat } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { TrackedArray } from 'tracked-built-ins';

import { eq } from '@cardstack/boxel-ui/helpers';

import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import { type LocalPath } from '@cardstack/runtime-common/paths';

import scrollIntoViewModifier from '@cardstack/host/modifiers/scroll-into-view';
import { directory } from '@cardstack/host/resources/directory';

interface Args {
  Args: {
    relativePath: string;
    realmURL: URL;
    selectedFile?: LocalPath;
    openDirs?: LocalPath[];
    onFileSelected?: (entryPath: LocalPath) => void;
    onDirectorySelected?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
  };
}

export default class Directory extends Component<Args> {
  <template>
    {{#each this.listing.entries key='path' as |entry|}}
      <div class='level' data-test-directory-level>
        {{#let (concat @relativePath entry.name) as |entryPath|}}
          {{#if (eq entry.kind 'file')}}
            <button
              data-test-file={{entryPath}}
              title={{entry.name}}
              {{on 'click' (fn this.selectFile entryPath)}}
              {{scrollIntoViewModifier
                (this.isSelectedFile entryPath)
                container='file-tree'
                key=@scrollPositionKey
              }}
              class='file {{if (this.isSelectedFile entryPath) "selected"}}'
            >
              {{entry.name}}
            </button>
          {{else}}
            <button
              data-test-directory={{entryPath}}
              title={{entry.name}}
              {{on 'click' (fn this.selectDirectory entryPath)}}
              class='directory'
            >
              <DropdownArrowDown
                class={{concat
                  'icon '
                  (if (this.isOpenDirectory entryPath) 'open' 'closed')
                }}
              />{{entry.name}}
            </button>
            {{#if (this.isOpenDirectory entryPath)}}
              <Directory
                @relativePath='{{@relativePath}}{{entry.name}}'
                @realmURL={{@realmURL}}
                @selectedFile={{if
                  @selectedFile
                  @selectedFile
                  this.selectedFile
                }}
                @openDirs={{if @openDirs @openDirs this.openDirs}}
                @onFileSelected={{this.selectFile}}
                @onDirectorySelected={{this.selectDirectory}}
                @scrollPositionKey={{@scrollPositionKey}}
              />
            {{/if}}
          {{/if}}
        {{/let}}
      </div>
    {{/each}}
    <style scoped>
      .level {
        --icon-length: 14px;
        --icon-margin: 4px;

        padding-left: 0em;
      }

      .level .level {
        padding-left: 1em;
      }

      .directory,
      .file {
        border-radius: var(--boxel-border-radius-xs);
        background: transparent;
        border: 0;
        padding: var(--boxel-sp-xxxs);
        width: 100%;
        text-align: start;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .directory:hover,
      .file:hover {
        background-color: var(--boxel-200);
      }

      .file.selected,
      .file:active {
        color: var(--boxel-dark);
        background-color: var(--boxel-highlight);
      }

      .directory {
        padding-left: 0;
      }

      .directory :deep(.icon) {
        width: var(--icon-length);
        height: var(--icon-length);
        margin-bottom: -2px;
        padding: 0 2px;
      }

      .directory :deep(.icon.closed) {
        transform: rotate(-90deg);
      }

      .file {
        padding-left: calc(var(--icon-length) + var(--icon-margin));
      }
    </style>
  </template>

  private listing = directory(
    this,
    () => this.args.relativePath,
    () => this.args.realmURL,
  );

  @tracked private selectedFile?: LocalPath;
  private openDirs: TrackedArray<LocalPath> = new TrackedArray();

  @action
  private selectFile(entryPath: LocalPath) {
    this.selectedFile = entryPath;
    this.args.onFileSelected?.(entryPath);
  }

  @action
  private selectDirectory(entryPath: LocalPath) {
    const dirPath = this.normalizeDirPath(entryPath);

    let index = this.openDirs.indexOf(dirPath);
    if (index !== -1) {
      this.openDirs.splice(index, 1);
    } else {
      this.openDirs.push(dirPath);
    }

    this.args.onDirectorySelected?.(dirPath);
  }

  @action
  private isSelectedFile(entryPath: LocalPath) {
    return this.args.selectedFile
      ? this.args.selectedFile === entryPath
      : this.selectedFile === entryPath;
  }

  @action
  private isOpenDirectory(entryPath: LocalPath) {
    let dirPath = this.normalizeDirPath(entryPath);
    let openDirs = this.args.openDirs ?? this.openDirs;

    return openDirs.includes(dirPath);
  }

  private normalizeDirPath(entryPath: LocalPath): LocalPath {
    return entryPath.endsWith('/') ? entryPath : `${entryPath}/`;
  }
}
