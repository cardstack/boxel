import { task } from 'ember-concurrency';
import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { fn } from '@ember/helper';
import { on } from '@ember/modifier';
import { scheduleOnce } from '@ember/runloop';
import { eq } from '@cardstack/boxel-ui/helpers';

import {
  resolveCardReference,
  trimJsonExtension,
  maybeRelativeURL,
} from '@cardstack/runtime-common';
import { type BaseDef, type CardDef, getComponent } from './card-api';
import { CardContextConsumer } from './field-component';

// The ProseMirrorContext type is defined in the host app's lazy-loaded module.
// We only use it as a type here — the actual module is loaded at runtime via
// globalThis.__loadProseMirror.
interface CardNodeViewTarget {
  element: HTMLElement;
  cardId: string;
  format: 'atom' | 'embedded';
  kind: 'inline' | 'block';
}

interface CardRenderTarget extends CardNodeViewTarget {
  card: CardDef | null;
}

interface ProseMirrorContext {
  schema: any;
  EditorState: any;
  EditorView: any;
  keymap: (bindings: Record<string, any>) => any;
  baseKeymap: Record<string, any>;
  history: () => any;
  undo: any;
  redo: any;
  toggleMark: (markType: any) => any;
  setBlockType: (nodeType: any, attrs?: any) => any;
  wrapIn: (nodeType: any) => any;
  lift: any;
  wrapInList: (listType: any) => any;
  splitListItem: (itemType: any) => any;
  liftListItem: (itemType: any) => any;
  sinkListItem: (itemType: any) => any;
  parseMarkdown: (text: string) => any;
  serializeMarkdown: (doc: any) => string;
  createCardNodeViews: (
    onChange: (targets: CardNodeViewTarget[]) => void,
  ) => Record<string, any>;
  createSlashCommandPlugin: (
    onStateChange: (state: SlashCommandState | null) => void,
    onSelectItem: (index: number) => void,
    onNavigate: (direction: 'up' | 'down') => void,
  ) => any;
  slashCommandPluginKey: any;
}

interface SlashCommandState {
  active: boolean;
  query: string;
  from: number;
}

interface SlashMenuItem {
  id: string;
  label: string;
  description: string;
}

const SLASH_COMMANDS: SlashMenuItem[] = [
  { id: 'card', label: 'Card', description: 'Insert a card reference' },
];

const SAVE_DEBOUNCE_MS = 500;

function isInline(kind: string): boolean {
  return kind === 'inline';
}

function resolveUrl(raw: string, baseUrl: string | null | undefined): string {
  try {
    return trimJsonExtension(resolveCardReference(raw, baseUrl || undefined));
  } catch {
    return trimJsonExtension(raw);
  }
}

function makeCardRef(cardUrl: string, baseUrl: string | null | undefined): string {
  if (!baseUrl) return cardUrl;
  try {
    return maybeRelativeURL(new URL(cardUrl), new URL(baseUrl), undefined);
  } catch {
    return cardUrl;
  }
}

function labelFromUrl(url: string): string {
  let cleaned = trimJsonExtension(url);
  let parts = cleaned.split('/');
  return parts[parts.length - 1] || cleaned;
}

interface ProseMirrorEditorSignature {
  Args: {
    content: string | null;
    onUpdate: (markdown: string) => void;
    linkedCards?: CardDef[] | null;
    cardReferenceBaseUrl?: string | null;
    getCards?: (
      parent: object,
      getQuery: () => Record<string, unknown> | undefined,
    ) => { instances: CardDef[]; isLoading: boolean } | undefined;
  };
  Element: HTMLDivElement;
}

export default class ProseMirrorEditor extends GlimmerComponent<ProseMirrorEditorSignature> {
  @tracked _pm: ProseMirrorContext | null = null;
  @tracked _nodeViewTargets: CardNodeViewTarget[] = [];

  // Non-tracked staging area — updated synchronously by nodeView callbacks,
  // then flushed into the tracked property after rendering to avoid
  // Glimmer backtracking assertions.
  private _pendingTargets: CardNodeViewTarget[] = [];

  // ── Slash command state ──────────────────────────────────────────────────
  @tracked _slashState: SlashCommandState | null = null;
  @tracked _slashMenuIndex = 0;
  @tracked _menuCoords: { left: number; top: number } | null = null;

  // Card search mode (after selecting /card)
  @tracked _cardSearchMode = false;
  @tracked _cardSearchText = '';
  @tracked _cardSearchIndex = 0;

  // Format picker (after selecting a card from search)
  @tracked _formatPickerCardUrl: string | null = null;
  @tracked _formatPickerCardTitle: string | null = null;

  get pm(): ProseMirrorContext | null {
    if (!this._pm) {
      this._loadProseMirrorTask.perform();
    }
    return this._pm;
  }

  _loadProseMirrorTask = task({ drop: true }, async () => {
    let loadProseMirror = (globalThis as any).__loadProseMirror;
    if (typeof loadProseMirror !== 'function') {
      return;
    }
    this._pm = await loadProseMirror();
  });

  private editorView: any = null;
  private lastExternalContent: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _slotUpdatePending = false;

  // ── Slash command logic ────────────────────────────────────────────────

  get slashMenuActive(): boolean {
    return this._slashState?.active === true && !this._cardSearchMode && !this._formatPickerCardUrl;
  }

  get filteredSlashCommands(): SlashMenuItem[] {
    let query = (this._slashState?.query ?? '').toLowerCase();
    if (!query) return SLASH_COMMANDS;
    return SLASH_COMMANDS.filter((cmd) => cmd.id.startsWith(query));
  }

  get slashMenuStyle(): string {
    let coords = this._menuCoords;
    if (!coords) return 'display: none';
    return `left: ${coords.left}px; top: ${coords.top}px;`;
  }

  private _updateMenuCoords() {
    let view = this.editorView;
    let state = this._slashState;
    if (!view || !state) {
      this._menuCoords = null;
      return;
    }
    try {
      let coords = view.coordsAtPos(state.from);
      let editorRect = view.dom.closest('.prosemirror-editor')?.getBoundingClientRect();
      if (editorRect) {
        this._menuCoords = {
          left: coords.left - editorRect.left,
          top: coords.bottom - editorRect.top + 4,
        };
      }
    } catch {
      this._menuCoords = null;
    }
  }

  private _handleSlashStateChange = (state: SlashCommandState | null) => {
    if (!state?.active && this._slashState?.active) {
      // Slash menu closing — if we're not in card search mode, clean up
      if (!this._cardSearchMode && !this._formatPickerCardUrl) {
        this._slashState = null;
        this._menuCoords = null;
        this._slashMenuIndex = 0;
        return;
      }
    }
    this._slashState = state;
    this._slashMenuIndex = 0;
    if (state?.active) {
      this._updateMenuCoords();
    } else if (!this._cardSearchMode && !this._formatPickerCardUrl) {
      this._menuCoords = null;
    }
  };

  private _handleSlashNavigate = (direction: 'up' | 'down') => {
    if (this._cardSearchMode) {
      let results = this.cardSearchResults;
      let max = results.length;
      if (max === 0) return;
      if (direction === 'down') {
        this._cardSearchIndex = (this._cardSearchIndex + 1) % max;
      } else {
        this._cardSearchIndex = (this._cardSearchIndex - 1 + max) % max;
      }
      return;
    }
    let items = this.filteredSlashCommands;
    let max = items.length;
    if (max === 0) return;
    if (direction === 'down') {
      this._slashMenuIndex = (this._slashMenuIndex + 1) % max;
    } else {
      this._slashMenuIndex = (this._slashMenuIndex - 1 + max) % max;
    }
  };

  private _handleSlashSelect = (_index: number) => {
    if (this._formatPickerCardUrl) {
      // Enter in format picker defaults to block
      this._insertCardWithFormat('block');
      return;
    }
    if (this._cardSearchMode) {
      let results = this.cardSearchResults;
      let card = results[this._cardSearchIndex];
      if (card) {
        this._selectCardResult(card);
      }
      return;
    }
    let items = this.filteredSlashCommands;
    let item = items[this._slashMenuIndex];
    if (item) {
      this._selectSlashCommand(item);
    }
  };

  _selectSlashCommand = (cmd: SlashMenuItem) => {
    if (cmd.id === 'card') {
      // Delete the slash command text from the editor
      let view = this.editorView;
      let pm = this._pm;
      let state = this._slashState;
      if (view && pm && state) {
        let pluginKey = pm.slashCommandPluginKey;
        let tr = view.state.tr
          .delete(state.from, view.state.selection.from)
          .setMeta(pluginKey, null);
        view.dispatch(tr);
      }
      this._cardSearchMode = true;
      this._cardSearchText = '';
      this._cardSearchIndex = 0;
      // Focus the search input after render
      scheduleOnce('afterRender', this, this._focusSearchInput);
    }
  };

  private _focusSearchInput = () => {
    let input = document.querySelector('[data-test-card-search-input]') as HTMLInputElement;
    input?.focus();
  };

  // ── Card search ──────────────────────────────────────────────────────────

  private _searchResourceCreated = false;
  private _searchResource: { instances: CardDef[]; isLoading: boolean } | null = null;

  get cardSearchResults(): CardDef[] {
    if (!this._cardSearchMode) return [];
    if (!this._searchResourceCreated) {
      this._searchResourceCreated = true;
      try {
        let getCards = this.args.getCards;
        if (typeof getCards === 'function') {
          this._searchResource = getCards(
            this,
            () => {
              let text = this._cardSearchText?.trim();
              if (!text) return undefined;
              return {
                filter: { contains: { name: text } },
                page: { size: 10 },
              };
            },
          ) ?? null;
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

  _handleCardSearchKeydown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      this._dismissCardSearch();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this._handleSlashNavigate('down');
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      this._handleSlashNavigate('up');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      // Check if the input looks like a URL
      let text = this._cardSearchText.trim();
      if (text && (text.startsWith('http://') || text.startsWith('https://') || text.startsWith('./'))) {
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
    this._formatPickerCardTitle = card.title ?? labelFromUrl(card.id);
    this._cardSearchMode = false;
  };

  _dismissCardSearch = () => {
    this._cardSearchMode = false;
    this._cardSearchText = '';
    this._cardSearchIndex = 0;
    this._slashState = null;
    this._menuCoords = null;
    this.editorView?.focus();
  };

  // ── Card insertion ───────────────────────────────────────────────────────

  _insertCardWithFormat = (format: string) => {
    let cardUrl = this._formatPickerCardUrl;
    if (!cardUrl) return;

    let view = this.editorView;
    let pm = this._pm;
    if (!view || !pm) return;

    let baseUrl = this.args.cardReferenceBaseUrl;
    let ref = makeCardRef(cardUrl, baseUrl);

    if (format === 'inline') {
      let node = pm.schema.nodes.boxel_card_atom.create({
        cardId: ref,
        label: labelFromUrl(ref),
      });
      let { from } = view.state.selection;
      let tr = view.state.tr.insert(from, node);
      view.dispatch(tr);
    } else {
      let node = pm.schema.nodes.boxel_card_block.create({
        cardId: ref,
      });
      let { from } = view.state.selection;
      let $pos = view.state.doc.resolve(from);
      // Insert after the current block
      let insertPos = $pos.after($pos.depth);
      let tr = view.state.tr.insert(insertPos, node);
      view.dispatch(tr);
    }

    // Clean up all popup state
    this._formatPickerCardUrl = null;
    this._formatPickerCardTitle = null;
    this._cardSearchMode = false;
    this._cardSearchText = '';
    this._slashState = null;
    this._menuCoords = null;

    view.focus();

    // Trigger save immediately
    let onUpdate = this.args.onUpdate;
    if (onUpdate && pm) {
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
        this.saveTimer = null;
      }
      let markdown = pm.serializeMarkdown(view.state.doc);
      onUpdate(markdown);
    }
  };

  _dismissFormatPicker = () => {
    this._formatPickerCardUrl = null;
    this._formatPickerCardTitle = null;
    this._slashState = null;
    this._menuCoords = null;
    this.editorView?.focus();
  };

  // ── Card slot resolution ───────────────────────────────────────────────

  @cached
  get cardRenderTargets(): CardRenderTarget[] {
    let targets = this._nodeViewTargets;
    let linkedCards = this.args.linkedCards;
    let baseUrl = this.args.cardReferenceBaseUrl;

    let cardsByUrl = new Map<string, CardDef>();
    if (linkedCards?.length) {
      for (let card of linkedCards) {
        if (card?.id) {
          cardsByUrl.set(card.id, card);
        }
      }
    }

    return targets.map((target) => {
      let resolved = resolveUrl(target.cardId, baseUrl);
      return {
        ...target,
        card: cardsByUrl.get(resolved) ?? null,
      };
    });
  }

  private _handleTargetChange = (targets: CardNodeViewTarget[]) => {
    this._pendingTargets = targets;
    if (!this._slotUpdatePending) {
      this._slotUpdatePending = true;
      scheduleOnce('afterRender', this, this._applyTargets);
    }
  };

  _applyTargets = () => {
    this._slotUpdatePending = false;
    this._nodeViewTargets = this._pendingTargets;
  };

  getCardComponent = (card: BaseDef) => getComponent(card);

  // ── Editor lifecycle ───────────────────────────────────────────────────

  mountEditor = modifier(
    (element: HTMLElement, _positional: unknown[]) => {
      let pm = this._pm;
      if (!pm) {
        return;
      }

      let content = this.args.content;
      let onUpdate = this.args.onUpdate;

      // If editor already exists and content hasn't changed externally, keep it
      if (
        this.editorView &&
        element.contains(this.editorView.dom) &&
        content === this.lastExternalContent
      ) {
        return;
      }

      // External content changed — destroy old editor
      if (this.editorView && content !== this.lastExternalContent) {
        this.editorView.destroy();
        this.editorView = null;
      }

      this.lastExternalContent = content;

      // Clear element before creating editor
      element.innerHTML = '';

      let doc = pm.parseMarkdown(content || '');

      let {
        schema,
        keymap: keymapPlugin,
        baseKeymap,
        history,
        undo,
        redo,
        toggleMark,
        splitListItem,
        liftListItem,
        sinkListItem,
      } = pm;

      let formatKeymap = {
        'Mod-b': toggleMark(schema.marks.strong),
        'Mod-i': toggleMark(schema.marks.em),
        'Mod-`': toggleMark(schema.marks.code),
        'Mod-z': undo,
        'Shift-Mod-z': redo,
      };

      let listKeymap = {
        Enter: splitListItem(schema.nodes.list_item),
        Tab: sinkListItem(schema.nodes.list_item),
        'Shift-Tab': liftListItem(schema.nodes.list_item),
      };

      let slashPlugin = pm.createSlashCommandPlugin(
        this._handleSlashStateChange,
        this._handleSlashSelect,
        this._handleSlashNavigate,
      );

      let state = pm.EditorState.create({
        doc,
        plugins: [
          slashPlugin,
          keymapPlugin(formatKeymap),
          keymapPlugin(listKeymap),
          keymapPlugin(baseKeymap),
          history(),
        ],
      });

      let nodeViews = pm.createCardNodeViews(this._handleTargetChange);

      let view = new pm.EditorView(element, {
        state,
        nodeViews,
        dispatchTransaction: (tr: any) => {
          let newState = view.state.apply(tr);
          view.updateState(newState);

          if (tr.docChanged && onUpdate) {
            // Debounced save
            if (this.saveTimer) {
              clearTimeout(this.saveTimer);
            }
            this.saveTimer = setTimeout(() => {
              this.saveTimer = null;
              let markdown = pm!.serializeMarkdown(view.state.doc);
              onUpdate(markdown);
            }, SAVE_DEBOUNCE_MS);
          }
        },
      });

      this.editorView = view;

      return () => {
        if (this.saveTimer) {
          clearTimeout(this.saveTimer);
          this.saveTimer = null;
        }
        if (this.editorView) {
          this.editorView.destroy();
          this.editorView = null;
        }
      };
    },
  );

  // ── Block-level commands (exposed for future toolbar use) ──

  setHeading = (level: number) => {
    let pm = this._pm;
    let view = this.editorView;
    if (!pm || !view) return;
    pm.setBlockType(pm.schema.nodes.heading, { level })(
      view.state,
      view.dispatch,
    );
    view.focus();
  };

  setParagraph = () => {
    let pm = this._pm;
    let view = this.editorView;
    if (!pm || !view) return;
    pm.setBlockType(pm.schema.nodes.paragraph)(view.state, view.dispatch);
    view.focus();
  };

  toggleBulletList = () => {
    let pm = this._pm;
    let view = this.editorView;
    if (!pm || !view) return;
    pm.wrapInList(pm.schema.nodes.bullet_list)(view.state, view.dispatch);
    view.focus();
  };

  toggleOrderedList = () => {
    let pm = this._pm;
    let view = this.editorView;
    if (!pm || !view) return;
    pm.wrapInList(pm.schema.nodes.ordered_list)(view.state, view.dispatch);
    view.focus();
  };

  toggleBlockquote = () => {
    let pm = this._pm;
    let view = this.editorView;
    if (!pm || !view) return;
    pm.wrapIn(pm.schema.nodes.blockquote)(view.state, view.dispatch);
    view.focus();
  };

  insertHorizontalRule = () => {
    let pm = this._pm;
    let view = this.editorView;
    if (!pm || !view) return;
    let { tr } = view.state;
    view.dispatch(
      tr.replaceSelectionWith(pm.schema.nodes.horizontal_rule.create()),
    );
    view.focus();
  };

  liftBlock = () => {
    let pm = this._pm;
    let view = this.editorView;
    if (!pm || !view) return;
    pm.lift(view.state, view.dispatch);
    view.focus();
  };

  <template>
    {{#if this.pm}}
      <div
        class='prosemirror-editor'
        data-test-prosemirror-editor
        {{this.mountEditor this.pm this.args.content this.args.onUpdate}}
        ...attributes
      >
      </div>

      {{! ── Slash command menu ── }}
      {{#if this.slashMenuActive}}
        <div
          class='prosemirror-slash-menu'
          style={{this.slashMenuStyle}}
          data-test-slash-menu
        >
          {{#each this.filteredSlashCommands as |cmd index|}}
            <button
              class='prosemirror-slash-menu-item
                {{if (eq index this._slashMenuIndex) "selected"}}'
              data-test-slash-menu-item={{cmd.id}}
              {{on 'mousedown' (fn this._selectSlashCommand cmd)}}
            >
              <span class='slash-menu-label'>{{cmd.label}}</span>
              <span class='slash-menu-description'>{{cmd.description}}</span>
            </button>
          {{else}}
            <div class='prosemirror-slash-menu-empty'>No matching commands</div>
          {{/each}}
        </div>
      {{/if}}

      {{! ── Card search popup ── }}
      {{#if this._cardSearchMode}}
        <div
          class='prosemirror-card-search'
          style={{this.slashMenuStyle}}
          data-test-card-search
        >
          <input
            class='prosemirror-card-search-input'
            placeholder='Search cards or paste URL…'
            value={{this._cardSearchText}}
            data-test-card-search-input
            {{on 'input' this._handleCardSearchInput}}
            {{on 'keydown' this._handleCardSearchKeydown}}
          />
          {{#if this.isSearchLoading}}
            <div class='prosemirror-card-search-loading'>Searching…</div>
          {{/if}}
          {{#if this.cardSearchResults.length}}
            <div class='prosemirror-card-search-results' data-test-card-search-results>
              {{#each this.cardSearchResults as |card index|}}
                <button
                  class='prosemirror-card-search-result
                    {{if (eq index this._cardSearchIndex) "selected"}}'
                  data-test-card-search-result
                  {{on 'mousedown' (fn this._selectCardResult card)}}
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
      {{#if this._formatPickerCardUrl}}
        <div
          class='prosemirror-format-picker'
          style={{this.slashMenuStyle}}
          data-test-format-picker
        >
          <span class='format-picker-label'>
            Insert "{{this._formatPickerCardTitle}}" as:
          </span>
          <div class='format-picker-buttons'>
            <button
              class='format-picker-btn'
              data-test-format-inline
              {{on 'mousedown' (fn this._insertCardWithFormat 'inline')}}
            >
              Inline
            </button>
            <button
              class='format-picker-btn format-picker-btn--primary'
              data-test-format-block
              {{on 'mousedown' (fn this._insertCardWithFormat 'block')}}
            >
              Block
            </button>
          </div>
          <button
            class='format-picker-dismiss'
            data-test-format-picker-dismiss
            {{on 'mousedown' this._dismissFormatPicker}}
          >
            Cancel
          </button>
        </div>
      {{/if}}

      {{#each this.cardRenderTargets as |target|}}
        {{#in-element target.element insertBefore=null}}
          {{#if target.card}}
            <CardContextConsumer as |context|>
              {{#let (this.getCardComponent target.card) as |CardComponent|}}
                {{#if (isInline target.kind)}}
                  <span
                    class='prosemirror-card-slot prosemirror-card-slot--inline'
                    data-test-prosemirror-card-slot-inline
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
                    class='prosemirror-card-slot prosemirror-card-slot--block'
                    data-test-prosemirror-card-slot-block
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
            <span class='prosemirror-card-fallback'>{{target.cardId}}</span>
          {{/if}}
        {{/in-element}}
      {{/each}}
    {{else}}
      <div class='prosemirror-editor-loading' data-test-prosemirror-loading>
        Loading editor…
      </div>
    {{/if}}
    <style scoped>
      @layer baseComponent {
        .prosemirror-editor {
          min-height: 120px;
          padding: var(--boxel-sp-xs);
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          cursor: text;
          position: relative;
        }

        .prosemirror-editor :deep(.ProseMirror) {
          outline: none;
          min-height: 100px;
          font-family: inherit;
          font-size: inherit;
          line-height: 1.6;
        }

        .prosemirror-editor :deep(.ProseMirror p) {
          margin-top: var(--boxel-sp-xs, 4px);
          margin-bottom: var(--boxel-sp-xs, 4px);
        }

        .prosemirror-editor :deep(.ProseMirror h1),
        .prosemirror-editor :deep(.ProseMirror h2),
        .prosemirror-editor :deep(.ProseMirror h3),
        .prosemirror-editor :deep(.ProseMirror h4),
        .prosemirror-editor :deep(.ProseMirror h5),
        .prosemirror-editor :deep(.ProseMirror h6) {
          font-weight: 600;
        }

        .prosemirror-editor :deep(.ProseMirror blockquote) {
          border-left: 3px solid var(--boxel-border-color, #c4c4c4);
          padding-left: var(--boxel-sp, 16px);
          margin-left: 0;
          margin-right: 0;
          color: var(--boxel-400, #666);
        }

        .prosemirror-editor :deep(.ProseMirror pre) {
          background-color: var(--boxel-100, #f5f5f5);
          padding: var(--boxel-sp-sm, 8px);
          border-radius: var(--boxel-border-radius, 4px);
          font-family: var(--boxel-monospace-font-family, monospace);
          overflow-x: auto;
        }

        .prosemirror-editor :deep(.ProseMirror code) {
          background-color: var(--boxel-100, #f5f5f5);
          padding: 0.1em 0.3em;
          border-radius: 3px;
          font-family: var(--boxel-monospace-font-family, monospace);
          font-size: 0.9em;
        }

        .prosemirror-editor :deep(.ProseMirror ul),
        .prosemirror-editor :deep(.ProseMirror ol) {
          padding-left: 1.375em;
        }

        .prosemirror-editor :deep(.ProseMirror hr) {
          border: none;
          border-top: 1px solid var(--boxel-border-color, #c4c4c4);
          margin: var(--boxel-sp, 16px) 0;
        }

        /* Card node placeholders (fallback when nodeViews are not active) */
        .prosemirror-editor :deep(.boxel-card-atom) {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          background-color: var(--boxel-100, #f0f0f0);
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          padding: 1px 6px;
          font-size: 0.85em;
          cursor: default;
        }

        .prosemirror-editor :deep(.boxel-card-block) {
          display: block;
          background-color: var(--boxel-100, #f0f0f0);
          border: 1px dashed var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          padding: var(--boxel-sp-sm, 8px);
          margin: var(--boxel-sp-xs, 4px) 0;
          cursor: default;
        }

        .prosemirror-editor :deep(.card-block-id) {
          font-size: 0.85em;
          color: var(--boxel-400, #666);
          word-break: break-all;
        }

        /* NodeView card containers */
        .prosemirror-editor :deep(.boxel-card-atom-view) {
          display: inline;
          user-select: none;
        }

        .prosemirror-editor :deep(.boxel-card-block-view) {
          display: block;
          margin: var(--boxel-sp-xs, 4px) 0;
          user-select: none;
        }

        /* Card slot wrappers rendered via {{in-element}} */
        .prosemirror-editor :deep(.prosemirror-card-slot) {
          contain: layout style paint;
        }

        .prosemirror-editor :deep(.prosemirror-card-slot--inline) {
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

        .prosemirror-editor :deep(.prosemirror-card-slot--block) {
          display: block;
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          overflow: hidden;
        }

        /* Selection highlight for atom nodes */
        .prosemirror-editor :deep(.boxel-card-atom-view.ProseMirror-selectednode),
        .prosemirror-editor :deep(.boxel-card-block-view.ProseMirror-selectednode) {
          outline: 2px solid var(--boxel-highlight, #0078d4);
          border-radius: var(--boxel-border-radius, 4px);
        }

        /* Fallback for unresolved card references */
        .prosemirror-editor :deep(.prosemirror-card-fallback) {
          display: inline-block;
          padding: 1px 6px;
          background-color: var(--boxel-100, #f0f0f0);
          border: 1px dashed var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          font-size: 0.85em;
          color: var(--boxel-400, #666);
          word-break: break-all;
        }

        .prosemirror-editor-loading {
          min-height: 120px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--boxel-400, #999);
          font-style: italic;
        }

        /* ── Slash command menu ── */
        .prosemirror-slash-menu {
          position: absolute;
          z-index: 100;
          background: var(--boxel-light, #fff);
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          box-shadow: 0 4px 12px rgb(0 0 0 / 0.15);
          min-width: 200px;
          max-width: 300px;
          padding: 4px;
        }

        .prosemirror-slash-menu-item {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          width: 100%;
          padding: 8px 12px;
          border: none;
          background: transparent;
          cursor: pointer;
          border-radius: var(--boxel-border-radius, 4px);
          text-align: left;
          font: inherit;
        }

        .prosemirror-slash-menu-item:hover,
        .prosemirror-slash-menu-item.selected {
          background: var(--boxel-highlight-hover, #e8f0fe);
        }

        .slash-menu-label {
          font-weight: 600;
          font-size: 0.9em;
        }

        .slash-menu-description {
          font-size: 0.8em;
          color: var(--boxel-400, #666);
        }

        .prosemirror-slash-menu-empty {
          padding: 8px 12px;
          color: var(--boxel-400, #666);
          font-size: 0.85em;
          font-style: italic;
        }

        /* ── Card search popup ── */
        .prosemirror-card-search {
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

        .prosemirror-card-search-input {
          width: 100%;
          padding: 6px 10px;
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          font: inherit;
          font-size: 0.9em;
          outline: none;
          box-sizing: border-box;
        }

        .prosemirror-card-search-input:focus {
          border-color: var(--boxel-highlight, #0078d4);
          box-shadow: 0 0 0 1px var(--boxel-highlight, #0078d4);
        }

        .prosemirror-card-search-loading {
          padding: 8px 4px;
          color: var(--boxel-400, #666);
          font-size: 0.85em;
          font-style: italic;
        }

        .prosemirror-card-search-results {
          margin-top: 4px;
          max-height: 240px;
          overflow-y: auto;
        }

        .prosemirror-card-search-result {
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

        .prosemirror-card-search-result:hover,
        .prosemirror-card-search-result.selected {
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
        .prosemirror-format-picker {
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
