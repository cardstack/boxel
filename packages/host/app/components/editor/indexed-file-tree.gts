import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import { TrackedSet } from 'tracked-built-ins';

import { eq } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import type { LocalPath } from '@cardstack/runtime-common/paths';

import scrollIntoViewModifier from '@cardstack/host/modifiers/scroll-into-view';
import {
  fileTreeFromIndex,
  type FileTreeNode,
} from '@cardstack/host/resources/file-tree-from-index';
import { normalizeDirPath } from '@cardstack/host/utils/normalized-dir-path';

interface Signature {
  Args: {
    realmURL: string;
    selectedFile?: LocalPath;
    openDirs?: LocalPath[];
    onFileSelected?: (entryPath: LocalPath) => void;
    onDirectorySelected?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
  };
}

export default class IndexedFileTree extends Component<Signature> {
  <template>
    <nav>
      <TreeLevel
        @entries={{this.fileTree.entries}}
        @fileTree={{this.fileTree}}
        @selectedFile={{if @selectedFile @selectedFile this.selectedFile}}
        @openDirs={{this.effectiveOpenDirs}}
        @onFileSelected={{this.selectFile}}
        @onDirectorySelected={{this.toggleDirectory}}
        @scrollPositionKey={{@scrollPositionKey}}
        @relativePath=''
      />
      {{#if this.showMask}}
        <div class='mask' data-test-file-tree-mask></div>
      {{/if}}
    </nav>

    <style scoped>
      .mask {
        position: absolute;
        top: 0;
        left: 0;
        background-color: white;
        height: 100%;
        width: 100%;
      }
      nav {
        position: relative;
      }
    </style>
  </template>

  private fileTree = fileTreeFromIndex(this, () => this.args.realmURL);
  private localOpenDirs = new TrackedSet<string>();
  @tracked private selectedFile?: LocalPath;
  @tracked private showMask = true;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.hideMask.perform();
  }

  private hideMask = restartableTask(async () => {
    // fine tuned to coincide with debounce in RestoreScrollPosition modifier
    await timeout(300);
    this.showMask = false;
  });

  private get effectiveOpenDirs(): Set<string> {
    if (this.args.openDirs) {
      return new Set(this.args.openDirs);
    }
    return this.localOpenDirs;
  }

  @action
  private selectFile(entryPath: LocalPath) {
    this.selectedFile = entryPath;
    this.args.onFileSelected?.(entryPath);
  }

  @action
  private toggleDirectory(entryPath: LocalPath) {
    let dirPath = normalizeDirPath(entryPath);

    if (this.localOpenDirs.has(dirPath)) {
      this.localOpenDirs.delete(dirPath);
    } else {
      this.localOpenDirs.add(dirPath);
    }

    this.args.onDirectorySelected?.(dirPath);
  }
}

interface TreeLevelSignature {
  Args: {
    entries: FileTreeNode[];
    fileTree: ReturnType<typeof fileTreeFromIndex>;
    selectedFile?: LocalPath;
    openDirs: Set<string>;
    onFileSelected: (entryPath: LocalPath) => void;
    onDirectorySelected: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
    relativePath: string;
  };
}

class TreeLevel extends Component<TreeLevelSignature> {
  <template>
    {{#each @entries as |entry|}}
      <div class='level' data-test-directory-level>
        {{#if (eq entry.kind 'file')}}
          <button
            data-test-file={{entry.path}}
            title={{entry.name}}
            {{on 'click' (fn @onFileSelected entry.path)}}
            {{scrollIntoViewModifier
              (this.isSelectedFile entry.path)
              container='file-tree'
              key=@scrollPositionKey
            }}
            class='file {{if (this.isSelectedFile entry.path) "selected"}}'
          >
            {{entry.name}}
          </button>
        {{else}}
          <button
            data-test-directory={{entry.path}}
            title={{entry.name}}
            {{on 'click' (fn @onDirectorySelected entry.path)}}
            class='directory'
          >
            <DropdownArrowDown
              class='icon
                {{if (this.isOpenDirectory entry.path) "open" "closed"}}'
            />{{entry.name}}
          </button>
          {{#if (this.isOpenDirectory entry.path)}}
            <TreeLevel
              @entries={{this.getChildren entry}}
              @fileTree={{@fileTree}}
              @selectedFile={{@selectedFile}}
              @openDirs={{@openDirs}}
              @onFileSelected={{@onFileSelected}}
              @onDirectorySelected={{@onDirectorySelected}}
              @scrollPositionKey={{@scrollPositionKey}}
              @relativePath={{entry.path}}
            />
          {{/if}}
        {{/if}}
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

  @action
  isSelectedFile(path: string): boolean {
    return this.args.selectedFile === path;
  }

  @action
  isOpenDirectory(path: string): boolean {
    let dirPath = normalizeDirPath(path);
    return this.args.openDirs.has(dirPath);
  }

  @action
  getChildren(entry: FileTreeNode): FileTreeNode[] {
    if (!entry.children) {
      return [];
    }
    return Array.from(entry.children.values());
  }
}
