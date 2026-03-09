import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

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
    onFileConfirmed?: (entryPath: LocalPath) => void;
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
      {{on 'keydown' this.handleKeydown}}
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
        @cursorPath={{this.cursorPath}}
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
  @tracked private cursorPath?: string;
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

  @cached
  private get visibleItems(): FileTreeNode[] {
    return this.flattenVisible(this.fileTree.entries, this.effectiveOpenDirs);
  }

  private flattenVisible(
    entries: FileTreeNode[],
    openDirs: Set<string>,
  ): FileTreeNode[] {
    const result: FileTreeNode[] = [];
    for (const entry of entries) {
      result.push(entry);
      if (
        entry.kind === 'directory' &&
        entry.children &&
        openDirs.has(normalizeDirPath(entry.path))
      ) {
        result.push(
          ...this.flattenVisible(Array.from(entry.children.values()), openDirs),
        );
      }
    }
    return result;
  }

  private getParentPath(path: string): string | undefined {
    const p = path.endsWith('/') ? path.slice(0, -1) : path;
    const lastSlash = p.lastIndexOf('/');
    if (lastSlash === -1) return undefined;
    return p.substring(0, lastSlash) + '/';
  }

  private scrollPathIntoView(path: string, nav: HTMLElement) {
    const escaped = CSS.escape(path);
    const el = nav.querySelector<HTMLElement>(
      `[data-test-file="${escaped}"], [data-test-directory="${escaped}"]`,
    );
    el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  @action
  private selectFile(entryPath: LocalPath) {
    this.selectedFile = entryPath;
    this.cursorPath = entryPath;
    this.args.onFileSelected?.(entryPath);
  }

  @action
  private toggleDirectory(entryPath: LocalPath) {
    let dirPath = normalizeDirPath(entryPath);
    this.cursorPath = dirPath;

    if (this.localOpenDirs.has(dirPath)) {
      this.localOpenDirs.delete(dirPath);
    } else {
      this.localOpenDirs.add(dirPath);
    }

    this.args.onDirectorySelected?.(dirPath);
  }

  @action
  private handleKeydown(event: KeyboardEvent) {
    const key = event.key;
    const nav = event.currentTarget as HTMLElement;

    switch (key) {
      case 'ArrowDown': {
        event.preventDefault();
        const items = this.visibleItems;
        if (!items.length) break;
        const currentIndex = this.cursorPath
          ? items.findIndex((i) => i.path === this.cursorPath)
          : -1;
        const nextIndex =
          currentIndex === -1
            ? 0
            : Math.min(currentIndex + 1, items.length - 1);
        this.cursorPath = items[nextIndex]!.path;
        this.scrollPathIntoView(this.cursorPath, nav);
        break;
      }

      case 'ArrowUp': {
        event.preventDefault();
        const items = this.visibleItems;
        if (!items.length) break;
        const currentIndex = this.cursorPath
          ? items.findIndex((i) => i.path === this.cursorPath)
          : -1;
        const prevIndex =
          currentIndex === -1
            ? items.length - 1
            : Math.max(currentIndex - 1, 0);
        this.cursorPath = items[prevIndex]!.path;
        this.scrollPathIntoView(this.cursorPath, nav);
        break;
      }

      case 'ArrowRight': {
        event.preventDefault();
        if (!this.cursorPath) break;
        const current = this.visibleItems.find(
          (i) => i.path === this.cursorPath,
        );
        if (current?.kind === 'directory') {
          const dirPath = normalizeDirPath(current.path);
          if (!this.effectiveOpenDirs.has(dirPath)) {
            this.toggleDirectory(current.path as LocalPath);
          }
          // Move cursor into first child (works whether just opened or already open)
          const items = this.visibleItems;
          const idx = items.findIndex((i) => i.path === this.cursorPath);
          if (idx !== -1 && idx < items.length - 1) {
            this.cursorPath = items[idx + 1]!.path;
            this.scrollPathIntoView(this.cursorPath, nav);
          }
        }
        break;
      }

      case 'ArrowLeft': {
        event.preventDefault();
        if (!this.cursorPath) break;
        const current = this.visibleItems.find(
          (i) => i.path === this.cursorPath,
        );
        if (current?.kind === 'directory') {
          const dirPath = normalizeDirPath(current.path);
          if (this.effectiveOpenDirs.has(dirPath)) {
            // Collapse this directory
            this.toggleDirectory(current.path as LocalPath);
            break;
          }
        }
        // Move cursor to parent directory
        const parent = this.getParentPath(this.cursorPath);
        if (parent) {
          this.cursorPath = parent;
          this.scrollPathIntoView(parent, nav);
        }
        break;
      }

      case 'Enter': {
        event.preventDefault();
        if (!this.cursorPath) break;
        const current = this.visibleItems.find(
          (i) => i.path === this.cursorPath,
        );
        if (current?.kind === 'file') {
          this.args.onFileConfirmed?.(current.path as LocalPath);
        } else if (current?.kind === 'directory') {
          this.toggleDirectory(current.path as LocalPath);
        }
        break;
      }

      default: {
        // Type-ahead: single printable characters, no modifier combos
        if (
          key.length !== 1 ||
          event.ctrlKey ||
          event.metaKey ||
          event.altKey
        ) {
          break;
        }
        // If focus is on a child button, let Space activate the button
        if (key === ' ' && event.target !== event.currentTarget) {
          break;
        }
        event.preventDefault();

        this.typeAheadBuffer += key.toLowerCase();

        clearTimeout(this.typeAheadTimer);
        this.typeAheadTimer = setTimeout(() => {
          this.typeAheadBuffer = '';
          // Cursor stays where it is — don't clear cursorPath
        }, 600);

        const buttons = Array.from(
          nav.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
        );
        const match = buttons.find((btn) =>
          btn
            .getAttribute('title')
            ?.toLowerCase()
            .startsWith(this.typeAheadBuffer),
        );
        if (match) {
          const path =
            match.dataset['testFile'] ?? match.dataset['testDirectory'];
          this.cursorPath = path;
          match.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        }
        break;
      }
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
    cursorPath?: string;
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
            tabindex='-1'
            {{on 'click' (fn @onFileSelected entry.path)}}
            {{scrollIntoViewModifier
              (this.isSelectedFile entry.path)
              container='file-tree'
              key=@scrollPositionKey
            }}
            class='file
              {{if (this.isSelectedFile entry.path) "selected"}}
              {{if (this.isCursorItem entry.path) "cursor"}}'
          >
            {{entry.name}}
          </button>
        {{else}}
          <button
            data-test-directory={{entry.path}}
            title={{entry.name}}
            tabindex='-1'
            {{on 'click' (fn @onDirectorySelected entry.path)}}
            class='directory {{if (this.isCursorItem entry.path) "cursor"}}'
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
              @cursorPath={{@cursorPath}}
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
        cursor: default;
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

      .file.cursor,
      .directory.cursor {
        background-color: var(--boxel-200);
        outline: 2px solid var(--boxel-highlight);
        outline-offset: -2px;
      }

      .file.selected.cursor {
        outline: 2px solid color-mix(in srgb, var(--boxel-highlight) 60%, black);
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
  isCursorItem(path: string): boolean {
    if (!this.args.cursorPath) {
      return false;
    }
    return (
      this.args.cursorPath === path ||
      this.args.cursorPath === normalizeDirPath(path)
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
