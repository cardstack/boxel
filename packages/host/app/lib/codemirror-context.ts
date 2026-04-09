/**
 * CodeMirror 6 context module -- lazy-loaded via globalThis.__loadCodeMirror.
 *
 * This module is the single dynamic-import entry point for CodeMirror.
 * Webpack will code-split it (and all its transitive deps) into a separate
 * chunk automatically. The base package's CodeMirrorEditor component
 * consumes the exported context object.
 *
 * Unlike ProseMirror, CodeMirror edits markdown source text directly --
 * there is no intermediate document model, no parse/serialize layer.
 * Card previews are achieved through CM6's decoration/widget system.
 */

import {
  autocompletion,
  type CompletionContext,
  type CompletionResult,
} from '@codemirror/autocomplete';
import {
  defaultKeymap,
  history,
  historyKeymap,
  undo,
  redo,
} from '@codemirror/commands';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxTree } from '@codemirror/language';
import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import {
  EditorView,
  Decoration,
  type DecorationSet,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  keymap,
} from '@codemirror/view';

// ── Card widget target interface ────────────────────────────────────────────

export interface CardWidgetTarget {
  element: HTMLElement;
  cardId: string;
  format: 'atom' | 'embedded';
  kind: 'inline' | 'block';
}

// ── State effect for opening card search ────────────────────────────────────

export const openCardSearchEffect = StateEffect.define<{
  from: number;
  to: number;
}>();

// ── Card reference patterns ─────────────────────────────────────────────────

// Block: ::card[URL] or ::card[URL | size-spec], must be the only content on a line
// Use [ \t]* instead of \s* to avoid matching newline characters
const BLOCK_CARD_RE = /^::card\[([^\]\n]+)\][ \t]*$/gm;
// Inline: :card[URL], not preceded by another colon (avoids matching ::card)
const INLINE_CARD_RE = /(?<!:):card\[([^\]\n]+)\]/g;

// ── CardWidget (extends WidgetType) ─────────────────────────────────────────

class CardWidget extends WidgetType {
  constructor(
    readonly cardId: string,
    readonly kind: 'inline' | 'block',
  ) {
    super();
  }

  eq(other: CardWidget) {
    return this.cardId === other.cardId && this.kind === other.kind;
  }

  toDOM(): HTMLElement {
    let tag = this.kind === 'inline' ? 'span' : 'div';
    let el = document.createElement(tag);
    el.setAttribute('data-card-id', this.cardId);
    el.setAttribute('data-card-kind', this.kind);
    el.className = `cm-card-widget cm-card-widget--${this.kind}`;
    el.contentEditable = 'false';
    return el;
  }

  ignoreEvent() {
    return true;
  }
}

// ── Check if a position is inside a code block or inline code ───────────────

function isInsideCode(state: EditorState, from: number, to: number): boolean {
  let tree = syntaxTree(state);
  let inside = false;
  tree.iterate({
    from,
    to,
    enter(node) {
      if (
        node.name === 'FencedCode' ||
        node.name === 'CodeBlock' ||
        node.name === 'InlineCode' ||
        node.name === 'CodeText'
      ) {
        inside = true;
        return false; // stop descending
      }
    },
  });
  return inside;
}

// ── Build card decorations from document text ───────────────────────────────

function buildCardDecorations(
  view: EditorView,
  cursorLine: number,
): { decorations: DecorationSet; targets: CardWidgetTarget[] } {
  let widgets: { from: number; to: number; widget: CardWidget }[] = [];
  let marks: { from: number; to: number; className: string }[] = [];
  let targets: CardWidgetTarget[] = [];

  let doc = view.state.doc;
  let text = doc.toString();

  // Block cards: ::card[URL]
  BLOCK_CARD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_CARD_RE.exec(text)) !== null) {
    let from = match.index;
    let to = from + match[0].length;
    if (isInsideCode(view.state, from, to)) continue;

    let cardId = match[1].trim();
    let pipeIdx = cardId.indexOf('|');
    if (pipeIdx >= 0) {
      cardId = cardId.substring(0, pipeIdx).trim();
    }

    let line = doc.lineAt(from);

    // Mark the source syntax (dimmed when widget is shown, highlighted on cursor line)
    marks.push({
      from,
      to,
      className:
        line.number === cursorLine
          ? 'cm-bfm-card-ref cm-bfm-card-ref--block cm-bfm-card-ref--active'
          : 'cm-bfm-card-ref cm-bfm-card-ref--block cm-bfm-card-ref--hidden',
    });

    // Show widget preview below the line (not when cursor is on it)
    if (line.number !== cursorLine) {
      let widget = new CardWidget(cardId, 'block');
      // Place widget at end of line (side: 1 = after)
      widgets.push({ from: to, to, widget });
    }
  }

  // Inline cards: :card[URL]
  INLINE_CARD_RE.lastIndex = 0;
  while ((match = INLINE_CARD_RE.exec(text)) !== null) {
    let from = match.index;
    let to = from + match[0].length;
    if (isInsideCode(view.state, from, to)) continue;

    let cardId = match[1].trim();

    // Mark the source syntax as dimmed
    marks.push({
      from,
      to,
      className: 'cm-bfm-card-ref cm-bfm-card-ref--inline',
    });

    // Add widget after the syntax
    let widget = new CardWidget(cardId, 'inline');
    widgets.push({ from: to, to, widget });
  }

  // Build decoration set (must be sorted by position)
  let allDecorations: { from: number; to: number; value: Decoration }[] = [];

  for (let m of marks) {
    // CM6 plugins cannot provide mark decorations that span line breaks
    let slice = doc.sliceString(m.from, m.to);
    if (slice.includes('\n')) continue;

    allDecorations.push({
      from: m.from,
      to: m.to,
      value: Decoration.mark({ class: m.className }),
    });
  }

  for (let w of widgets) {
    // All widgets are inline point decorations — block styling is via CSS.
    // CM6 disallows block widget decorations from plugins.
    allDecorations.push({
      from: w.from,
      to: w.to,
      value: Decoration.widget({
        widget: w.widget,
        side: 1,
      }),
    });
  }

  // Sort by from position, then by to position
  allDecorations.sort((a, b) => a.from - b.from || a.to - b.to);

  let decoSet = Decoration.set(
    allDecorations.map((d) => d.value.range(d.from, d.to)),
  );

  // Collect targets from widgets that will be rendered
  for (let w of widgets) {
    targets.push({
      element: null as unknown as HTMLElement, // filled in after DOM render
      cardId: w.widget.cardId,
      format: w.widget.kind === 'inline' ? 'atom' : 'embedded',
      kind: w.widget.kind,
    });
  }

  return { decorations: decoSet, targets };
}

// ── Card decoration ViewPlugin ──────────────────────────────────────────────

function createCardDecorationPlugin(
  onChange: (targets: CardWidgetTarget[]) => void,
): ViewPlugin<{
  decorations: DecorationSet;
}> {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;

      constructor(view: EditorView) {
        let cursorLine = view.state.doc.lineAt(
          view.state.selection.main.head,
        ).number;
        let result = buildCardDecorations(view, cursorLine);
        this.decorations = result.decorations;
        this.notifyTargets(view);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged
        ) {
          let cursorLine = update.state.doc.lineAt(
            update.state.selection.main.head,
          ).number;
          let result = buildCardDecorations(update.view, cursorLine);
          this.decorations = result.decorations;
          this.notifyTargets(update.view);
        }
      }

      notifyTargets(view: EditorView) {
        // After the decorations are applied, collect actual DOM elements from widgets
        // We use requestAnimationFrame to ensure DOM is updated
        requestAnimationFrame(() => {
          let targets: CardWidgetTarget[] = [];
          let editorDom = view.dom;
          let widgetElements = editorDom.querySelectorAll('.cm-card-widget');
          for (let el of widgetElements) {
            let cardId = el.getAttribute('data-card-id');
            let kind = el.getAttribute('data-card-kind') as 'inline' | 'block';
            if (cardId) {
              targets.push({
                element: el as HTMLElement,
                cardId,
                format: kind === 'inline' ? 'atom' : 'embedded',
                kind,
              });
            }
          }
          onChange(targets);
        });
      }
    },
    {
      decorations: (v) => v.decorations,
    },
  );
}

// ── Slash command autocompletion ─────────────────────────────────────────────

function createSlashCommandSource(
  onOpenCardSearch: (pos: { from: number; to: number }) => void,
): (context: CompletionContext) => CompletionResult | null {
  return function slashCommandSource(
    context: CompletionContext,
  ): CompletionResult | null {
    let match = context.matchBefore(/\/\w*/);
    if (!match) return null;
    if (match.from === match.to && !context.explicit) return null;

    // Only trigger at start of line or after whitespace
    let line = context.state.doc.lineAt(match.from);
    if (match.from > line.from) {
      let charBefore = context.state.sliceDoc(match.from - 1, match.from);
      if (!/\s/.test(charBefore)) return null;
    }

    return {
      from: match.from,
      options: [
        {
          label: '/card',
          detail: 'Insert a card reference',
          type: 'keyword',
          apply: (
            view: EditorView,
            _completion: unknown,
            from: number,
            to: number,
          ) => {
            // Delete the slash command text
            view.dispatch({ changes: { from, to, insert: '' } });
            // Signal the Glimmer component to open card search
            onOpenCardSearch({ from, to });
          },
        },
      ],
    };
  };
}

// ── Markdown formatting helpers ─────────────────────────────────────────────

function wrapWith(marker: string) {
  return (view: EditorView): boolean => {
    let { from, to } = view.state.selection.main;
    if (from === to) return false; // no selection
    let selected = view.state.sliceDoc(from, to);

    // Toggle: if already wrapped, unwrap
    if (
      selected.startsWith(marker) &&
      selected.endsWith(marker) &&
      selected.length >= marker.length * 2
    ) {
      view.dispatch({
        changes: {
          from,
          to,
          insert: selected.slice(marker.length, -marker.length),
        },
      });
    } else {
      view.dispatch({
        changes: { from, to, insert: marker + selected + marker },
        selection: {
          anchor: from + marker.length,
          head: to + marker.length,
        },
      });
    }
    return true;
  };
}

const markdownKeymap = keymap.of([
  { key: 'Mod-b', run: wrapWith('**') },
  { key: 'Mod-i', run: wrapWith('*') },
  { key: 'Mod-`', run: wrapWith('`') },
]);

// ── createEditorState factory ───────────────────────────────────────────────

export interface CreateEditorStateOptions {
  content: string;
  onDocChange: (text: string) => void;
  onCardTargetsChange: (targets: CardWidgetTarget[]) => void;
  onOpenCardSearch: (pos: { from: number; to: number }) => void;
}

function createEditorState(options: CreateEditorStateOptions): EditorState {
  let { content, onDocChange, onCardTargetsChange, onOpenCardSearch } = options;

  let cardPlugin = createCardDecorationPlugin(onCardTargetsChange);
  let slashSource = createSlashCommandSource(onOpenCardSearch);

  let extensions: Extension[] = [
    markdown({ base: markdownLanguage }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdownKeymap,
    cardPlugin,
    autocompletion({
      override: [slashSource],
      defaultKeymap: true,
    }),
    EditorView.updateListener.of((update: ViewUpdate) => {
      if (update.docChanged) {
        onDocChange(update.state.doc.toString());
      }
    }),
    EditorView.lineWrapping,
  ];

  return EditorState.create({
    doc: content,
    extensions,
  });
}

// ── Exported context ────────────────────────────────────────────────────────

export interface CodeMirrorContext {
  EditorState: typeof EditorState;
  EditorView: typeof EditorView;
  createEditorState: typeof createEditorState;
  undo: typeof undo;
  redo: typeof redo;
  openCardSearchEffect: typeof openCardSearchEffect;
}

const codemirrorContext: CodeMirrorContext = {
  EditorState,
  EditorView,
  createEditorState,
  undo,
  redo,
  openCardSearchEffect,
};

export default codemirrorContext;
