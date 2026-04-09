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
 * Obsidian-style live preview is achieved by using the Lezer markdown
 * syntax tree to apply decorations that render formatting inline and
 * reveal raw syntax only when the cursor is on the relevant line.
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
import {
  EditorState,
  StateEffect,
  StateField,
  type Extension,
} from '@codemirror/state';
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

// ── Decoration range type ──────────────────────────────────────────────────

interface DecoRange {
  from: number;
  to: number;
  value: Decoration;
}

// ── Card reference patterns ─────────────────────────────────────────────────

// Block: ::card[URL] or ::card[URL | size-spec], must be the only content on a line
const BLOCK_CARD_RE = /^::card\[([^\]\n]+)\][ \t]*$/gm;
// Inline: :card[URL], not preceded by another colon (avoids matching ::card)
const INLINE_CARD_RE = /(?<!:):card\[([^\]\n]+)\]/g;

// ── Cursor-aware helpers ───────────────────────────────────────────────────

function isOnCursorLine(
  state: EditorState,
  pos: number,
  cursorLine: number,
): boolean {
  return state.doc.lineAt(pos).number === cursorLine;
}

function cursorInRange(
  state: EditorState,
  from: number,
  to: number,
  cursorLine: number,
): boolean {
  let startLine = state.doc.lineAt(from).number;
  let endLine = state.doc.lineAt(Math.min(to, state.doc.length)).number;
  return cursorLine >= startLine && cursorLine <= endLine;
}

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

// ── HorizontalRuleWidget ───────────────────────────────────────────────────

class HorizontalRuleWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM(): HTMLElement {
    let el = document.createElement('hr');
    el.className = 'cm-md-hr-widget';
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
        return false;
      }
    },
  });
  return inside;
}

// ── Heading decorations ────────────────────────────────────────────────────

function buildHeadingDecorations(
  state: EditorState,
  cursorLine: number,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      let level = 0;
      if (node.name === 'ATXHeading1') level = 1;
      else if (node.name === 'ATXHeading2') level = 2;
      else if (node.name === 'ATXHeading3') level = 3;
      else if (node.name === 'ATXHeading4') level = 4;
      else if (node.name === 'ATXHeading5') level = 5;
      else if (node.name === 'ATXHeading6') level = 6;
      else if (node.name === 'SetextHeading1') level = 1;
      else if (node.name === 'SetextHeading2') level = 2;

      if (level === 0) return;

      let line = state.doc.lineAt(node.from);
      let onCursor = cursorInRange(state, node.from, node.to, cursorLine);

      // Line decoration for heading size
      decos.push({
        from: line.from,
        to: line.from,
        value: Decoration.line({ class: `cm-md-h${level}` }),
      });

      // Find and style HeaderMark children (the # characters)
      let inner = node.node;
      let cursor = inner.cursor();
      if (cursor.firstChild()) {
        do {
          if (cursor.name === 'HeaderMark') {
            decos.push({
              from: cursor.from,
              to: cursor.to,
              value: onCursor
                ? Decoration.mark({ class: 'cm-md-marker' })
                : Decoration.mark({ class: 'cm-md-marker cm-md-marker--dim' }),
            });
          }
        } while (cursor.nextSibling());
      }
    },
  });

  return decos;
}

// ── Inline formatting decorations ──────────────────────────────────────────

function buildInlineFormattingDecorations(
  state: EditorState,
  cursorLine: number,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (
        node.name !== 'StrongEmphasis' &&
        node.name !== 'Emphasis' &&
        node.name !== 'InlineCode'
      ) {
        return;
      }

      let onCursor = isOnCursorLine(state, node.from, cursorLine);

      if (node.name === 'InlineCode') {
        // Find CodeMark children (backticks)
        let inner = node.node;
        let marks: { from: number; to: number }[] = [];
        let c = inner.cursor();
        if (c.firstChild()) {
          do {
            if (c.name === 'CodeMark') {
              marks.push({ from: c.from, to: c.to });
            }
          } while (c.nextSibling());
        }

        // Style the content (between first and last mark)
        if (marks.length >= 2) {
          let contentFrom = marks[0].to;
          let contentTo = marks[marks.length - 1].from;
          if (contentFrom < contentTo) {
            decos.push({
              from: contentFrom,
              to: contentTo,
              value: Decoration.mark({ class: 'cm-md-inline-code' }),
            });
          }

          // Hide or dim backtick marks
          for (let m of marks) {
            decos.push({
              from: m.from,
              to: m.to,
              value: onCursor
                ? Decoration.mark({ class: 'cm-md-marker' })
                : Decoration.mark({
                    class: 'cm-md-marker cm-md-marker--hidden',
                  }),
            });
          }
        }
        return false; // don't descend
      }

      // StrongEmphasis or Emphasis
      let cssClass =
        node.name === 'StrongEmphasis' ? 'cm-md-bold' : 'cm-md-italic';
      let inner = node.node;
      let marks: { from: number; to: number }[] = [];
      let c = inner.cursor();
      if (c.firstChild()) {
        do {
          if (c.name === 'EmphasisMark') {
            marks.push({ from: c.from, to: c.to });
          }
        } while (c.nextSibling());
      }

      if (marks.length >= 2) {
        let contentFrom = marks[0].to;
        let contentTo = marks[marks.length - 1].from;
        if (contentFrom < contentTo) {
          decos.push({
            from: contentFrom,
            to: contentTo,
            value: Decoration.mark({ class: cssClass }),
          });
        }

        // Hide or dim emphasis marks
        for (let m of marks) {
          decos.push({
            from: m.from,
            to: m.to,
            value: onCursor
              ? Decoration.mark({ class: 'cm-md-marker' })
              : Decoration.mark({
                  class: 'cm-md-marker cm-md-marker--hidden',
                }),
          });
        }
      }
    },
  });

  return decos;
}

// ── Block decorations (code blocks, blockquotes, horizontal rules) ─────────

function buildBlockDecorations(
  state: EditorState,
  cursorLine: number,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      // ── Fenced code blocks ──
      if (node.name === 'FencedCode') {
        let onCursor = cursorInRange(state, node.from, node.to, cursorLine);

        // Line decoration on every line in the code block
        let startLine = state.doc.lineAt(node.from).number;
        let endLine = state.doc.lineAt(
          Math.min(node.to, state.doc.length),
        ).number;
        for (let i = startLine; i <= endLine; i++) {
          let line = state.doc.line(i);
          decos.push({
            from: line.from,
            to: line.from,
            value: Decoration.line({ class: 'cm-md-code-line' }),
          });
        }

        // Style fence markers and code info
        let inner = node.node;
        let c = inner.cursor();
        if (c.firstChild()) {
          do {
            if (c.name === 'CodeMark') {
              decos.push({
                from: c.from,
                to: c.to,
                value: Decoration.mark({
                  class: onCursor ? 'cm-md-code-fence' : 'cm-md-code-fence',
                }),
              });
            } else if (c.name === 'CodeInfo') {
              decos.push({
                from: c.from,
                to: c.to,
                value: Decoration.mark({ class: 'cm-md-code-info' }),
              });
            }
          } while (c.nextSibling());
        }

        return false; // don't descend further
      }

      // ── Blockquotes ──
      if (node.name === 'Blockquote') {
        let startLine = state.doc.lineAt(node.from).number;
        let endLine = state.doc.lineAt(
          Math.min(node.to, state.doc.length),
        ).number;
        for (let i = startLine; i <= endLine; i++) {
          let line = state.doc.line(i);
          decos.push({
            from: line.from,
            to: line.from,
            value: Decoration.line({ class: 'cm-md-blockquote-line' }),
          });
        }

        // Dim QuoteMark children
        let inner = node.node;
        let c = inner.cursor();
        if (c.firstChild()) {
          do {
            if (c.name === 'QuoteMark') {
              decos.push({
                from: c.from,
                to: c.to,
                value: Decoration.mark({ class: 'cm-md-quote-mark' }),
              });
            }
          } while (c.nextSibling());
        }
      }

      // ── Horizontal rules ──
      if (node.name === 'HorizontalRule') {
        let onCursor = isOnCursorLine(state, node.from, cursorLine);
        let line = state.doc.lineAt(node.from);

        if (onCursor) {
          decos.push({
            from: line.from,
            to: line.from,
            value: Decoration.line({ class: 'cm-md-hr-line' }),
          });
        } else {
          // Replace the --- with a visual <hr>
          decos.push({
            from: node.from,
            to: node.to,
            value: Decoration.replace({
              widget: new HorizontalRuleWidget(),
            }),
          });
        }
      }
    },
  });

  return decos;
}

// ── List decorations ───────────────────────────────────────────────────────

function buildListDecorations(
  state: EditorState,
  _cursorLine: number,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.name === 'ListItem') {
        let line = state.doc.lineAt(node.from);
        decos.push({
          from: line.from,
          to: line.from,
          value: Decoration.line({ class: 'cm-md-list-item' }),
        });

        // Style the ListMark
        let inner = node.node;
        let c = inner.cursor();
        if (c.firstChild()) {
          do {
            if (c.name === 'ListMark') {
              decos.push({
                from: c.from,
                to: c.to,
                value: Decoration.mark({ class: 'cm-md-list-mark' }),
              });
            }
          } while (c.nextSibling());
        }
        return false; // don't descend further into list item content
      }
    },
  });

  return decos;
}

// ── Link decorations ───────────────────────────────────────────────────────

function buildLinkDecorations(
  state: EditorState,
  cursorLine: number,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node) {
      if (node.name !== 'Link') return;

      let onCursor = isOnCursorLine(state, node.from, cursorLine);
      let inner = node.node;

      // Collect child nodes: LinkMark ([ ] ( )), URL
      let linkMarks: { from: number; to: number }[] = [];
      let urlNode: { from: number; to: number } | null = null;

      let c = inner.cursor();
      if (c.firstChild()) {
        do {
          if (c.name === 'LinkMark') {
            linkMarks.push({ from: c.from, to: c.to });
          } else if (c.name === 'URL') {
            urlNode = { from: c.from, to: c.to };
          }
        } while (c.nextSibling());
      }

      // Need at least [ ] ( ) — 4 marks
      if (linkMarks.length < 4) return false;

      // Text is between first [ and second ] (linkMarks[0] and linkMarks[1])
      let textFrom = linkMarks[0].to;
      let textTo = linkMarks[1].from;

      if (textFrom < textTo) {
        decos.push({
          from: textFrom,
          to: textTo,
          value: Decoration.mark({ class: 'cm-md-link-text' }),
        });
      }

      if (onCursor) {
        // Show all marks dimmed
        for (let m of linkMarks) {
          decos.push({
            from: m.from,
            to: m.to,
            value: Decoration.mark({ class: 'cm-md-marker' }),
          });
        }
        if (urlNode) {
          decos.push({
            from: urlNode.from,
            to: urlNode.to,
            value: Decoration.mark({ class: 'cm-md-link-url' }),
          });
        }
      } else {
        // Hide opening [
        decos.push({
          from: linkMarks[0].from,
          to: linkMarks[0].to,
          value: Decoration.replace({}),
        });
        // Hide ]( ... )  — from second mark through end
        if (linkMarks.length >= 3) {
          decos.push({
            from: linkMarks[1].from,
            to: node.to,
            value: Decoration.replace({}),
          });
        }
      }

      return false; // don't descend
    },
  });

  return decos;
}

// ── Card decorations ───────────────────────────────────────────────────────

function buildCardDecorations(
  state: EditorState,
  cursorLine: number,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let doc = state.doc;
  let text = doc.toString();

  // Block cards: ::card[URL]
  BLOCK_CARD_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BLOCK_CARD_RE.exec(text)) !== null) {
    let from = match.index;
    let to = from + match[0].length;
    if (isInsideCode(state, from, to)) continue;

    let cardId = match[1].trim();
    let pipeIdx = cardId.indexOf('|');
    if (pipeIdx >= 0) {
      cardId = cardId.substring(0, pipeIdx).trim();
    }

    let line = doc.lineAt(from);
    let onCursor = line.number === cursorLine;

    if (onCursor) {
      // Show raw syntax with active highlighting
      decos.push({
        from,
        to,
        value: Decoration.mark({
          class:
            'cm-bfm-card-ref cm-bfm-card-ref--block cm-bfm-card-ref--active',
        }),
      });
    } else {
      // Replace source text with card widget
      let widget = new CardWidget(cardId, 'block');
      decos.push({
        from,
        to,
        value: Decoration.replace({ widget }),
      });
    }
  }

  // Inline cards: :card[URL]
  INLINE_CARD_RE.lastIndex = 0;
  while ((match = INLINE_CARD_RE.exec(text)) !== null) {
    let from = match.index;
    let to = from + match[0].length;
    if (isInsideCode(state, from, to)) continue;

    let cardId = match[1].trim();
    let onCursor = isOnCursorLine(state, from, cursorLine);

    if (onCursor) {
      // Show raw syntax dimmed
      decos.push({
        from,
        to,
        value: Decoration.mark({
          class: 'cm-bfm-card-ref cm-bfm-card-ref--inline',
        }),
      });
    } else {
      // Replace source text with inline card widget
      let widget = new CardWidget(cardId, 'inline');
      decos.push({
        from,
        to,
        value: Decoration.replace({ widget }),
      });
    }
  }

  return decos;
}

// ── Build all decorations ──────────────────────────────────────────────────

function buildDecorations(
  state: EditorState,
  cursorLine: number,
): DecorationSet {
  let allDecos: DecoRange[] = [
    ...buildHeadingDecorations(state, cursorLine),
    ...buildInlineFormattingDecorations(state, cursorLine),
    ...buildBlockDecorations(state, cursorLine),
    ...buildListDecorations(state, cursorLine),
    ...buildLinkDecorations(state, cursorLine),
    ...buildCardDecorations(state, cursorLine),
  ];

  return Decoration.set(
    allDecos.map((d) => d.value.range(d.from, d.to)),
    true, // let CM6 sort
  );
}

// ── Card decoration StateField ─────────────────────────────────────────────

function createDecorationField(): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      let cursorLine = state.doc.lineAt(state.selection.main.head).number;
      return buildDecorations(state, cursorLine);
    },
    update(decos, tr) {
      if (tr.docChanged || tr.selection) {
        let cursorLine = tr.state.doc.lineAt(
          tr.state.selection.main.head,
        ).number;
        return buildDecorations(tr.state, cursorLine);
      }
      return decos;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

// ── Card target notification ViewPlugin ────────────────────────────────────

function createCardTargetNotifier(
  onChange: (targets: CardWidgetTarget[]) => void,
): ViewPlugin<Record<string, never>> {
  return ViewPlugin.fromClass(
    class {
      constructor(view: EditorView) {
        this.notifyTargets(view);
      }

      update(update: ViewUpdate) {
        if (
          update.docChanged ||
          update.selectionSet ||
          update.viewportChanged
        ) {
          this.notifyTargets(update.view);
        }
      }

      notifyTargets(view: EditorView) {
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
            view.dispatch({ changes: { from, to, insert: '' } });
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
    if (from === to) return false;
    let selected = view.state.sliceDoc(from, to);

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

  let decoField = createDecorationField();
  let targetNotifier = createCardTargetNotifier(onCardTargetsChange);
  let slashSource = createSlashCommandSource(onOpenCardSearch);

  let extensions: Extension[] = [
    markdown({ base: markdownLanguage }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdownKeymap,
    decoField,
    targetNotifier,
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
