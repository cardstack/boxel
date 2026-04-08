import { task } from 'ember-concurrency';
import GlimmerComponent from '@glimmer/component';
import { cached, tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import { scheduleOnce } from '@ember/runloop';

import {
  resolveCardReference,
  trimJsonExtension,
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
}

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

interface ProseMirrorEditorSignature {
  Args: {
    content: string | null;
    onUpdate: (markdown: string) => void;
    linkedCards?: CardDef[] | null;
    cardReferenceBaseUrl?: string | null;
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

      let state = pm.EditorState.create({
        doc,
        plugins: [
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
      }
    </style>
  </template>
}
