import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import { restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { TrackedSet } from 'tracked-built-ins';

import { LoadingIndicator } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';
import { DropdownArrowDown } from '@cardstack/boxel-ui/icons';

import type { CodeRef } from '@cardstack/runtime-common';
import type { LocalPath } from '@cardstack/runtime-common/paths';

import scrollIntoViewModifier from '@cardstack/host/modifiers/scroll-into-view';
import {
  fileTreeFromIndex,
  type FileTreeNode,
} from '@cardstack/host/resources/file-tree-from-index';
import { normalizeDirPath } from '@cardstack/host/utils/normalized-dir-path';

// Focuses the element on first insertion when the positional arg is true.
class AutoFocusModifier extends Modifier<{
  Element: HTMLElement;
  Args: { Positional: [boolean | undefined] };
}> {
  #firstRun = true;

  modify(element: HTMLElement, [shouldFocus]: [boolean | undefined]) {
    if (shouldFocus && this.#firstRun) {
      this.#firstRun = false;
      element.focus();
    }
  }
}

interface Signature {
  Args: {
    realmURL: string;
    fileTypeFilter?: CodeRef;
    selectedFile?: LocalPath;
    openDirs?: LocalPath[];
    onFileSelected?: (entryPath: LocalPath) => void;
    onDirectorySelected?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
    autoFocus?: boolean;
  };
}

export default class IndexedFileTree extends Component<Signature> {
  <template>
    <nav
      aria-label='File tree'
      tabindex='0'
      data-test-file-tree-nav
      {{on 'keydown' this.handleTypeAhead}}
      {{AutoFocusModifier @autoFocus}}
    >
      <TreeLevel
        @entries={{this.fileTree.entries}}
        @fileTree={{this.fileTree}}
        @selectedFile={{if @selectedFile @selectedFile this.selectedFile}}
        @openDirs={{this.effectiveOpenDirs}}
        @onFileSelected={{this.selectFile}}
        @onDirectorySelected={{this.toggleDirectory}}
        @scrollPositionKey={{@scrollPositionKey}}
        @relativePath=''
        @typeAheadMatch={{this.typeAheadMatch}}
      />
      {{#if this.showMask}}
        <div class='mask' data-test-file-tree-mask>
          {{#if this.fileTree.isLoading}}
            <LoadingIndicator />
          {{/if}}
        </div>
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
        display: flex;
        align-items: center;
        justify-content: center;
      }
      nav {
        position: relative;
        min-height: 100%;
      }
      nav:focus-visible {
        outline: 2px solid var(--boxel-highlight);
        outline-offset: -2px;
        border-radius: var(--boxel-border-radius-xs);
      }
    </style>
  </template>

  private fileTree = fileTreeFromIndex(
    this,
    () => this.args.realmURL,
    () => this.args.fileTypeFilter,
  );
  private localOpenDirs = new TrackedSet<string>();
  @tracked private selectedFile?: LocalPath;
  @tracked private maskDismissed = false;
  @tracked private typeAheadMatch?: string;
  private typeAheadBuffer = '';
  private typeAheadTimer?: ReturnType<typeof setTimeout>;

  constructor(owner: Owner, args: Signature['Args']) {
    super(owner, args);
    this.hideMask.perform();
    registerDestructor(this, () => {
      clearTimeout(this.typeAheadTimer);
    });
  }

  private get showMask(): boolean {
    if (this.fileTree.isLoading) {
      return true;
    }
    return !this.maskDismissed;
  }

  private hideMask = restartableTask(async () => {
    // fine tuned to coincide with debounce in RestoreScrollPosition modifier
    await timeout(300);
    this.maskDismissed = true;
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

  @action
  private handleTypeAhead(event: KeyboardEvent) {
    const key = event.key;

    // Only handle single printable characters; ignore modifier combos
    if (key.length !== 1 || event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }

    // If focus is on a child button, let Space activate that button normally
    if (key === ' ' && event.target !== event.currentTarget) {
      return;
    }

    // Prevent default so Space doesn't scroll the page
    event.preventDefault();

    this.typeAheadBuffer += key.toLowerCase();

    // Reset buffer after 600 ms of inactivity
    clearTimeout(this.typeAheadTimer);
    this.typeAheadTimer = setTimeout(() => {
      this.typeAheadBuffer = '';
      this.typeAheadMatch = undefined;
    }, 600);

    // Search all visible (rendered) file and directory buttons
    const nav = event.currentTarget as HTMLElement;
    const buttons = Array.from(
      nav.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
    );
    const match = buttons.find((btn) =>
      btn.getAttribute('title')?.toLowerCase().startsWith(this.typeAheadBuffer),
    );

    if (match) {
      const path =
        match.dataset['testFile'] ?? match.dataset['testDirectory'];
      this.typeAheadMatch = path;
      match.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      this.typeAheadMatch = undefined;
    }
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
    typeAheadMatch?: string;
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
            class='file
              {{if (this.isSelectedFile entry.path) "selected"}}
              {{if (this.isTypeAheadMatch entry.path) "type-ahead-match"}}'
          >
            {{entry.name}}
          </button>
        {{else}}
          <button
            data-test-directory={{entry.path}}
            title={{entry.name}}
            {{on 'click' (fn @onDirectorySelected entry.path)}}
            class='directory
              {{if (this.isTypeAheadMatch entry.path) "type-ahead-match"}}'
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
              @typeAheadMatch={{@typeAheadMatch}}
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

      .file.type-ahead-match,
      .directory.type-ahead-match {
        background-color: var(--boxel-200);
        outline: 2px solid var(--boxel-highlight);
        outline-offset: -2px;
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
  isTypeAheadMatch(path: string): boolean {
    if (!this.args.typeAheadMatch) {
      return false;
    }
    return (
      this.args.typeAheadMatch === path ||
      this.args.typeAheadMatch === normalizeDirPath(path)
    );
  }

  @action
  getChildren(entry: FileTreeNode): FileTreeNode[] {
    if (!entry.children) {
      return [];
    }
    return Array.from(entry.children.values());
  }
}
