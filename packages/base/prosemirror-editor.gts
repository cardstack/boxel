import { task } from 'ember-concurrency';
import GlimmerComponent from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

// The ProseMirrorContext type is defined in the host app's lazy-loaded module.
// We only use it as a type here — the actual module is loaded at runtime via
// globalThis.__loadProseMirror.
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
}

const SAVE_DEBOUNCE_MS = 500;

interface ProseMirrorEditorSignature {
  Args: {
    content: string | null;
    onUpdate: (markdown: string) => void;
  };
  Element: HTMLDivElement;
}

export default class ProseMirrorEditor extends GlimmerComponent<ProseMirrorEditorSignature> {
  @tracked _pm: ProseMirrorContext | null = null;

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

      let view = new pm.EditorView(element, {
        state,
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

        /* Card node placeholders */
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
