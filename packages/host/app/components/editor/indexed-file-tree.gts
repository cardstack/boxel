import { registerDestructor } from '@ember/destroyable';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import type Owner from '@ember/owner';
import Component from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';

import onClickOutside from 'ember-click-outside/modifiers/on-click-outside';
import { restartableTask, timeout } from 'ember-concurrency';
import Modifier from 'ember-modifier';
import { velcro } from 'ember-velcro';
import { TrackedSet } from 'tracked-built-ins';

import {
  ContextButton,
  LoadingIndicator,
  Menu,
} from '@cardstack/boxel-ui/components';
import { eq, MenuItem } from '@cardstack/boxel-ui/helpers';
import {
  DropdownArrowDown,
  IconTrash,
  WarningTriangleFilled,
} from '@cardstack/boxel-ui/icons';

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

// Scroll `path`'s row into view within the nearest overflow:auto ancestor (the
// file list container), rather than scrolling the whole viewport. Module-level
// so both keyboard navigation and reveal-on-create share it.
function scrollPathIntoView(path: string, nav: HTMLElement) {
  const el = Array.from(nav.querySelectorAll<HTMLElement>('[data-path]')).find(
    (candidate) => candidate.dataset.path === path,
  );
  if (!el) return;

  const scrollContainer = nav.parentElement;
  if (!scrollContainer) {
    el.scrollIntoView({ block: 'nearest' });
    return;
  }

  const containerRect = scrollContainer.getBoundingClientRect();
  const elRect = el.getBoundingClientRect();

  if (elRect.top < containerRect.top) {
    scrollContainer.scrollTop -= containerRect.top - elRect.top;
  } else if (elRect.bottom > containerRect.bottom) {
    scrollContainer.scrollTop += elRect.bottom - containerRect.bottom;
  }
}

interface Signature {
  Args: {
    realmURL: string;
    fileTypeFilter?: CodeRef;
    fileFieldFilter?: Record<string, unknown>;
    selectedFile?: LocalPath;
    openDirs?: LocalPath[];
    onFileSelected?: (entryPath: LocalPath) => void;
    onFileConfirmed?: (entryPath: LocalPath) => void;
    onDirectorySelected?: (entryPath: LocalPath) => void;
    onDeleteFile?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
    autoFocus?: boolean;
    // Surface files that failed to index (code submode). Off by default.
    includeErrors?: boolean;
    // Discover empty directories the index can't see (code submode). Off by
    // default (the file chooser skips the realm-wide crawl).
    discoverEmptyDirs?: boolean;
    // Scroll this file into view (without selecting it) — reveal-on-create.
    revealFile?: LocalPath;
  };
}

export default class IndexedFileTree extends Component<Signature> {
  <template>
    <nav
      class='indexed-file-tree-nav'
      aria-label='File tree'
      tabindex='0'
      data-file-tree-nav
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
        @onDeleteFile={{@onDeleteFile}}
        @scrollPositionKey={{@scrollPositionKey}}
        @revealFile={{@revealFile}}
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
      nav:focus {
        outline: none;
      }
    </style>
  </template>

  private fileTree = fileTreeFromIndex(
    this,
    () => this.args.realmURL,
    () => this.args.fileTypeFilter,
    () => this.args.fileFieldFilter,
    () => this.args.includeErrors,
    () => this.args.discoverEmptyDirs,
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
  private handleKeydown(event: Event) {
    let kbEvent = event as KeyboardEvent;
    const key = kbEvent.key;
    const nav = kbEvent.currentTarget as HTMLElement;

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
        const nextItem = items[nextIndex]!;
        if (nextItem.kind === 'file') {
          this.selectFile(nextItem.path as LocalPath);
        } else {
          this.cursorPath = nextItem.path;
        }
        scrollPathIntoView(nextItem.path, nav);
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
        const prevItem = items[prevIndex]!;
        if (prevItem.kind === 'file') {
          this.selectFile(prevItem.path as LocalPath);
        } else {
          this.cursorPath = prevItem.path;
        }
        scrollPathIntoView(prevItem.path, nav);
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
            scrollPathIntoView(this.cursorPath, nav);
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
          scrollPathIntoView(parent, nav);
        }
        break;
      }

      case 'Enter': {
        event.preventDefault();
        event.stopPropagation();
        if (!this.cursorPath) break;
        const current = this.visibleItems.find(
          (i) => i.path === this.cursorPath,
        );
        if (current?.kind === 'file') {
          this.selectFile(current.path as LocalPath);
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
          kbEvent.ctrlKey ||
          kbEvent.metaKey ||
          kbEvent.altKey
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
          const path = match.dataset.path;
          if (path) {
            if (match.dataset.kind === 'file') {
              // File: update selection (selectFile also sets cursorPath)
              this.selectFile(path as LocalPath);
            } else {
              // Directory: just move cursor, don't expand
              this.cursorPath = path;
            }
            scrollPathIntoView(path, nav);
          }
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
    onDeleteFile?: (entryPath: LocalPath) => void;
    scrollPositionKey?: LocalPath;
    revealFile?: LocalPath;
    relativePath: string;
    cursorPath?: string;
  };
}

class TreeLevel extends Component<TreeLevelSignature> {
  <template>
    {{#each @entries as |entry|}}
      <div class='level' data-test-directory-level>
        {{#if (eq entry.kind 'file')}}
          <div
            class='file-row
              {{if (this.isSelectedFile entry.path) "selected"}}
              {{if (this.isCursorItem entry.path) "cursor"}}'
            data-test-file-row={{entry.path}}
            {{on 'contextmenu' (fn this.onFileRowContextMenu entry.path)}}
          >
            <button
              data-test-file={{entry.path}}
              data-path={{entry.path}}
              data-kind='file'
              title={{entry.name}}
              tabindex='-1'
              {{on 'click' (fn @onFileSelected entry.path)}}
              {{scrollIntoViewModifier
                (this.isSelectedFile entry.path)
                container='file-tree'
                key=@scrollPositionKey
              }}
              {{scrollIntoViewModifier
                (this.isRevealTarget entry.path)
                container='file-tree-reveal'
                key=@revealFile
              }}
              class='file
                {{if (this.isSelectedFile entry.path) "selected"}}
                {{if (this.isCursorItem entry.path) "cursor"}}
                {{if entry.hasError "has-error"}}'
            >
              {{#if entry.hasError}}
                <WarningTriangleFilled
                  class='error-icon'
                  data-test-file-error={{entry.path}}
                />
              {{/if}}{{entry.name}}
            </button>
            {{#if @onDeleteFile}}
              <ContextButton
                class='file-menu-trigger'
                @icon='context-menu'
                @size='extra-small'
                @label='File options'
                @variant='ghost'
                {{on 'click' (fn this.openFileMenu entry.path)}}
              />
            {{/if}}
          </div>
        {{else}}
          <button
            data-test-directory={{entry.path}}
            data-path={{entry.path}}
            data-kind='directory'
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
              @onDeleteFile={{@onDeleteFile}}
              @scrollPositionKey={{@scrollPositionKey}}
              @revealFile={{@revealFile}}
              @relativePath={{entry.path}}
              @cursorPath={{@cursorPath}}
            />
          {{/if}}
        {{/if}}
      </div>
    {{/each}}
    {{#if this.menuTriggerEl}}
      <div
        class='file-tree-context-menu'
        {{velcro this.menuTriggerEl placement='bottom-start' strategy='fixed'}}
        {{onClickOutside this.closeMenu exceptSelector='.file-menu-trigger'}}
      >
        <Menu
          class='file-tree-context-menu-list'
          @items={{this.menuItems}}
          @closeMenu={{this.closeMenu}}
        />
      </div>
    {{/if}}

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
        transition:
          background-color var(--boxel-transition),
          box-shadow var(--boxel-transition);
      }

      .file-row:hover:not(.cursor):not(.selected),
      .file-row:focus-within:not(.cursor):not(.selected) {
        background-color: var(--boxel-200);
      }

      /* Selected file: green inverse state */
      .file-row.selected {
        color: var(--boxel-dark);
        background-color: var(--boxel-highlight);
      }

      /* Keyboard cursor on files: same green inverse state */
      .file-row.cursor {
        color: var(--boxel-dark);
        background-color: var(--boxel-highlight);
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
        cursor: default;
        transition:
          background-color var(--boxel-transition),
          outline-color var(--boxel-transition),
          box-shadow var(--boxel-transition);
        padding-left: 0;
      }

      .directory:hover:not(.cursor) {
        background-color: var(--boxel-200);
      }

      /* Keyboard cursor on directories: lighter active state */
      .directory.cursor {
        color: var(--boxel-dark);
        background-color: color-mix(
          in srgb,
          var(--boxel-highlight) 24%,
          var(--boxel-light)
        );
        box-shadow: inset 0 0 0 1px var(--boxel-highlight);
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
        cursor: default;
        border-radius: var(--boxel-border-radius-xs);
      }

      .file .error-icon {
        --icon-color: var(--boxel-error-100, #ff4136);
        width: var(--icon-length);
        height: var(--icon-length);
        margin-right: var(--icon-margin);
        margin-bottom: -2px;
        vertical-align: baseline;
      }

      /* Broken-file affordance: red name when not selected/cursored. */
      .file-row:not(.selected):not(.cursor) .file.has-error {
        color: var(--boxel-error-100, #ff4136);
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

      .file-tree-context-menu {
        z-index: var(--boxel-layer-floating-button);
      }
    </style>
  </template>

  @tracked private menuTriggerEl?: HTMLElement;
  private menuEntryPath?: LocalPath;

  constructor(owner: Owner, args: TreeLevelSignature['Args']) {
    super(owner, args);
    registerDestructor(this, () => {
      this.menuEntryPath = undefined;
      this.menuTriggerEl = undefined;
    });
  }

  private get menuItems() {
    if (!this.menuEntryPath) {
      return [];
    }
    return [
      new MenuItem({
        label: 'Delete',
        action: () => this.args.onDeleteFile?.(this.menuEntryPath!),
        icon: IconTrash,
        dangerous: true,
      }),
    ];
  }

  @action
  private closeMenu() {
    this.menuEntryPath = undefined;
    this.menuTriggerEl = undefined;
  }

  @action
  private openFileMenu(entryPath: LocalPath, e: MouseEvent) {
    if (!this.args.onDeleteFile) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (this.menuTriggerEl === e.currentTarget) {
      this.closeMenu();
      return;
    }
    this.menuEntryPath = entryPath;
    this.menuTriggerEl = e.currentTarget as HTMLElement;
  }

  @action
  private onFileRowContextMenu(entryPath: LocalPath, e: MouseEvent) {
    if (!this.args.onDeleteFile) {
      return;
    }
    this.openFileMenu(entryPath, e);
  }

  @action
  isSelectedFile(path: string): boolean {
    return this.args.selectedFile === path;
  }

  // Reveal-on-create: scroll this file into view (without selecting it) when it
  // is the reveal target. Render-driven via `scrollIntoViewModifier`, so it
  // fires the moment the just-created row renders — including after the index
  // event re-runs the search.
  @action
  isRevealTarget(path: string): boolean {
    return this.args.revealFile != null && this.args.revealFile === path;
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
