import { fn, concat, array } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';

import { tracked } from '@glimmer/tracking';

import { TrackedArray } from 'tracked-built-ins';

import {
  BoxelDropdown,
  ContextButton,
  Menu,
  type BoxelDropdownAPI,
} from '@cardstack/boxel-ui/components';
import { eq, menuItem } from '@cardstack/boxel-ui/helpers';

import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import type { LocalPath } from '@cardstack/runtime-common/paths';

import scrollIntoViewModifier from '@cardstack/host/modifiers/scroll-into-view';
import { directory } from '@cardstack/host/resources/directory';
import { normalizeDirPath } from '@cardstack/host/utils/normalized-dir-path';

interface Args {
  Args: {
    relativePath: string;
    realmURL: string;
    selectedFile?: LocalPath;
    openDirs?: LocalPath[];
    onFileSelected?: (entryPath: LocalPath) => void;
    onDirectorySelected?: (entryPath: LocalPath) => void;
    onDeleteFile?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
  };
}

export default class Directory extends Component<Args> {
  <template>
    {{#each this.listing.entries key='path' as |entry|}}
      <div class='level' data-test-directory-level>
        {{#let (concat @relativePath entry.name) as |entryPath|}}
          {{#if (eq entry.kind 'file')}}
            <div
              class='file-row {{if (this.isSelectedFile entryPath) "selected"}}'
              data-test-file-row={{entryPath}}
              {{on 'contextmenu' (fn this.onFileRowContextMenu entryPath)}}
            >
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
              {{#if @onDeleteFile}}
                <BoxelDropdown
                  @registerAPI={{fn this.registerDropdownApi entryPath}}
                  @contentClass='file-tree-context-menu'
                >
                  <:trigger as |bindings|>
                    <ContextButton
                      class='file-menu-trigger'
                      @icon='context-menu'
                      @size='extra-small'
                      @label='File options'
                      @variant='ghost'
                      {{bindings}}
                    />
                  </:trigger>
                  <:content as |dd|>
                    <Menu
                      class='file-tree-context-menu-list'
                      @items={{array
                        (menuItem
                          'Delete'
                          (fn this.deleteFileEntry entryPath)
                          dangerous=true
                        )
                      }}
                      @closeMenu={{dd.close}}
                    />
                  </:content>
                </BoxelDropdown>
              {{/if}}
            </div>
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
                @onDeleteFile={{@onDeleteFile}}
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

      .file-row {
        display: flex;
        align-items: center;
        border-radius: var(--boxel-border-radius-xs);
      }

      .file-row:hover,
      .file-row:focus-within {
        background-color: var(--boxel-200);
      }

      .file-row.selected {
        color: var(--boxel-dark);
        background-color: var(--boxel-highlight);
      }

      .file-row .file {
        flex: 1;
        min-width: 0;
        background: transparent;
        border: 0;
        padding: var(--boxel-sp-xxxs);
        padding-left: calc(var(--icon-length) + var(--icon-margin));
        text-align: start;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        color: inherit;
        border-radius: var(--boxel-border-radius-xs);
      }

      .file-menu-trigger {
        flex-shrink: 0;
        visibility: hidden;
        margin-right: var(--boxel-sp-xxxs);
      }

      .file-row:hover .file-menu-trigger,
      .file-row:focus-within .file-menu-trigger {
        visibility: visible;
      }

      .directory {
        border-radius: var(--boxel-border-radius-xs);
        background: transparent;
        border: 0;
        padding: var(--boxel-sp-xxxs);
        width: 100%;
        text-align: start;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        padding-left: 0;
      }

      .directory:hover {
        background-color: var(--boxel-200);
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
    </style>
  </template>

  private listing = directory(
    this,
    () => this.args.relativePath,
    () => this.args.realmURL,
  );

  @tracked private selectedFile?: LocalPath;
  private openDirs: TrackedArray<LocalPath> = new TrackedArray();
  private dropdownApis = new Map<LocalPath, BoxelDropdownAPI>();

  @action
  private selectFile(entryPath: LocalPath) {
    this.selectedFile = entryPath;
    this.args.onFileSelected?.(entryPath);
  }

  @action
  private selectDirectory(entryPath: LocalPath) {
    const dirPath = normalizeDirPath(entryPath);

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
    let dirPath = normalizeDirPath(entryPath);
    let openDirs = this.args.openDirs ?? this.openDirs;

    return openDirs.includes(dirPath);
  }

  @action
  private registerDropdownApi(entryPath: LocalPath, api: BoxelDropdownAPI) {
    this.dropdownApis.set(entryPath, api);
  }

  @action
  private onFileRowContextMenu(entryPath: LocalPath, e: MouseEvent) {
    if (!this.args.onDeleteFile) {
      return;
    }
    e.preventDefault();
    const api = this.dropdownApis.get(entryPath);
    api?.actions.open(e);
  }

  @action
  private deleteFileEntry(entryPath: LocalPath) {
    this.args.onDeleteFile?.(entryPath);
  }
}
