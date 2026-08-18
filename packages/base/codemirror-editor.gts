import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { isDestroying, isDestroyed } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { scheduleOnce } from '@ember/runloop';
import { htmlSafe } from '@ember/template';
import { Tooltip } from '@cardstack/boxel-ui/components';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  baseRRI,
  resolveRRIReference,
  rri,
  CardContextName,
  trimJsonExtension,
} from '@cardstack/runtime-common';
import {
  type BfmRefFormat,
  type BfmRefRange,
} from '@cardstack/runtime-common/bfm-card-references';
import { consume } from 'ember-provide-consume-context';
import {
  type BaseDef,
  type CardDef,
  type CardContext,
  type FileDef,
  getComponent,
} from './card-api';
import { CardContextConsumer } from './field-component';

import BoldIcon from '@cardstack/boxel-icons/bold';
import ItalicIcon from '@cardstack/boxel-icons/italic';
import StrikethroughIcon from '@cardstack/boxel-icons/strikethrough';
import CodeIcon from '@cardstack/boxel-icons/code';
import Heading1Icon from '@cardstack/boxel-icons/heading-1';
import Heading2Icon from '@cardstack/boxel-icons/heading-2';
import Heading3Icon from '@cardstack/boxel-icons/heading-3';
import ListIcon from '@cardstack/boxel-icons/list';
import ListOrderedIcon from '@cardstack/boxel-icons/list-ordered';
import BlockquoteIcon from '@cardstack/boxel-icons/blockquote';
import LinkIcon from '@cardstack/boxel-icons/link';
import PlusIcon from '@cardstack/boxel-icons/plus';
import PencilIcon from '@cardstack/boxel-icons/pencil';

// The CodeMirrorContext type is defined in the host app's lazy-loaded module.
// We only use it as a type here — the actual module is loaded at runtime via
// globalThis.__loadCodeMirror.
interface CardWidgetTarget {
  element: HTMLElement;
  cardId: string;
  format: BfmRefFormat;
  kind: 'inline' | 'block';
  // 'card' refs resolve to CardDef instances; 'file' refs to FileDef instances.
  refType: 'card' | 'file';
  // Inline sizing derived from the directive's format — fitted dimensions plus
  // `overflow: hidden`, or the shared non-atom footprint from
  // `bfmResolvedEmbedStyle`. Undefined for atom and block embedded.
  style?: string;
}

interface CardRenderTarget extends CardWidgetTarget {
  instance: CardDef | FileDef | null;
}

interface SelectionFormats {
  bold: boolean;
  italic: boolean;
  code: boolean;
  strikethrough: boolean;
  link: boolean;
}

interface SelectionInfo {
  hasSelection: boolean;
  hasFocus: boolean;
  from: number;
  to: number;
  formats: SelectionFormats;
  // BFM directive the cursor is currently inside, if any. Drives the toolbar
  // swap between the Add-embed popover and the Edit-embed pencil.
  currentRef?: BfmRefRange;
}

interface CodeMirrorContext {
  EditorState: any;
  EditorView: any;
  createEditorState: (options: {
    content: string;
    onDocChange: (text: string) => void;
    onCardTargetsChange: (targets: CardWidgetTarget[]) => void;
    onOpenEmbedChooser: () => void;
    onSelectionChange?: (info: SelectionInfo) => void;
    livePreview?: boolean;
  }) => any;
  undo: any;
  redo: any;
  wrapWith: (marker: string) => (view: any) => boolean;
  toggleLink: (view: any) => boolean;
}

const SAVE_DEBOUNCE_MS = 500;

// The symbol CodeMirror's `Mod-` binding resolves to per platform: ⌘ on macOS,
// Ctrl elsewhere. Kept local to this file — the toolbar tooltips are its only
// consumer.
const modKey =
  typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

function isInline(kind: string): boolean {
  return kind === 'inline';
}

function resolveUrl(raw: string, baseUrl: string | null | undefined): string {
  // Resolve in RRI space (no VirtualNetwork), matching the MarkDownTemplate
  // display path. Instance ids are canonical (prefix form for mapped realms,
  // URL for unmapped), so a prefix-form base resolves relative refs to RRI and
  // a URL-form base to URL. Either form matches the indexed card because the
  // search tolerates a reference's equivalent spellings (RRI / real-URL /
  // virtual-alias) rather than requiring one canonical form.
  try {
    return trimJsonExtension(
      resolveRRIReference(raw, baseUrl ? rri(baseUrl) : undefined),
    );
  } catch {
    return trimJsonExtension(raw);
  }
}

// `getCards` is typed to return CardDef instances (its generic is constrained to
// `T extends CardDef`, and FileDef extends BaseDef — not CardDef). A query routed
// through `on: FileDef` actually yields FileDef instances, so we reinterpret the
// resource. Localizing the cast to one named helper keeps the unsafety
// documented and out of the call site.
function asFileResource(
  resource: { instances: CardDef[]; isLoading: boolean } | undefined,
): { instances: FileDef[]; isLoading: boolean } | undefined {
  return resource as unknown as
    | { instances: FileDef[]; isLoading: boolean }
    | undefined;
}

interface CodeMirrorEditorSignature {
  Args: {
    content: string | null | undefined;
    onUpdate: (markdown: string) => void;
    linkedCards?: CardDef[] | null;
    linkedFiles?: FileDef[] | null;
    cardReferenceBaseUrl?: string | null;
    /** When false, all syntax markers are visible (source mode). Default true. */
    livePreview?: boolean;
    getCards?: (
      parent: object,
      getQuery: () => Record<string, unknown> | undefined,
    ) => { instances: CardDef[]; isLoading: boolean } | undefined;
  };
  Blocks: {
    /** Controls rendered at the start of the docked toolbar (e.g. the view selector). */
    leadingControls: [];
  };
  Element: HTMLDivElement;
}

interface ToolbarItem {
  divider?: boolean;
  testId?: string;
  label?: string;
  icon?: unknown;
  action?: () => void;
  active?: boolean;
  ariaPressed?: 'true' | 'false';
  // Key-command hint shown as a badge in the tooltip. Set only for items with a
  // binding in the CodeMirror keymap (bold/italic/code); absent items render a
  // label-only tooltip.
  shortcut?: string;
  // Inline-format toggles (bold/italic/etc.) wrap the current selection, so they
  // only make sense when text is highlighted. Set for those buttons so they
  // disable when the selection is collapsed — unless the toggle is active
  // (e.g. the caret sits inside a link), since untoggling works at a bare
  // caret. Line-based buttons omit it.
  requiresSelection?: boolean;
  // Computed enablement for this button, folding in focus and (for
  // selection-requiring buttons) whether text is highlighted.
  disabled?: boolean;
}

const EMPTY_FORMATS: SelectionFormats = Object.freeze({
  bold: false,
  italic: false,
  code: false,
  strikethrough: false,
  link: false,
});

function sameToolbarState(a: SelectionInfo, b: SelectionInfo): boolean {
  return (
    a.hasFocus === b.hasFocus &&
    // Selection presence gates the inline-format buttons' enablement, so a
    // collapse/expand must refresh the toolbar even when nothing else changed.
    a.hasSelection === b.hasSelection &&
    a.formats.bold === b.formats.bold &&
    a.formats.italic === b.formats.italic &&
    a.formats.code === b.formats.code &&
    a.formats.strikethrough === b.formats.strikethrough &&
    a.formats.link === b.formats.link &&
    a.currentRef?.from === b.currentRef?.from &&
    a.currentRef?.to === b.currentRef?.to &&
    // Compare the directive's contents too — an in-place edit (URL/spec/kind
    // change) can leave from/to unchanged but must still refresh the toolbar so
    // the pencil edits the current ref, not a stale one.
    a.currentRef?.url === b.currentRef?.url &&
    a.currentRef?.sizeSpec === b.currentRef?.sizeSpec &&
    a.currentRef?.kind === b.currentRef?.kind
  );
}

export default class CodeMirrorEditor extends GlimmerComponent<CodeMirrorEditorSignature> {
  // Host bridge for the embed chooser, provided down the operator-mode tree via
  // CardContext. Absent when the editor renders with no chooser modal mounted
  // (e.g. prerender); the toolbar handlers guard on it.
  @consume(CardContextName) declare cardContext: CardContext | undefined;

  @tracked _cm: CodeMirrorContext | null = null;
  @tracked _widgetTargets: CardWidgetTarget[] = [];
  @tracked _isLoaded = false;

  // ── Docked toolbar state ────────────────────────────────────────────────
  @tracked _selectionInfo: SelectionInfo | null = null;

  private editorView: any = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingTargets: CardWidgetTarget[] = [];
  private _slotUpdatePending = false;
  private _currentLivePreview: boolean | undefined;

  get livePreview(): boolean {
    return this.args.livePreview !== false;
  }

  // ── Lazy loading ─────────────────────────────────────────────────────────

  get cm(): CodeMirrorContext | null {
    if (!this._cm && !this._isLoaded) {
      this._loadCodeMirror();
    }
    return this._cm;
  }

  private async _loadCodeMirror() {
    let loadCodeMirror = (globalThis as any).__loadCodeMirror;
    if (typeof loadCodeMirror !== 'function') {
      this._isLoaded = true;
      return;
    }
    this._cm = await loadCodeMirror();
    this._isLoaded = true;
  }

  // ── Slash-command embed chooser ──────────────────────────────────────────

  // Typing `/card` reuses the same embed chooser modal as the toolbar's
  // Add-embed button. The slash completion's `apply` already deleted the typed
  // `/`, so the caret sits where the directive should land — `_openEmbedChooser`
  // inserts at the current selection.
  private _handleOpenEmbedChooser = () => {
    if (isDestroying(this) || isDestroyed(this)) return;
    this._openEmbedChooser('card');
  };

  // ── Docked toolbar ──────────────────────────────────────────────────────

  private _handleSelectionChange = (info: SelectionInfo) => {
    if (isDestroying(this) || isDestroyed(this)) return;
    // The toolbar is always mounted and only reads hasFocus + the format
    // booleans, so skip the tracked write (and its re-render) when neither
    // changed — every cursor move otherwise dirties all the buttons.
    let prev = this._selectionInfo;
    if (prev && sameToolbarState(prev, info)) return;
    this._selectionInfo = info;
  };

  /**
   * Formatting controls are enabled only while the editor holds focus. The
   * view selector (rendered into the leadingControls block) is always enabled.
   */
  get toolbarEnabled(): boolean {
    return !!this._selectionInfo?.hasFocus;
  }

  get toolbarFormats(): SelectionFormats {
    return this._selectionInfo?.formats ?? EMPTY_FORMATS;
  }

  /**
   * Toolbar contents in display order. `divider: true` entries render a
   * separator; the rest render a formatting button. `ariaPressed` is set only
   * for the inline-format toggles (bold/italic/etc.), left undefined for the
   * insert-only buttons (headings/lists) so the attribute is omitted.
   */
  get toolbarButtons(): ToolbarItem[] {
    let f = this.toolbarFormats;
    let pressed = (active: boolean) => (active ? 'true' : 'false');
    let enabled = this.toolbarEnabled;
    let hasSelection = this._selectionInfo?.hasSelection ?? false;
    // Inline-format toggles additionally require a highlighted selection,
    // except when already active — an active toggle can always be untoggled
    // (unlink works from a bare caret inside the link). Line-based buttons
    // only require focus.
    let disabledFor = (item: ToolbarItem) =>
      !enabled || (!!item.requiresSelection && !hasSelection && !item.active);
    let items: ToolbarItem[] = [
      {
        testId: 'bold',
        label: 'Bold',
        icon: BoldIcon,
        action: this._wrapBold,
        active: f.bold,
        ariaPressed: pressed(f.bold),
        shortcut: `${modKey}B`,
        requiresSelection: true,
      },
      {
        testId: 'italic',
        label: 'Italic',
        icon: ItalicIcon,
        action: this._wrapItalic,
        active: f.italic,
        ariaPressed: pressed(f.italic),
        shortcut: `${modKey}I`,
        requiresSelection: true,
      },
      {
        testId: 'strikethrough',
        label: 'Strikethrough',
        icon: StrikethroughIcon,
        action: this._wrapStrikethrough,
        active: f.strikethrough,
        ariaPressed: pressed(f.strikethrough),
        requiresSelection: true,
      },
      {
        testId: 'code',
        label: 'Code',
        icon: CodeIcon,
        action: this._wrapCode,
        active: f.code,
        ariaPressed: pressed(f.code),
        shortcut: `${modKey}\``,
        requiresSelection: true,
      },
      {
        testId: 'link',
        label: 'Link',
        icon: LinkIcon,
        action: this._toggleLink,
        active: f.link,
        ariaPressed: pressed(f.link),
        requiresSelection: true,
      },
      { divider: true },
      {
        testId: 'h1',
        label: 'Heading 1',
        icon: Heading1Icon,
        action: this._insertH1,
      },
      {
        testId: 'h2',
        label: 'Heading 2',
        icon: Heading2Icon,
        action: this._insertH2,
      },
      {
        testId: 'h3',
        label: 'Heading 3',
        icon: Heading3Icon,
        action: this._insertH3,
      },
      { divider: true },
      {
        testId: 'bullet-list',
        label: 'Bullet List',
        icon: ListIcon,
        action: this._toggleBulletList,
      },
      {
        testId: 'numbered-list',
        label: 'Numbered List',
        icon: ListOrderedIcon,
        action: this._toggleNumberedList,
      },
      {
        testId: 'blockquote',
        label: 'Blockquote',
        icon: BlockquoteIcon,
        action: this._toggleBlockquote,
      },
    ];
    for (let item of items) {
      if (!item.divider) {
        item.disabled = disabledFor(item);
      }
    }
    return items;
  }

  /** Prevent mousedown on toolbar/popup buttons from stealing editor focus/selection */
  _preventFocusLoss = (e: Event) => e.preventDefault();

  /**
   * Clicking anywhere in the editor surface (padding, empty space below the
   * text) focuses the editor and drops the cursor at the end of the document —
   * so the whole area reads as editable, like a textarea. Clicks landing on the
   * CM content or an embedded card widget are left for CodeMirror to handle.
   */
  _focusEditorOnPointerDown = (event: Event) => {
    let view = this.editorView;
    if (!view) return;
    let target = event.target as HTMLElement | null;
    if (target?.closest('.cm-content') || target?.closest('.cm-card-widget')) {
      return;
    }
    event.preventDefault();
    view.focus();
    view.dispatch({ selection: { anchor: view.state.doc.length } });
  };

  _wrapBold = () => this._toolbarAction('**');
  _wrapItalic = () => this._toolbarAction('*');
  _wrapStrikethrough = () => this._toolbarAction('~~');
  _wrapCode = () => this._toolbarAction('`');

  _toolbarAction = (marker: string) => {
    let cm = this._cm;
    let view = this.editorView;
    if (!cm || !view) return;
    cm.wrapWith(marker)(view);
    view.focus();
  };

  _toggleLink = () => {
    let cm = this._cm;
    let view = this.editorView;
    if (!cm || !view) return;
    cm.toggleLink(view);
    view.focus();
  };

  _insertH1 = () => this._insertHeading(1);
  _insertH2 = () => this._insertHeading(2);
  _insertH3 = () => this._insertHeading(3);

  _insertHeading = (level: number) => {
    let view = this.editorView;
    if (!view) return;
    let { from } = view.state.selection.main;
    let line = view.state.doc.lineAt(from);
    let lineText = line.text;
    let prefix = '#'.repeat(level) + ' ';

    // If the line already starts with this heading level, remove it
    if (lineText.startsWith(prefix)) {
      view.dispatch({
        changes: { from: line.from, to: line.from + prefix.length, insert: '' },
      });
    } else {
      // Remove any existing heading prefix
      let existingMatch = lineText.match(/^#{1,6}\s/);
      let removeLen = existingMatch ? existingMatch[0].length : 0;
      view.dispatch({
        changes: {
          from: line.from,
          to: line.from + removeLen,
          insert: prefix,
        },
      });
    }
    view.focus();
  };

  _toggleBulletList = () => this._toggleLinePrefix('- ');
  _toggleNumberedList = () => this._toggleLinePrefix('1. ');
  _toggleBlockquote = () => this._toggleLinePrefix('> ');

  _toggleLinePrefix = (prefix: string) => {
    let view = this.editorView;
    if (!view) return;
    let { from, to } = view.state.selection.main;
    let startLine = view.state.doc.lineAt(from);
    let endLine = view.state.doc.lineAt(to);
    let changes: { from: number; to: number; insert: string }[] = [];

    // Check if all affected lines already have this prefix
    let allHavePrefix = true;
    for (let i = startLine.number; i <= endLine.number; i++) {
      let line = view.state.doc.line(i);
      if (!line.text.startsWith(prefix)) {
        allHavePrefix = false;
        break;
      }
    }

    for (let i = startLine.number; i <= endLine.number; i++) {
      let line = view.state.doc.line(i);
      if (allHavePrefix) {
        // Remove prefix from all lines
        changes.push({
          from: line.from,
          to: line.from + prefix.length,
          insert: '',
        });
      } else if (!line.text.startsWith(prefix)) {
        // Add prefix to lines that don't have it
        changes.push({ from: line.from, to: line.from, insert: prefix });
      }
    }

    if (changes.length) {
      view.dispatch({ changes });
    }
    view.focus();
  };

  // ── Markdown embed chooser (toolbar) ────────────────────────────────────

  @tracked _embedPopoverOpen = false;

  get _currentBfmRef(): BfmRefRange | undefined {
    return this._selectionInfo?.currentRef;
  }

  _toggleEmbedPopover = () => {
    this._embedPopoverOpen = !this._embedPopoverOpen;
  };

  _openEmbedChooser = async (defaultTab: 'card' | 'file') => {
    this._embedPopoverOpen = false;
    let chooser = this.cardContext?.markdownEmbedChooser;
    if (!chooser) {
      // No chooser provided (e.g. card running outside the host) — warn and
      // no-op so the toolbar click doesn't blow up the editor.
      console.warn('markdown-embed chooser unavailable');
      return;
    }
    let result;
    try {
      result = await chooser.chooseCardOrFile({
        defaultTab,
        documentBaseUrl: this.args.cardReferenceBaseUrl ?? undefined,
      });
    } catch (e) {
      console.warn('markdown-embed chooser failed', e);
      return;
    }
    if (!result || 'remove' in result) {
      // Cancelled, or { remove: true } returned by mistake (no current ref to
      // remove in Add mode) — either way, do nothing.
      return;
    }
    this._insertBfm(result.bfm);
  };

  _openEditEmbed = async () => {
    let ref = this._currentBfmRef;
    if (!ref) return;
    let view = this.editorView;
    if (!view) return;
    let chooser = this.cardContext?.markdownEmbedChooser;
    if (!chooser) {
      console.warn('markdown-embed chooser unavailable');
      return;
    }
    let result;
    try {
      result = await chooser.editEmbed({
        refType: ref.refType as 'card' | 'file',
        // Resolve the directive's raw ref (which may be relative to the field's
        // base URL) to an absolute URL. The chooser loads the preview via
        // `store.get`, which can't resolve a relative specifier on its own.
        url: resolveUrl(ref.url, this.args.cardReferenceBaseUrl),
        sizeSpec: ref.sizeSpec,
        kind: ref.kind,
        documentBaseUrl: this.args.cardReferenceBaseUrl ?? undefined,
      });
    } catch (e) {
      console.warn('markdown-embed chooser failed', e);
      return;
    }
    if (!result) return;
    if ('remove' in result) {
      if (result.remove) {
        this._deleteRange(ref);
      }
      return;
    }
    this._replaceRange(ref, result.bfm);
  };

  _insertBfm = (bfm: string) => {
    let view = this.editorView;
    if (!view) return;
    let { from } = view.state.selection.main;

    // Inline vs block placement is encoded in the directive's `::` prefix.
    if (bfm.startsWith('::')) {
      let line = view.state.doc.lineAt(from);
      let insertPos = line.to;
      let prefix = line.text.trim() === '' ? '' : '\n';
      view.dispatch({
        changes: { from: insertPos, insert: `${prefix}${bfm}\n` },
      });
    } else {
      view.dispatch({ changes: { from, insert: bfm } });
    }
    view.focus();

    let onUpdate = this.args.onUpdate;
    if (onUpdate) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      onUpdate(view.state.doc.toString());
    }
  };

  _replaceRange = (range: BfmRefRange, replacement: string) => {
    let view = this.editorView;
    if (!view) return;
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: replacement },
    });
    view.focus();
    let onUpdate = this.args.onUpdate;
    if (onUpdate) {
      // The dispatch above scheduled a debounced save via `onDocChange`; cancel
      // it so the immediate save below isn't duplicated.
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      onUpdate(view.state.doc.toString());
    }
  };

  _deleteRange = (range: BfmRefRange) => {
    let view = this.editorView;
    if (!view) return;
    // Block directives sit on their own line — extend the delete to swallow
    // the surrounding newline so we don't leave a blank line behind.
    let doc = view.state.doc;
    let from = range.from;
    let to = range.to;
    if (range.kind === 'block') {
      if (doc.sliceString(to, to + 1) === '\n') to += 1;
      else if (from > 0 && doc.sliceString(from - 1, from) === '\n') from -= 1;
    }
    view.dispatch({ changes: { from, to, insert: '' } });
    view.focus();
    let onUpdate = this.args.onUpdate;
    if (onUpdate) {
      // Cancel the debounced save the dispatch scheduled so we don't save twice.
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      onUpdate(view.state.doc.toString());
    }
  };

  // ── Reference resolution via getCards ─────────────────────────────────────
  // The linkedCards/linkedFiles linksToMany queries on RichMarkdownField return
  // empty in edit mode because nested FieldDef instances lack a card store. We
  // bypass that by using getCards (from CardContext) to resolve independently.
  // Cards and files need distinct queries: cards match by `id` (instance
  // entries), files match by `url` (file-meta search docs carry no `id`), and
  // the `on: FileDef` ref routes the search to file entries.

  private _cardRefResourceCreated = false;
  private _cardRefResource: {
    instances: CardDef[];
    isLoading: boolean;
  } | null = null;
  private _fileRefResourceCreated = false;
  private _fileRefResource: {
    instances: FileDef[];
    isLoading: boolean;
  } | null = null;

  private resolvedUrlsForRefType(refType: 'card' | 'file'): string[] {
    let baseUrl = this.args.cardReferenceBaseUrl;
    let urls = new Set<string>();
    for (let target of this._widgetTargets) {
      if (target.refType === refType) {
        urls.add(resolveUrl(target.cardId, baseUrl));
      }
    }
    return [...urls];
  }

  get resolvedCards(): CardDef[] {
    if (!this._cardRefResourceCreated) {
      this._cardRefResourceCreated = true;
      let getCards = this.args.getCards;
      if (typeof getCards === 'function') {
        this._cardRefResource =
          getCards(this, () => {
            let urls = this.resolvedUrlsForRefType('card');
            if (!urls.length) return undefined;
            return {
              filter: { in: { id: urls } },
            };
          }) ?? null;
      }
    }
    return this._cardRefResource?.instances ?? [];
  }

  get resolvedFiles(): FileDef[] {
    if (!this._fileRefResourceCreated) {
      this._fileRefResourceCreated = true;
      let getCards = this.args.getCards;
      if (typeof getCards === 'function') {
        this._fileRefResource =
          asFileResource(
            getCards(this, () => {
              let urls = this.resolvedUrlsForRefType('file');
              if (!urls.length) return undefined;
              return {
                filter: {
                  in: { url: urls },
                  on: { module: baseRRI('card-api'), name: 'FileDef' },
                },
              };
            }),
          ) ?? null;
      }
    }
    return this._fileRefResource?.instances ?? [];
  }

  // ── Card slot resolution ─────────────────────────────────────────────────

  @cached
  get cardRenderTargets(): CardRenderTarget[] {
    let targets = this._widgetTargets;
    let baseUrl = this.args.cardReferenceBaseUrl;

    // Resolve cards and files by URL from every available source. linkedCards /
    // linkedFiles work when a store is present; the getCards resources resolve
    // them independently (bypasses FallbackCardStore) — cards via an `id` query
    // over instance entries, files via a `url` query over file-meta entries.
    // Both CardDef and FileDef instances carry an `id` equal to their URL, so
    // one map keyed by URL serves both.
    let instancesByUrl = new Map<string, CardDef | FileDef>();
    let addInstances = (
      instances: (CardDef | FileDef)[] | null | undefined,
    ) => {
      if (!instances?.length) return;
      for (let instance of instances) {
        if (instance?.id) {
          instancesByUrl.set(trimJsonExtension(instance.id), instance);
        }
      }
    };
    addInstances(this.args.linkedCards);
    addInstances(this.args.linkedFiles);
    addInstances(this.resolvedCards);
    addInstances(this.resolvedFiles);

    return targets.map((target) => {
      let resolvedUrl = resolveUrl(target.cardId, baseUrl);
      return {
        ...target,
        instance: instancesByUrl.get(resolvedUrl) ?? null,
      };
    });
  }

  private _handleTargetChange = (targets: CardWidgetTarget[]) => {
    if (isDestroying(this) || isDestroyed(this)) return;
    this._pendingTargets = targets;
    if (!this._slotUpdatePending) {
      this._slotUpdatePending = true;
      scheduleOnce('afterRender', this, this._applyTargets);
    }
  };

  _applyTargets = () => {
    this._slotUpdatePending = false;
    let pending = this._pendingTargets;
    let current = this._widgetTargets;

    // Skip update if targets are structurally identical — avoids
    // unnecessary Glimmer re-renders that mutate CM6's DOM.
    if (
      current.length === pending.length &&
      current.every(
        (t, i) =>
          t.cardId === pending[i].cardId &&
          t.kind === pending[i].kind &&
          t.refType === pending[i].refType &&
          t.element === pending[i].element &&
          // A size-only edit changes format/style without touching url/kind/
          // refType/element — include them so the preview actually re-renders.
          t.format === pending[i].format &&
          t.style === pending[i].style,
      )
    ) {
      return;
    }

    this._widgetTargets = pending;
  };

  getCardComponent = (card: BaseDef) => getComponent(card);

  // ── Editor lifecycle ─────────────────────────────────────────────────────

  willDestroy() {
    super.willDestroy();
    // Flush any pending debounced save so content isn't lost on mode switch
    if (this.saveTimer && this.editorView) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
      this.args.onUpdate(this.editorView.state.doc.toString());
    } else if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    if (this.editorView) {
      this.editorView.destroy();
      this.editorView = null;
    }
    // Release references to DOM elements and large objects so test-suite
    // teardown can GC them rather than retaining across 100+ tests.
    this._widgetTargets = [];
    this._pendingTargets = [];
    this._selectionInfo = null;
    this._cardRefResource = null;
    this._cardRefResourceCreated = false;
    this._cm = null;
  }

  mountEditor = modifier((element: HTMLElement, _positional: unknown[]) => {
    let cm = this._cm;
    if (!cm) {
      return;
    }

    // Consume tracked args so auto-tracking is set up.
    // We read them here but the editor is only created once —
    // subsequent re-runs (from save echoes) hit the early return.
    let content = this.args.content;
    let onUpdate = this.args.onUpdate;
    let livePreview = this.livePreview;

    if (this.editorView && element.contains(this.editorView.dom)) {
      // Editor exists and is in the DOM. If the livePreview mode hasn't
      // changed, keep the editor (prevents focus loss on save echo).
      if (this._currentLivePreview === livePreview) {
        return;
      }
      // Mode changed — flush pending save and use current editor content
      if (this.saveTimer && onUpdate) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
        onUpdate(this.editorView.state.doc.toString());
      }
      content = this.editorView.state.doc.toString();
      this.editorView.destroy();
      this.editorView = null;
    } else if (this.editorView) {
      // Editor exists but not in this element — clean it up
      this.editorView.destroy();
      this.editorView = null;
    }

    this._currentLivePreview = livePreview;
    element.innerHTML = '';

    let state = cm.createEditorState({
      content: content || '',
      livePreview,
      onDocChange: (text: string) => {
        if (isDestroying(this) || isDestroyed(this)) return;
        if (onUpdate) {
          // Debounced save
          if (this.saveTimer) {
            clearTimeout(this.saveTimer);
          }
          this.saveTimer = setTimeout(() => {
            if (isDestroying(this) || isDestroyed(this)) return;
            this.saveTimer = null;
            onUpdate(text);
          }, SAVE_DEBOUNCE_MS);
        }
      },
      onCardTargetsChange: this._handleTargetChange,
      onOpenEmbedChooser: this._handleOpenEmbedChooser,
      onSelectionChange: this._handleSelectionChange,
    });

    let view = new cm.EditorView({
      state,
      parent: element,
    });

    this.editorView = view;

    // Cleanup only clears the debounce timer. Editor destruction is
    // handled by willDestroy — this prevents the Ember modifier
    // lifecycle from destroying the editor on re-runs triggered by
    // args.content changes (debounced save echoes).
    return () => {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
    };
  });

  <template>
    {{#if this.cm}}
      <div class='codemirror-editor' data-test-codemirror-editor ...attributes>
        {{! ── Docked toolbar ── }}
        {{! template-lint-disable no-pointer-down-event-binding }}
        <div class='codemirror-toolbar' data-test-markdown-toolbar>
          {{yield to='leadingControls'}}
          {{#if (has-block 'leadingControls')}}
            <span class='toolbar-divider'></span>
          {{/if}}

          {{#if this._currentBfmRef}}
            <Tooltip @placement='top' data-test-toolbar-tooltip='edit-embed'>
              <:trigger>
                <button
                  class='toolbar-btn'
                  data-test-toolbar='edit-embed'
                  type='button'
                  aria-label='Edit embed'
                  {{on 'mousedown' this._preventFocusLoss}}
                  {{on 'click' this._openEditEmbed}}
                ><PencilIcon width='16' height='16' /></button>
              </:trigger>
              <:content>
                <span class='toolbar-tooltip'>
                  <span class='toolbar-tooltip__label'>Edit embed</span>
                </span>
              </:content>
            </Tooltip>
          {{else}}
            <div class='toolbar-embed-trigger'>
              <Tooltip @placement='top' data-test-toolbar-tooltip='add-embed'>
                <:trigger>
                  <button
                    class='toolbar-btn
                      {{if this._embedPopoverOpen "toolbar-btn--active"}}'
                    data-test-toolbar='add-embed'
                    type='button'
                    aria-label='Add embed'
                    aria-expanded={{if this._embedPopoverOpen 'true' 'false'}}
                    {{on 'mousedown' this._preventFocusLoss}}
                    {{on 'click' this._toggleEmbedPopover}}
                  ><PlusIcon width='16' height='16' /></button>
                </:trigger>
                <:content>
                  <span class='toolbar-tooltip'>
                    <span class='toolbar-tooltip__label'>Add embed</span>
                  </span>
                </:content>
              </Tooltip>
              {{#if this._embedPopoverOpen}}
                <div
                  class='toolbar-embed-popover'
                  data-test-toolbar-embed-popover
                >
                  <button
                    type='button'
                    class='toolbar-embed-popover__item'
                    data-test-toolbar-embed='card'
                    {{on 'mousedown' this._preventFocusLoss}}
                    {{on 'click' (fn this._openEmbedChooser 'card')}}
                  >Add a card</button>
                  <button
                    type='button'
                    class='toolbar-embed-popover__item'
                    data-test-toolbar-embed='file'
                    {{on 'mousedown' this._preventFocusLoss}}
                    {{on 'click' (fn this._openEmbedChooser 'file')}}
                  >Add a file</button>
                </div>
              {{/if}}
            </div>
          {{/if}}
          <span class='toolbar-divider'></span>

          {{#each this.toolbarButtons as |btn|}}
            {{#if btn.divider}}
              <span class='toolbar-divider'></span>
            {{else}}
              {{! Every item gets a styled tooltip — the label, plus a shortcut
                  key badge when the item has a CodeMirror binding. The tooltip
                  is suppressed while the control is disabled. }}
              <Tooltip
                @placement='top'
                @disabled={{btn.disabled}}
                data-test-toolbar-tooltip={{btn.testId}}
              >
                <:trigger>
                  <button
                    class='toolbar-btn {{if btn.active "toolbar-btn--active"}}'
                    data-test-toolbar={{btn.testId}}
                    type='button'
                    aria-label={{btn.label}}
                    aria-pressed={{btn.ariaPressed}}
                    disabled={{btn.disabled}}
                    {{on 'mousedown' this._preventFocusLoss}}
                    {{on 'click' btn.action}}
                  >{{#let btn.icon as |Icon|}}<Icon
                        width='16'
                        height='16'
                      />{{/let}}</button>
                </:trigger>
                <:content>
                  <span class='toolbar-tooltip'>
                    <span class='toolbar-tooltip__label'>{{btn.label}}</span>
                    {{#if btn.shortcut}}
                      <kbd class='shortcut-key'>{{btn.shortcut}}</kbd>
                    {{/if}}
                  </span>
                </:content>
              </Tooltip>
            {{/if}}
          {{/each}}
        </div>

        {{! template-lint-disable no-invalid-interactive }}
        <div
          class='codemirror-mount'
          data-test-codemirror-mount
          {{on 'mousedown' this._focusEditorOnPointerDown}}
          {{this.mountEditor this.cm @content @onUpdate this.livePreview}}
        ></div>
      </div>

      {{#if this.livePreview}}
        {{#each this.cardRenderTargets as |target|}}
          {{#in-element target.element insertBefore=null}}
            {{#if target.instance}}
              {{! Card and file refs render identically — a `getComponent`-
                  rendered instance registered by `id`. Only the test hook
                  differs (card vs file). }}
              <CardContextConsumer as |context|>
                {{#let
                  (this.getCardComponent target.instance)
                  as |RefComponent|
                }}
                  {{#if (isInline target.kind)}}
                    <span
                      class='codemirror-card-slot
                        {{if
                          (eq target.format "atom")
                          "codemirror-card-slot--inline"
                          "codemirror-card-slot--inline-embed"
                        }}'
                      style={{if target.style (htmlSafe target.style)}}
                      data-test-codemirror-file-slot-inline={{if
                        (eq target.refType 'file')
                        ''
                      }}
                      data-test-codemirror-card-slot-inline={{if
                        (eq target.refType 'card')
                        ''
                      }}
                      {{context.cardComponentModifier
                        cardId=target.instance.id
                        format='data'
                        fieldType=undefined
                        fieldName=undefined
                      }}
                    >
                      <RefComponent
                        @format={{target.format}}
                        @displayContainer={{false}}
                      />
                    </span>
                  {{else}}
                    <div
                      class='codemirror-card-slot codemirror-card-slot--block'
                      style={{if target.style (htmlSafe target.style)}}
                      data-test-codemirror-file-slot-block={{if
                        (eq target.refType 'file')
                        ''
                      }}
                      data-test-codemirror-card-slot-block={{if
                        (eq target.refType 'card')
                        ''
                      }}
                      {{context.cardComponentModifier
                        cardId=target.instance.id
                        format='data'
                        fieldType=undefined
                        fieldName=undefined
                      }}
                    >
                      <RefComponent
                        @format={{target.format}}
                        @displayContainer={{false}}
                      />
                    </div>
                  {{/if}}
                {{/let}}
              </CardContextConsumer>
            {{else}}
              <span class='codemirror-card-fallback'>{{target.cardId}}</span>
            {{/if}}
          {{/in-element}}
        {{/each}}
      {{/if}}
    {{else}}
      <div class='codemirror-editor-loading' data-test-codemirror-loading>
        Loading editor…
      </div>
    {{/if}}
    <style scoped>
      @layer baseComponent {
        .codemirror-editor {
          display: flex;
          flex-direction: column;
          min-height: 120px;
          border: 1px solid var(--border, var(--boxel-border-color));
          border-radius: var(--boxel-border-radius);
          outline: 1px solid transparent;
          position: relative;
          transition:
            border-color var(--boxel-transition),
            outline-color var(--boxel-transition);
        }

        /* Match our input/textarea hover + focus affordances so the field
           reads as editable. :focus-within stands in for :focus-visible since
           the focusable element is the nested CodeMirror content. */
        .codemirror-editor:hover:not(:focus-within) {
          border-color: var(--border, currentColor);
        }

        .codemirror-editor:focus-within {
          border-color: var(--ring, var(--boxel-highlight));
          outline-color: var(--ring, var(--boxel-highlight));
        }

        /* Fill the field so clicking anywhere below the text focuses it. */
        .codemirror-mount {
          flex: 1;
          padding: var(--boxel-sp-xs);
          cursor: text;
        }

        .codemirror-editor :deep(.cm-editor) {
          outline: none;
          min-height: 100px;
          font-family: inherit;
          font-size: inherit;
        }

        .codemirror-editor :deep(.cm-editor.cm-focused) {
          outline: none;
        }

        .codemirror-editor :deep(.cm-content) {
          font-family: inherit;
          line-height: 1.6;
        }

        .codemirror-editor :deep(.cm-line) {
          padding: 0 2px;
        }

        /* ── Markdown live preview: headings ── */
        .codemirror-editor :deep(.cm-md-h1) {
          font-size: 1.8em;
          font-weight: 700;
          line-height: 1.3;
        }

        .codemirror-editor :deep(.cm-md-h2) {
          font-size: 1.5em;
          font-weight: 700;
          line-height: 1.3;
        }

        .codemirror-editor :deep(.cm-md-h3) {
          font-size: 1.25em;
          font-weight: 600;
          line-height: 1.4;
        }

        .codemirror-editor :deep(.cm-md-h4) {
          font-size: 1.1em;
          font-weight: 600;
          line-height: 1.4;
        }

        .codemirror-editor :deep(.cm-md-h5) {
          font-size: 1em;
          font-weight: 600;
        }

        .codemirror-editor :deep(.cm-md-h6) {
          font-size: 0.9em;
          font-weight: 600;
          color: var(--boxel-400, #666);
        }

        /* ── Markdown live preview: markers ── */
        .codemirror-editor :deep(.cm-md-marker) {
          color: var(--boxel-400, #999);
          opacity: 0.6;
        }

        .codemirror-editor :deep(.cm-md-marker--dim) {
          opacity: 0.3;
        }

        .codemirror-editor :deep(.cm-md-marker--hidden) {
          font-size: 0;
          opacity: 0;
          overflow: hidden;
          display: inline;
          width: 0;
        }

        /* ── Markdown live preview: inline formatting ── */
        .codemirror-editor :deep(.cm-md-bold) {
          font-weight: 700;
        }

        .codemirror-editor :deep(.cm-md-italic) {
          font-style: italic;
        }

        .codemirror-editor :deep(.cm-md-strikethrough) {
          text-decoration: line-through;
        }

        .codemirror-editor :deep(.cm-md-inline-code) {
          font-family: var(--boxel-font-family-mono, ui-monospace, monospace);
          font-size: 0.9em;
          background-color: var(--boxel-100, #f0f0f0);
          border-radius: 3px;
          padding: 1px 4px;
        }

        /* ── Markdown live preview: code blocks ── */
        .codemirror-editor :deep(.cm-md-code-line) {
          background-color: var(--boxel-100, #f5f5f5);
        }

        .codemirror-editor :deep(.cm-md-code-line .cm-line) {
          font-family: var(--boxel-font-family-mono, ui-monospace, monospace);
          font-size: 0.9em;
        }

        .codemirror-editor :deep(.cm-md-code-fence) {
          color: var(--boxel-400, #999);
          opacity: 0.5;
        }

        .codemirror-editor :deep(.cm-md-code-info) {
          color: var(--boxel-400, #999);
          font-size: 0.85em;
        }

        /* ── Markdown live preview: blockquotes ── */
        .codemirror-editor :deep(.cm-md-blockquote-line) {
          border-left: 3px solid var(--boxel-300, #ccc);
          padding-left: 12px;
          color: var(--boxel-500, #555);
        }

        .codemirror-editor :deep(.cm-md-quote-mark) {
          color: var(--boxel-300, #ccc);
          opacity: 0.5;
        }

        /* ── Markdown live preview: horizontal rules ── */
        .codemirror-editor :deep(.cm-md-hr-line) {
          color: var(--boxel-400, #999);
          opacity: 0.4;
        }

        .codemirror-editor :deep(.cm-md-hr-widget) {
          display: block;
          border: none;
          border-top: 1px solid var(--boxel-300, #ddd);
          margin: 8px 0;
        }

        /* ── Markdown live preview: lists ── */
        .codemirror-editor :deep(.cm-md-list-mark) {
          color: var(--boxel-dark, #000);
          font-weight: 600;
        }

        /* ── Markdown live preview: links ── */
        .codemirror-editor :deep(.cm-md-link-text) {
          color: var(--boxel-highlight, #0078d4);
          text-decoration: underline;
          text-decoration-color: var(--boxel-highlight, #0078d4);
          text-underline-offset: 2px;
        }

        .codemirror-editor :deep(.cm-md-link-url) {
          color: var(--boxel-400, #999);
          font-size: 0.85em;
        }

        /* ── BFM card reference syntax (cursor-on-line) ── */
        .codemirror-editor :deep(.cm-bfm-card-ref) {
          background-color: var(--boxel-100, #f0f0f0);
          border-radius: 3px;
          padding: 0 2px;
        }

        .codemirror-editor :deep(.cm-bfm-card-ref--inline) {
          font-size: 0.85em;
          color: var(--boxel-400, #666);
        }

        /* ── Card widget containers ── */
        .codemirror-editor :deep(.cm-card-widget) {
          user-select: none;
          white-space: normal;
        }

        .codemirror-editor :deep(.cm-card-widget--inline) {
          display: inline;
          vertical-align: baseline;
        }

        .codemirror-editor :deep(.cm-card-widget--block) {
          display: block;
          margin: var(--boxel-sp-xs, 4px) 0;
          min-height: 40px;
        }

        /* Card slot wrappers rendered via in-element helper */
        .codemirror-editor :deep(.codemirror-card-slot) {
          contain: layout style paint;
        }

        .codemirror-editor :deep(.codemirror-card-slot--inline) {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background-color: var(--boxel-100, #f0f0f0);
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          /* 2px less rounded than the default: the atom pill read too round. */
          border-radius: calc(var(--boxel-border-radius, 4px) - 2px);
          padding: 1px 6px;
          font-size: 0.85em;
          cursor: pointer;
        }

        /* Inline embeds with an explicit non-atom format flow inline-block so a
           sized card sits in the text run without the atom pill's flex chrome,
           mirroring the saved/preview markdown renderers. */
        .codemirror-editor :deep(.codemirror-card-slot--inline-embed) {
          display: inline-block;
          vertical-align: middle;
        }

        .codemirror-editor :deep(.codemirror-card-slot--block) {
          display: block;
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          overflow: hidden;
        }

        /* Fallback for unresolved card references */
        .codemirror-editor :deep(.codemirror-card-fallback) {
          display: inline-block;
          padding: 1px 6px;
          background-color: var(--boxel-100, #f0f0f0);
          border: 1px dashed var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          font-size: 0.85em;
          color: var(--boxel-400, #666);
          word-break: break-all;
        }

        /* ── Docked toolbar ── */
        /* The sticky docked-bar layout (.codemirror-toolbar container) is
           provided by the host RichMarkdownField so the compose/source bar and
           the preview bar share one definition. Only the buttons are styled
           here. */
        /* Colors inherit the card theme (--foreground/--primary/--border) and
           fall back to the boxel palette when no theme is applied, so the
           toolbar stays legible in dark themes. */
        .toolbar-btn {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 28px;
          height: 28px;
          border: none;
          border-radius: var(--boxel-border-radius-sm);
          background: transparent;
          color: var(--foreground, var(--boxel-500));
          cursor: pointer;
          padding: 0;
          transition:
            background-color 0.1s,
            color 0.1s;
        }

        .toolbar-btn:hover:not(:disabled) {
          background: color-mix(in oklab, currentColor 8%, transparent);
        }

        .toolbar-btn--active:not(:disabled) {
          background: var(--primary, var(--boxel-200));
          color: var(--primary-foreground, var(--boxel-700));
        }

        .toolbar-btn:disabled {
          color: var(--muted-foreground, var(--boxel-300));
          cursor: not-allowed;
        }

        /* Tooltip content: label at left, shortcut in a darker key badge at
           right. Rendered into the shared #tooltip-overlay, but these rules
           still apply — scoped CSS keys off the element's class, not its
           position in the DOM tree. */
        .toolbar-tooltip {
          display: inline-flex;
          align-items: center;
          gap: var(--boxel-sp-xxs);
        }

        .shortcut-key {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          min-width: 1.4em;
          padding: 0 var(--boxel-sp-5xs);
          border-radius: var(--boxel-border-radius-xs, 4px);
          background: rgb(0 0 0 / 35%);
          color: var(--boxel-450, #939393);
          font-family: inherit;
          font-size: 0.9em;
          line-height: 1.5;
        }

        .toolbar-divider {
          width: 1px;
          height: 18px;
          background: var(--border, var(--boxel-200));
          margin: 0 var(--boxel-sp-5xs);
        }

        .toolbar-embed-trigger {
          position: relative;
          display: inline-flex;
        }
        .toolbar-embed-popover {
          position: absolute;
          top: 100%;
          left: 0;
          margin-top: 4px;
          min-width: 140px;
          background: var(--boxel-light);
          color: var(--boxel-dark);
          border: 1px solid var(--boxel-300);
          border-radius: var(--boxel-border-radius);
          box-shadow: var(--boxel-deep-box-shadow);
          padding: var(--boxel-sp-4xs) 0;
          z-index: 5;
          display: flex;
          flex-direction: column;
        }
        .toolbar-embed-popover__item {
          appearance: none;
          background: none;
          border: none;
          text-align: left;
          padding: var(--boxel-sp-4xs) var(--boxel-sp-xs);
          font: var(--boxel-font-sm);
          cursor: pointer;
        }
        .toolbar-embed-popover__item:hover {
          background: var(--boxel-100);
        }

        .codemirror-editor-loading {
          min-height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--boxel-400, #999);
          font-style: italic;
        }
      }
    </style>
  </template>
}
