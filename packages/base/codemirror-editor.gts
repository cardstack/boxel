import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { isDestroying, isDestroyed } from '@ember/destroyable';
import { modifier } from 'ember-modifier';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { scheduleOnce } from '@ember/runloop';
import { eq, not } from '@cardstack/boxel-ui/helpers';

import {
  trimJsonExtension,
  maybeRelativeReference,
  type VirtualNetwork,
} from '@cardstack/runtime-common';
import { type BaseDef, type CardDef, getComponent } from './card-api';
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

// The CodeMirrorContext type is defined in the host app's lazy-loaded module.
// We only use it as a type here — the actual module is loaded at runtime via
// globalThis.__loadCodeMirror.
interface CardWidgetTarget {
  element: HTMLElement;
  cardId: string;
  format: 'atom' | 'embedded';
  kind: 'inline' | 'block';
}

interface CardRenderTarget extends CardWidgetTarget {
  card: CardDef | null;
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
}

interface CodeMirrorContext {
  EditorState: any;
  EditorView: any;
  createEditorState: (options: {
    content: string;
    onDocChange: (text: string) => void;
    onCardTargetsChange: (targets: CardWidgetTarget[]) => void;
    onOpenCardSearch: (pos: { from: number; to: number }) => void;
    onSelectionChange?: (info: SelectionInfo) => void;
    livePreview?: boolean;
  }) => any;
  undo: any;
  redo: any;
  wrapWith: (marker: string) => (view: any) => boolean;
  toggleLink: (view: any) => boolean;
}

const SAVE_DEBOUNCE_MS = 500;

function isInline(kind: string): boolean {
  return kind === 'inline';
}

function resolveUrl(
  raw: string,
  baseUrl: string | null | undefined,
  virtualNetwork: VirtualNetwork | undefined,
): string {
  // With a VN, resolve through it so prefix-form bases and registered
  // prefix-form refs round-trip correctly. Without a VN, plain
  // `new URL(raw, baseUrl)` still handles the common case — URL-form
  // refs (with or without a base) and relative refs against a URL-form
  // base. Prefix-form bases need a VN; `new URL()` throws on those and
  // we fall back to the raw ref.
  try {
    if (virtualNetwork) {
      return trimJsonExtension(
        virtualNetwork.resolveURL(raw, baseUrl || undefined).href,
      );
    }
    return trimJsonExtension(new URL(raw, baseUrl || undefined).href);
  } catch {
    return trimJsonExtension(raw);
  }
}

function makeCardRef(
  cardUrl: string,
  baseUrl: string | null | undefined,
): string {
  if (!baseUrl) return cardUrl;
  try {
    return maybeRelativeReference(
      new URL(cardUrl),
      new URL(baseUrl),
      undefined,
    );
  } catch {
    return cardUrl;
  }
}

function labelFromUrl(url: string): string {
  let cleaned = trimJsonExtension(url);
  let parts = cleaned.split('/');
  return parts[parts.length - 1] || cleaned;
}

interface CodeMirrorEditorSignature {
  Args: {
    content: string | null | undefined;
    onUpdate: (markdown: string) => void;
    linkedCards?: CardDef[] | null;
    cardReferenceBaseUrl?: string | null;
    cardReferenceVirtualNetwork?: VirtualNetwork;
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
    a.formats.bold === b.formats.bold &&
    a.formats.italic === b.formats.italic &&
    a.formats.code === b.formats.code &&
    a.formats.strikethrough === b.formats.strikethrough &&
    a.formats.link === b.formats.link
  );
}

export default class CodeMirrorEditor extends GlimmerComponent<CodeMirrorEditorSignature> {
  @tracked _cm: CodeMirrorContext | null = null;
  @tracked _widgetTargets: CardWidgetTarget[] = [];
  @tracked _isLoaded = false;

  // ── Card search state ────────────────────────────────────────────────────
  @tracked _cardSearchMode = false;
  @tracked _cardSearchText = '';
  @tracked _cardSearchIndex = 0;
  @tracked _menuCoords: { left: number; top: number } | null = null;

  // Format picker (after selecting a card from search)
  @tracked _formatPickerCardUrl: string | null = null;
  @tracked _formatPickerCardTitle: string | null = null;

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

  // ── Card search logic ────────────────────────────────────────────────────

  private _handleOpenCardSearch = (_pos: { from: number; to: number }) => {
    if (isDestroying(this) || isDestroyed(this)) return;
    this._cardSearchMode = true;
    this._cardSearchText = '';
    this._cardSearchIndex = 0;
    this._updateMenuCoords();
    scheduleOnce('afterRender', this, this._focusSearchInput);
  };

  private _updateMenuCoords() {
    let view = this.editorView;
    if (!view) {
      this._menuCoords = null;
      return;
    }
    try {
      let { head } = view.state.selection.main;
      let coords = view.coordsAtPos(head);
      let editorRect = view.dom
        .closest('.codemirror-editor')
        ?.getBoundingClientRect();
      if (editorRect && coords) {
        this._menuCoords = {
          left: coords.left - editorRect.left,
          top: coords.bottom - editorRect.top + 4,
        };
      }
    } catch {
      this._menuCoords = null;
    }
  }

  get menuStyle(): string {
    let coords = this._menuCoords;
    if (!coords) return 'display: none';
    return `left: ${coords.left}px; top: ${coords.top}px;`;
  }

  private _focusSearchInput = () => {
    // Scope query to this editor instance's container to avoid focusing
    // the wrong input when multiple editors exist on the page
    let container = this.editorView?.dom?.closest('.codemirror-editor');
    let input = (container ?? document).querySelector(
      '[data-codemirror-card-search-input]',
    ) as HTMLInputElement;
    input?.focus();
  };

  // ── Card search resource ─────────────────────────────────────────────────

  private _searchResourceCreated = false;
  private _searchResource: {
    instances: CardDef[];
    isLoading: boolean;
  } | null = null;

  get cardSearchResults(): CardDef[] {
    if (!this._cardSearchMode) return [];
    if (!this._searchResourceCreated) {
      this._searchResourceCreated = true;
      try {
        let getCards = this.args.getCards;
        if (typeof getCards === 'function') {
          this._searchResource =
            getCards(this, () => {
              let text = this._cardSearchText?.trim();
              if (!text) return undefined;
              return {
                filter: { contains: { name: text } },
                page: { size: 10 },
              };
            }) ?? null;
        }
      } catch {
        // Card search not available
      }
    }
    return this._searchResource?.instances ?? [];
  }

  get isSearchLoading(): boolean {
    return this._searchResource?.isLoading ?? false;
  }

  _handleCardSearchInput = (event: Event) => {
    this._cardSearchText = (event.target as HTMLInputElement).value;
    this._cardSearchIndex = 0;
  };

  _handleCardSearchKeydown = (evt: Event) => {
    let event = evt as KeyboardEvent;
    if (event.key === 'Escape') {
      event.preventDefault();
      this._dismissCardSearch();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      let max = this.cardSearchResults.length;
      if (max > 0) {
        this._cardSearchIndex = (this._cardSearchIndex + 1) % max;
      }
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      let max = this.cardSearchResults.length;
      if (max > 0) {
        this._cardSearchIndex = (this._cardSearchIndex - 1 + max) % max;
      }
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Check if the input looks like a URL
      let text = this._cardSearchText.trim();
      if (
        text &&
        (text.startsWith('http://') ||
          text.startsWith('https://') ||
          text.startsWith('./'))
      ) {
        this._formatPickerCardUrl = text;
        this._formatPickerCardTitle = labelFromUrl(text);
        this._cardSearchMode = false;
        return;
      }
      // Otherwise select the highlighted search result
      let results = this.cardSearchResults;
      let card = results[this._cardSearchIndex];
      if (card) {
        this._selectCardResult(card);
      }
      return;
    }
  };

  _selectCardResult = (card: CardDef) => {
    if (!card.id) return;
    this._formatPickerCardUrl = card.id;
    this._formatPickerCardTitle = (card as any).title ?? labelFromUrl(card.id);
    this._cardSearchMode = false;
  };

  _dismissCardSearch = () => {
    this._cardSearchMode = false;
    this._cardSearchText = '';
    this._cardSearchIndex = 0;
    this._menuCoords = null;
    this.editorView?.focus();
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
    return [
      { testId: 'bold', label: 'Bold', icon: BoldIcon, action: this._wrapBold, active: f.bold, ariaPressed: pressed(f.bold) },
      { testId: 'italic', label: 'Italic', icon: ItalicIcon, action: this._wrapItalic, active: f.italic, ariaPressed: pressed(f.italic) },
      { testId: 'strikethrough', label: 'Strikethrough', icon: StrikethroughIcon, action: this._wrapStrikethrough, active: f.strikethrough, ariaPressed: pressed(f.strikethrough) },
      { testId: 'code', label: 'Code', icon: CodeIcon, action: this._wrapCode, active: f.code, ariaPressed: pressed(f.code) },
      { testId: 'link', label: 'Link', icon: LinkIcon, action: this._toggleLink, active: f.link, ariaPressed: pressed(f.link) },
      { divider: true },
      { testId: 'h1', label: 'Heading 1', icon: Heading1Icon, action: this._insertH1 },
      { testId: 'h2', label: 'Heading 2', icon: Heading2Icon, action: this._insertH2 },
      { testId: 'h3', label: 'Heading 3', icon: Heading3Icon, action: this._insertH3 },
      { divider: true },
      { testId: 'bullet-list', label: 'Bullet List', icon: ListIcon, action: this._toggleBulletList },
      { testId: 'numbered-list', label: 'Numbered List', icon: ListOrderedIcon, action: this._toggleNumberedList },
      { testId: 'blockquote', label: 'Blockquote', icon: BlockquoteIcon, action: this._toggleBlockquote },
    ];
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

  // ── Card insertion ───────────────────────────────────────────────────────

  _insertCardWithFormat = (format: string) => {
    let cardUrl = this._formatPickerCardUrl;
    if (!cardUrl) return;

    let view = this.editorView;
    if (!view) return;

    let baseUrl = this.args.cardReferenceBaseUrl;
    let ref = makeCardRef(cardUrl, baseUrl);

    let { from } = view.state.selection.main;

    if (format === 'inline') {
      view.dispatch({
        changes: { from, insert: `:card[${ref}]` },
      });
    } else {
      // For block cards, insert on a new line
      let line = view.state.doc.lineAt(from);
      let insertPos = line.to;
      let prefix = line.text.trim() === '' ? '' : '\n';
      view.dispatch({
        changes: { from: insertPos, insert: `${prefix}::card[${ref}]\n` },
      });
    }

    // Clean up all popup state
    this._formatPickerCardUrl = null;
    this._formatPickerCardTitle = null;
    this._cardSearchMode = false;
    this._cardSearchText = '';
    this._menuCoords = null;

    view.focus();

    // Trigger save immediately
    let onUpdate = this.args.onUpdate;
    if (onUpdate) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      onUpdate(view.state.doc.toString());
    }
  };

  _dismissFormatPicker = () => {
    this._formatPickerCardUrl = null;
    this._formatPickerCardTitle = null;
    this._menuCoords = null;
    this.editorView?.focus();
  };

  // ── Card reference resolution via getCards ────────────────────────────────
  // The linkedCards linksToMany query on RichMarkdownField returns empty in
  // edit mode because nested FieldDef instances lack a card store. We bypass
  // that by using getCards (from CardContext) to resolve cards independently.

  private _cardRefResourceCreated = false;
  private _cardRefResource: {
    instances: CardDef[];
    isLoading: boolean;
  } | null = null;

  get _resolvedCardUrls(): string[] {
    let baseUrl = this.args.cardReferenceBaseUrl;
    let vn = this.args.cardReferenceVirtualNetwork;
    let urls = new Set<string>();
    for (let target of this._widgetTargets) {
      urls.add(resolveUrl(target.cardId, baseUrl, vn));
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
            let urls = this._resolvedCardUrls;
            if (!urls.length) return undefined;
            return {
              filter: { in: { id: urls } },
            };
          }) ?? null;
      }
    }
    return this._cardRefResource?.instances ?? [];
  }

  // ── Card slot resolution ─────────────────────────────────────────────────

  @cached
  get cardRenderTargets(): CardRenderTarget[] {
    let targets = this._widgetTargets;
    let baseUrl = this.args.cardReferenceBaseUrl;

    let cardsByUrl = new Map<string, CardDef>();

    // Use linkedCards if available (works when store is present)
    let linkedCards = this.args.linkedCards;
    if (linkedCards?.length) {
      for (let card of linkedCards) {
        if (card?.id) {
          cardsByUrl.set(card.id, card);
        }
      }
    }

    // Also use cards resolved via getCards resource (bypasses FallbackCardStore)
    let resolved = this.resolvedCards;
    if (resolved?.length) {
      for (let card of resolved) {
        if (card?.id) {
          cardsByUrl.set(card.id, card);
        }
      }
    }

    let vn = this.args.cardReferenceVirtualNetwork;
    return targets.map((target) => {
      let resolvedUrl = resolveUrl(target.cardId, baseUrl, vn);
      return {
        ...target,
        card: cardsByUrl.get(resolvedUrl) ?? null,
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
          t.element === pending[i].element,
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
    this._menuCoords = null;
    this._formatPickerCardUrl = null;
    this._formatPickerCardTitle = null;
    this._searchResource = null;
    this._cardRefResource = null;
    this._searchResourceCreated = false;
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
      onOpenCardSearch: this._handleOpenCardSearch,
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

          {{#each this.toolbarButtons as |btn|}}
            {{#if btn.divider}}
              <span class='toolbar-divider'></span>
            {{else}}
              <button
                class='toolbar-btn {{if btn.active "toolbar-btn--active"}}'
                data-test-toolbar={{btn.testId}}
                type='button'
                title={{btn.label}}
                aria-label={{btn.label}}
                aria-pressed={{btn.ariaPressed}}
                disabled={{not this.toolbarEnabled}}
                {{on 'mousedown' this._preventFocusLoss}}
                {{on 'click' btn.action}}
              >{{#let btn.icon as |Icon|}}<Icon
                    width='16'
                    height='16'
                  />{{/let}}</button>
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

        {{! ── Card search popup ── }}
      {{! template-lint-disable no-pointer-down-event-binding }}
      {{#if this._cardSearchMode}}
        <div
          class='codemirror-card-search'
          style={{this.menuStyle}}
          data-test-card-search
        >
          <input
            class='codemirror-card-search-input'
            placeholder='Search cards or paste URL…'
            aria-label='Search cards or paste URL'
            value={{this._cardSearchText}}
            data-codemirror-card-search-input
            data-test-card-search-input
            {{on 'input' this._handleCardSearchInput}}
            {{on 'keydown' this._handleCardSearchKeydown}}
          />
          {{#if this.isSearchLoading}}
            <div class='codemirror-card-search-loading'>Searching…</div>
          {{/if}}
          {{#if this.cardSearchResults.length}}
            <div
              class='codemirror-card-search-results'
              data-test-card-search-results
            >
              {{#each this.cardSearchResults as |card index|}}
                <button
                  class='codemirror-card-search-result
                    {{if (eq index this._cardSearchIndex) "selected"}}'
                  data-test-card-search-result
                  {{on 'mousedown' this._preventFocusLoss}}
                  {{on 'click' (fn this._selectCardResult card)}}
                >
                  <span class='search-result-title'>{{card.title}}</span>
                  {{#if card.id}}
                    <span class='search-result-url'>{{card.id}}</span>
                  {{/if}}
                </button>
              {{/each}}
            </div>
          {{/if}}
        </div>
      {{/if}}

      {{! ── Format picker popup ── }}
      {{! template-lint-disable no-pointer-down-event-binding }}
      {{#if this._formatPickerCardUrl}}
        <div
          class='codemirror-format-picker'
          style={{this.menuStyle}}
          data-test-format-picker
        >
          <span class='format-picker-label'>
            Insert "{{this._formatPickerCardTitle}}" as:
          </span>
          <div class='format-picker-buttons'>
            <button
              class='format-picker-btn'
              data-test-format-inline
              {{on 'mousedown' this._preventFocusLoss}}
              {{on 'click' (fn this._insertCardWithFormat 'inline')}}
            >
              Inline
            </button>
            <button
              class='format-picker-btn format-picker-btn--primary'
              data-test-format-block
              {{on 'mousedown' this._preventFocusLoss}}
              {{on 'click' (fn this._insertCardWithFormat 'block')}}
            >
              Block
            </button>
          </div>
          <button
            class='format-picker-dismiss'
            data-test-format-picker-dismiss
            {{on 'mousedown' this._preventFocusLoss}}
            {{on 'click' this._dismissFormatPicker}}
          >
            Cancel
          </button>
        </div>
      {{/if}}
      </div>

      {{#if this.livePreview}}
        {{#each this.cardRenderTargets as |target|}}
          {{#in-element target.element insertBefore=null}}
            {{#if target.card}}
              <CardContextConsumer as |context|>
                {{#let (this.getCardComponent target.card) as |CardComponent|}}
                  {{#if (isInline target.kind)}}
                    <span
                      class='codemirror-card-slot codemirror-card-slot--inline'
                      data-test-codemirror-card-slot-inline
                      {{context.cardComponentModifier
                        card=target.card
                        format='data'
                        fieldType=undefined
                        fieldName=undefined
                      }}
                    >
                      <CardComponent
                        @format={{target.format}}
                        @displayContainer={{false}}
                      />
                    </span>
                  {{else}}
                    <div
                      class='codemirror-card-slot codemirror-card-slot--block'
                      data-test-codemirror-card-slot-block
                      {{context.cardComponentModifier
                        card=target.card
                        format='data'
                        fieldType=undefined
                        fieldName=undefined
                      }}
                    >
                      <CardComponent
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

        .codemirror-editor :deep(.cm-bfm-card-ref--block) {
          display: inline-block;
          font-size: 0.85em;
          color: var(--boxel-400, #666);
          padding: 2px 6px;
        }

        .codemirror-editor :deep(.cm-bfm-card-ref--active) {
          background-color: var(--boxel-highlight-hover, #e8f0fe);
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
          border-radius: var(--boxel-border-radius, 4px);
          padding: 1px 6px;
          font-size: 0.85em;
          cursor: pointer;
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

        .toolbar-divider {
          width: 1px;
          height: 18px;
          background: var(--border, var(--boxel-200));
          margin: 0 var(--boxel-sp-5xs);
        }

        .codemirror-editor-loading {
          min-height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--boxel-400, #999);
          font-style: italic;
        }

        /* ── Card search popup ── */
        .codemirror-card-search {
          position: absolute;
          z-index: 100;
          background: var(--boxel-light, #fff);
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
          min-width: 280px;
          max-width: 400px;
          padding: 8px;
        }

        .codemirror-card-search-input {
          width: 100%;
          padding: 6px 10px;
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          font: inherit;
          font-size: 0.9em;
          outline: none;
          box-sizing: border-box;
        }

        .codemirror-card-search-input:focus {
          border-color: var(--boxel-highlight, #0078d4);
          box-shadow: 0 0 0 1px var(--boxel-highlight, #0078d4);
        }

        .codemirror-card-search-loading {
          padding: 8px 4px;
          color: var(--boxel-400, #666);
          font-size: 0.85em;
          font-style: italic;
        }

        .codemirror-card-search-results {
          margin-top: 4px;
          max-height: 240px;
          overflow-y: auto;
        }

        .codemirror-card-search-result {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          width: 100%;
          padding: 6px 10px;
          border: none;
          background: transparent;
          cursor: pointer;
          border-radius: var(--boxel-border-radius, 4px);
          text-align: left;
          font: inherit;
        }

        .codemirror-card-search-result:hover,
        .codemirror-card-search-result.selected {
          background: var(--boxel-highlight-hover, #e8f0fe);
        }

        .search-result-title {
          font-weight: 500;
          font-size: 0.9em;
        }

        .search-result-url {
          font-size: 0.75em;
          color: var(--boxel-400, #666);
          word-break: break-all;
        }

        /* ── Format picker popup ── */
        .codemirror-format-picker {
          position: absolute;
          z-index: 100;
          background: var(--boxel-light, #fff);
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
          padding: 12px;
          min-width: 220px;
        }

        .format-picker-label {
          display: block;
          font-size: 0.85em;
          color: var(--boxel-400, #666);
          margin-bottom: 8px;
          word-break: break-word;
        }

        .format-picker-buttons {
          display: flex;
          gap: 8px;
          margin-bottom: 8px;
        }

        .format-picker-btn {
          flex: 1;
          padding: 6px 12px;
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          background: var(--boxel-light, #fff);
          cursor: pointer;
          font: inherit;
          font-size: 0.9em;
        }

        .format-picker-btn:hover {
          background: var(--boxel-highlight-hover, #e8f0fe);
        }

        .format-picker-btn--primary {
          background: var(--boxel-highlight, #0078d4);
          color: white;
          border-color: var(--boxel-highlight, #0078d4);
        }

        .format-picker-btn--primary:hover {
          opacity: 0.9;
        }

        .format-picker-dismiss {
          display: block;
          width: 100%;
          padding: 4px;
          border: none;
          background: transparent;
          color: var(--boxel-400, #666);
          cursor: pointer;
          font: inherit;
          font-size: 0.8em;
          text-align: center;
        }

        .format-picker-dismiss:hover {
          color: var(--boxel-dark, #333);
        }
      }
    </style>
  </template>
}
