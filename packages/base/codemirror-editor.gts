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

interface CodeMirrorContext {
  EditorState: any;
  EditorView: any;
  createEditorState: (options: {
    content: string;
    onDocChange: (text: string) => void;
    onCardTargetsChange: (targets: CardWidgetTarget[]) => void;
    onOpenCardSearch: (pos: { from: number; to: number }) => void;
  }) => any;
  undo: any;
  redo: any;
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

function makeCardRef(
  cardUrl: string,
  baseUrl: string | null | undefined,
): string {
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

interface CodeMirrorEditorSignature {
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

  private editorView: any = null;
  private lastExternalContent: string | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _pendingTargets: CardWidgetTarget[] = [];
  private _slotUpdatePending = false;

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

  private _handleOpenCardSearch = (pos: { from: number; to: number }) => {
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
    let input = document.querySelector(
      '[data-test-card-search-input]',
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

  _handleCardSearchKeydown = (event: KeyboardEvent) => {
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
    this._formatPickerCardTitle = card.title ?? labelFromUrl(card.id);
    this._cardSearchMode = false;
  };

  _dismissCardSearch = () => {
    this._cardSearchMode = false;
    this._cardSearchText = '';
    this._cardSearchIndex = 0;
    this._menuCoords = null;
    this.editorView?.focus();
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

  // ── Card slot resolution ─────────────────────────────────────────────────

  @cached
  get cardRenderTargets(): CardRenderTarget[] {
    let targets = this._widgetTargets;
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

  private _handleTargetChange = (targets: CardWidgetTarget[]) => {
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

  mountEditor = modifier((element: HTMLElement, _positional: unknown[]) => {
    let cm = this._cm;
    if (!cm) {
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

    let state = cm.createEditorState({
      content: content || '',
      onDocChange: (text: string) => {
        // Keep lastExternalContent in sync so the modifier doesn't
        // treat the debounced save echo as an external content change
        // (which would destroy and recreate the editor, losing focus).
        this.lastExternalContent = text;
        if (onUpdate) {
          // Debounced save
          if (this.saveTimer) {
            clearTimeout(this.saveTimer);
          }
          this.saveTimer = setTimeout(() => {
            this.saveTimer = null;
            onUpdate(text);
          }, SAVE_DEBOUNCE_MS);
        }
      },
      onCardTargetsChange: this._handleTargetChange,
      onOpenCardSearch: this._handleOpenCardSearch,
    });

    let view = new cm.EditorView({
      state,
      parent: element,
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
  });

  <template>
    {{#if this.cm}}
      <div
        class='codemirror-editor'
        data-test-codemirror-editor
        {{this.mountEditor this.cm this.args.content this.args.onUpdate}}
        ...attributes
      >
      </div>

      {{! ── Card search popup ── }}
      {{#if this._cardSearchMode}}
        <div
          class='codemirror-card-search'
          style={{this.menuStyle}}
          data-test-card-search
        >
          <input
            class='codemirror-card-search-input'
            placeholder='Search cards or paste URL…'
            value={{this._cardSearchText}}
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
    {{else}}
      <div class='codemirror-editor-loading' data-test-codemirror-loading>
        Loading editor…
      </div>
    {{/if}}
    <style scoped>
      @layer baseComponent {
        .codemirror-editor {
          min-height: 120px;
          padding: var(--boxel-sp-xs);
          border: 1px solid var(--boxel-border-color, #c4c4c4);
          border-radius: var(--boxel-border-radius, 4px);
          cursor: text;
          position: relative;
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

        /* BFM card reference syntax styling */
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

        /* Hide source syntax when block card widget is shown */
        .codemirror-editor :deep(.cm-bfm-card-ref--hidden) {
          font-size: 0;
          padding: 0;
          opacity: 0;
          height: 0;
          overflow: hidden;
        }

        /* Highlight source syntax when cursor is on the block card line */
        .codemirror-editor :deep(.cm-bfm-card-ref--active) {
          background-color: var(--boxel-highlight-hover, #e8f0fe);
        }

        /* Card widget containers */
        .codemirror-editor :deep(.cm-card-widget) {
          user-select: none;
        }

        .codemirror-editor :deep(.cm-card-widget--inline) {
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

        .codemirror-editor :deep(.cm-card-widget--block) {
          display: block;
          margin: var(--boxel-sp-xs, 4px) 0;
        }

        /* Card slot wrappers rendered via{{in-element}}*/
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
