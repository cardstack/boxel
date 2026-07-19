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

import {
  type BfmRefRange,
  extractBfmRefRanges,
} from '@cardstack/runtime-common/bfm-card-references';

// ── Card widget target interface ────────────────────────────────────────────

export interface CardWidgetTarget {
  element: HTMLElement;
  cardId: string;
  format: 'atom' | 'embedded';
  kind: 'inline' | 'block';
  // 'card' refs (`:card[URL]`) resolve to CardDef instances; 'file' refs
  // (`:file[URL]`) resolve to FileDef instances.
  refType: 'card' | 'file';
}

// ── State effect for opening card search ────────────────────────────────────

export const openCardSearchEffect = StateEffect.define<{
  from: number;
  to: number;
}>();

// ── Focus tracking ─────────────────────────────────────────────────────────

const focusChangeEffect = StateEffect.define<boolean>();

const focusField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(focused, tr) {
    for (let e of tr.effects) {
      if (e.is(focusChangeEffect)) return e.value;
    }
    return focused;
  },
});

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
// File references mirror card references with the `file` keyword.
const BLOCK_FILE_RE = /^::file\[([^\]\n]+)\][ \t]*$/gm;
const INLINE_FILE_RE = /(?<!:):file\[([^\]\n]+)\]/g;

// The keyword-generic set of BFM reference patterns scanned in the editor.
const BFM_REF_CONFIGS: {
  refType: 'card' | 'file';
  blockRe: RegExp;
  inlineRe: RegExp;
}[] = [
  { refType: 'card', blockRe: BLOCK_CARD_RE, inlineRe: INLINE_CARD_RE },
  { refType: 'file', blockRe: BLOCK_FILE_RE, inlineRe: INLINE_FILE_RE },
];

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
    readonly refType: 'card' | 'file' = 'card',
  ) {
    super();
  }

  eq(other: CardWidget) {
    return (
      this.cardId === other.cardId &&
      this.kind === other.kind &&
      this.refType === other.refType
    );
  }

  toDOM(): HTMLElement {
    let tag = this.kind === 'inline' ? 'span' : 'div';
    let el = document.createElement(tag);
    el.setAttribute('data-card-id', this.cardId);
    el.setAttribute('data-card-kind', this.kind);
    el.setAttribute('data-bfm-ref-type', this.refType);
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
    enter(node): false | void {
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
  livePreview: boolean,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node): false | void {
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
      let onCursor =
        !livePreview || cursorInRange(state, node.from, node.to, cursorLine);

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
            if (onCursor) {
              decos.push({
                from: cursor.from,
                to: cursor.to,
                value: Decoration.mark({ class: 'cm-md-marker' }),
              });
            } else {
              // Replace the marker AND the trailing space with nothing
              let hideEnd = cursor.to;
              let nextChar = state.sliceDoc(hideEnd, hideEnd + 1);
              if (nextChar === ' ') {
                hideEnd += 1;
              }
              decos.push({
                from: cursor.from,
                to: hideEnd,
                value: Decoration.replace({}),
              });
            }
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
  livePreview: boolean,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node): false | void {
      if (
        node.name !== 'StrongEmphasis' &&
        node.name !== 'Emphasis' &&
        node.name !== 'Strikethrough' &&
        node.name !== 'InlineCode'
      ) {
        return;
      }

      let onCursor =
        !livePreview || isOnCursorLine(state, node.from, cursorLine);

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

      // StrongEmphasis, Emphasis, or Strikethrough
      let cssClass =
        node.name === 'StrongEmphasis'
          ? 'cm-md-bold'
          : node.name === 'Strikethrough'
            ? 'cm-md-strikethrough'
            : 'cm-md-italic';
      let markName =
        node.name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark';
      let inner = node.node;
      let marks: { from: number; to: number }[] = [];
      let c = inner.cursor();
      if (c.firstChild()) {
        do {
          if (c.name === markName) {
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
  livePreview: boolean,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node): false | void {
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
        let onCursor =
          !livePreview || isOnCursorLine(state, node.from, cursorLine);
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
    enter(node): false | void {
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
  livePreview: boolean,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let tree = syntaxTree(state);

  tree.iterate({
    enter(node): false | void {
      if (node.name !== 'Link') return;

      let onCursor =
        !livePreview || isOnCursorLine(state, node.from, cursorLine);
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
  livePreview: boolean,
): DecoRange[] {
  let decos: DecoRange[] = [];
  let doc = state.doc;
  let text = doc.toString();
  let match: RegExpExecArray | null;

  for (let { refType, blockRe, inlineRe } of BFM_REF_CONFIGS) {
    // Block refs: ::card[URL] / ::file[URL]
    blockRe.lastIndex = 0;
    while ((match = blockRe.exec(text)) !== null) {
      let from = match.index;
      let to = from + match[0].length;
      if (isInsideCode(state, from, to)) continue;

      let cardId = match[1].trim();
      let pipeIdx = cardId.indexOf('|');
      if (pipeIdx >= 0) {
        cardId = cardId.substring(0, pipeIdx).trim();
      }

      let line = doc.lineAt(from);
      let onCursor = livePreview && line.number === cursorLine;

      if (!livePreview) {
        // Source mode: show raw syntax with highlighting only
        decos.push({
          from,
          to,
          value: Decoration.mark({
            class: 'cm-bfm-card-ref cm-bfm-card-ref--inline',
          }),
        });
      } else if (onCursor) {
        // Cursor on line: show raw syntax AND preview below
        decos.push({
          from,
          to,
          value: Decoration.mark({
            class: 'cm-bfm-card-ref cm-bfm-card-ref--inline',
          }),
        });
        let previewWidget = new CardWidget(cardId, 'block', refType);
        decos.push({
          from: to,
          to: to,
          value: Decoration.widget({ widget: previewWidget, side: 1 }),
        });
      } else {
        // Replace source text with widget
        let widget = new CardWidget(cardId, 'block', refType);
        decos.push({
          from,
          to,
          value: Decoration.replace({ widget }),
        });
      }
    }

    // Inline refs: :card[URL] / :file[URL]
    inlineRe.lastIndex = 0;
    while ((match = inlineRe.exec(text)) !== null) {
      let from = match.index;
      let to = from + match[0].length;
      if (isInsideCode(state, from, to)) continue;

      let cardId = match[1].trim();
      let onCursor = livePreview && isOnCursorLine(state, from, cursorLine);

      if (!livePreview) {
        // Source mode: show raw syntax with highlighting only
        decos.push({
          from,
          to,
          value: Decoration.mark({
            class: 'cm-bfm-card-ref cm-bfm-card-ref--inline',
          }),
        });
      } else if (onCursor) {
        // Cursor on line: show raw syntax AND preview after
        decos.push({
          from,
          to,
          value: Decoration.mark({
            class: 'cm-bfm-card-ref cm-bfm-card-ref--inline',
          }),
        });
        let previewWidget = new CardWidget(cardId, 'inline', refType);
        decos.push({
          from: to,
          to: to,
          value: Decoration.widget({ widget: previewWidget, side: 1 }),
        });
      } else {
        // Replace source text with inline widget
        let widget = new CardWidget(cardId, 'inline', refType);
        decos.push({
          from,
          to,
          value: Decoration.replace({ widget }),
        });
      }
    }
  }

  return decos;
}

// ── Build all decorations ──────────────────────────────────────────────────

function buildDecorations(
  state: EditorState,
  cursorLine: number,
  livePreview: boolean,
): DecorationSet {
  let allDecos: DecoRange[] = [
    ...buildHeadingDecorations(state, cursorLine, livePreview),
    ...buildInlineFormattingDecorations(state, cursorLine, livePreview),
    ...buildBlockDecorations(state, cursorLine, livePreview),
    ...buildListDecorations(state, cursorLine),
    ...buildLinkDecorations(state, cursorLine, livePreview),
    ...buildCardDecorations(state, cursorLine, livePreview),
  ];

  return Decoration.set(
    allDecos.map((d) => d.value.range(d.from, d.to)),
    true, // let CM6 sort
  );
}

// ── Card decoration StateField ─────────────────────────────────────────────

function createDecorationField(
  livePreview: boolean,
): StateField<DecorationSet> {
  return StateField.define<DecorationSet>({
    create(state) {
      let focused = state.field(focusField);
      let cursorLine = focused
        ? state.doc.lineAt(state.selection.main.head).number
        : -1;
      return buildDecorations(state, cursorLine, livePreview);
    },
    update(decos, tr) {
      let focusChanged = tr.effects.some((e) => e.is(focusChangeEffect));
      // In source mode, cursor/focus changes don't affect decorations
      if (tr.docChanged || (livePreview && (tr.selection || focusChanged))) {
        let focused = tr.state.field(focusField);
        let cursorLine = focused
          ? tr.state.doc.lineAt(tr.state.selection.main.head).number
          : -1;
        return buildDecorations(tr.state, cursorLine, livePreview);
      }
      return decos;
    },
    provide: (f) => EditorView.decorations.from(f),
  });
}

// ── Card target notification ViewPlugin ────────────────────────────────────

function createCardTargetNotifier(
  onChange: (targets: CardWidgetTarget[]) => void,
): ViewPlugin<{ destroy(): void }> {
  return ViewPlugin.fromClass(
    class {
      private rafId = 0;
      private destroyed = false;

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

      destroy() {
        this.destroyed = true;
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
          this.rafId = 0;
        }
      }

      notifyTargets(view: EditorView) {
        if (this.rafId) {
          cancelAnimationFrame(this.rafId);
        }
        // eslint-disable-next-line @cardstack/boxel/no-raf-for-state -- throttled DOM measurement after paint
        this.rafId = requestAnimationFrame(() => {
          this.rafId = 0;
          if (this.destroyed) return;
          let targets: CardWidgetTarget[] = [];
          let editorDom = view.dom;
          let widgetElements = editorDom.querySelectorAll('.cm-card-widget');
          for (let el of widgetElements) {
            let cardId = el.getAttribute('data-card-id');
            let kind = el.getAttribute('data-card-kind') as 'inline' | 'block';
            let refType =
              (el.getAttribute('data-bfm-ref-type') as 'card' | 'file') ??
              'card';
            if (cardId) {
              targets.push({
                element: el as HTMLElement,
                cardId,
                format: kind === 'inline' ? 'atom' : 'embedded',
                kind,
                refType,
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
    let len = marker.length;

    // No selection: insert an empty pair of markers and drop the cursor
    // between them so the user can type the content (e.g. **|**).
    if (from === to) {
      view.dispatch({
        changes: { from, insert: marker + marker },
        selection: { anchor: from + len },
      });
      return true;
    }

    let selected = view.state.sliceDoc(from, to);

    // Case 1: Selection includes the markers (source mode selection)
    if (
      selected.startsWith(marker) &&
      selected.endsWith(marker) &&
      selected.length >= len * 2
    ) {
      view.dispatch({
        changes: {
          from,
          to,
          insert: selected.slice(len, -len),
        },
      });
      return true;
    }

    // Case 2: Markers are adjacent to the selection (live preview mode where
    // markers are hidden — the user selects just the visible text)
    let before = view.state.sliceDoc(Math.max(0, from - len), from);
    let after = view.state.sliceDoc(
      to,
      Math.min(view.state.doc.length, to + len),
    );
    if (before === marker && after === marker) {
      view.dispatch({
        changes: { from: from - len, to: to + len, insert: selected },
        selection: { anchor: from - len, head: to - len },
      });
      return true;
    }

    // Case 3: Wrap with markers
    view.dispatch({
      changes: { from, to, insert: marker + selected + marker },
      selection: {
        anchor: from + len,
        head: to + len,
      },
    });
    return true;
  };
}

// Toggle a markdown link around the selection. Uses the syntax tree to detect
// an enclosing [text](url) — a string scan can match across unrelated brackets
// and delete text the user never selected.
function toggleLink(view: EditorView): boolean {
  let { from, to } = view.state.selection.main;

  let node: any = syntaxTree(view.state).resolveInner(from, 1);
  let link: any = null;
  for (let n: any = node; n; n = n.parent) {
    if (n.name === 'Link') {
      link = n;
      break;
    }
  }
  if (link && from >= link.from && to <= link.to) {
    // Unlink: replace the whole node with just its text (between [ and ]).
    let marks: { from: number; to: number }[] = [];
    let c = link.cursor();
    if (c.firstChild()) {
      do {
        if (c.name === 'LinkMark') marks.push({ from: c.from, to: c.to });
      } while (c.nextSibling());
    }
    if (marks.length >= 2) {
      let text = view.state.sliceDoc(marks[0].to, marks[1].from);
      view.dispatch({
        changes: { from: link.from, to: link.to, insert: text },
      });
      return true;
    }
  }

  if (from === to) {
    // No selection: insert empty link syntax with the cursor inside the
    // brackets so the user can type the link text — [|](url).
    view.dispatch({
      changes: { from, insert: '[](url)' },
      selection: { anchor: from + 1 },
    });
    return true;
  }

  // Wrap the selection as link text with a placeholder URL, selecting "url".
  let selected = view.state.sliceDoc(from, to);
  let insert = `[${selected}](url)`;
  view.dispatch({
    changes: { from, to, insert },
    selection: {
      anchor: from + selected.length + 3,
      head: from + selected.length + 6,
    },
  });
  return true;
}

const markdownKeymap = keymap.of([
  { key: 'Mod-b', run: wrapWith('**') },
  { key: 'Mod-i', run: wrapWith('*') },
  { key: 'Mod-`', run: wrapWith('`') },
]);

// ── createEditorState factory ───────────────────────────────────────────────

export interface SelectionInfo {
  hasSelection: boolean;
  /** Whether the editor currently holds focus. Drives toolbar enablement. */
  hasFocus: boolean;
  from: number;
  to: number;
  /** Which inline formats are active in the current selection */
  formats: {
    bold: boolean;
    italic: boolean;
    code: boolean;
    strikethrough: boolean;
    link: boolean;
  };
  // BFM `:card[…]` / `::file[…]` directive the cursor head is currently
  // inside. Undefined when the cursor is outside every directive. Drives
  // the toolbar's Add-vs-Edit-embed swap.
  currentRef?: BfmRefRange;
}

function detectFormats(
  state: EditorState,
  from: number,
  to: number,
): SelectionInfo['formats'] {
  let text = state.sliceDoc(from, to);
  // Check if the selection (or surrounding context) contains these markers
  let before = state.sliceDoc(Math.max(0, from - 3), from);
  let after = state.sliceDoc(to, Math.min(state.doc.length, to + 3));
  let expanded = before + text + after;

  return {
    bold:
      (text.startsWith('**') && text.endsWith('**')) ||
      (before.endsWith('**') && after.startsWith('**')),
    italic:
      ((text.startsWith('*') && text.endsWith('*')) ||
        (before.endsWith('*') && after.startsWith('*'))) &&
      !(
        (text.startsWith('**') && text.endsWith('**')) ||
        (before.endsWith('**') && after.startsWith('**'))
      ),
    code:
      (text.startsWith('`') && text.endsWith('`')) ||
      (before.endsWith('`') && after.startsWith('`')),
    strikethrough:
      (text.startsWith('~~') && text.endsWith('~~')) ||
      (before.endsWith('~~') && after.startsWith('~~')),
    link: expanded.includes(']('),
  };
}

export interface CreateEditorStateOptions {
  content: string;
  onDocChange: (text: string) => void;
  onCardTargetsChange: (targets: CardWidgetTarget[]) => void;
  onOpenCardSearch: (pos: { from: number; to: number }) => void;
  onSelectionChange?: (info: SelectionInfo) => void;
  /** When false, all syntax markers are visible (source mode). Default true. */
  livePreview?: boolean;
}

function createEditorState(options: CreateEditorStateOptions): EditorState {
  let {
    content,
    onDocChange,
    onCardTargetsChange,
    onOpenCardSearch,
    onSelectionChange,
    livePreview = true,
  } = options;

  let decoField = createDecorationField(livePreview);
  let slashSource = createSlashCommandSource(onOpenCardSearch);

  let extensions: Extension[] = [
    markdown({ base: markdownLanguage }),
    history(),
    keymap.of([...defaultKeymap, ...historyKeymap]),
    markdownKeymap,
    focusField,
    EditorView.focusChangeEffect.of((_state, focusing) =>
      focusChangeEffect.of(focusing),
    ),
    decoField,
    // Card widget target notifier is only needed in live preview mode
    // (source mode has no card widgets to track)
    ...(livePreview ? [createCardTargetNotifier(onCardTargetsChange)] : []),
    autocompletion({
      override: [slashSource],
      defaultKeymap: true,
    }),
    (() => {
      // BFM ref ranges cached across selection-only updates — `extractBfmRefRanges`
      // is a doc-wide string scan, so recompute only when the doc changes.
      let cachedRanges: BfmRefRange[] = extractBfmRefRanges(content);

      return EditorView.updateListener.of((update: ViewUpdate) => {
        if (update.docChanged) {
          let nextDoc = update.state.doc.toString();
          onDocChange(nextDoc);
          cachedRanges = extractBfmRefRanges(nextDoc);
        }
        if (
          onSelectionChange &&
          (update.selectionSet || update.docChanged || update.focusChanged)
        ) {
          let { from, to } = update.state.selection.main;
          let hasSelection = from !== to;
          let head = update.state.selection.main.head;
          // Which directive, if any, owns the caret. A block directive is the
          // only content on its line, so its whole span — end boundary included
          // (`head == to`, e.g. caret at end-of-line or on the block widget) —
          // reads as "inside". An inline directive is surrounded by prose, so
          // its end boundary is exclusive: caret on the closing `]` (== to) is
          // the seam where post-directive typing continues, not edit-this-embed.
          let currentRef = cachedRanges.find((r) =>
            r.kind === 'block'
              ? head >= r.from && head <= r.to
              : head >= r.from && head < r.to,
          );
          onSelectionChange({
            hasSelection,
            hasFocus: update.view.hasFocus,
            from,
            to,
            formats: hasSelection
              ? detectFormats(update.state, from, to)
              : {
                  bold: false,
                  italic: false,
                  code: false,
                  strikethrough: false,
                  link: false,
                },
            currentRef,
          });
        }
      });
    })(),
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
  focusChangeEffect: typeof focusChangeEffect;
  wrapWith: typeof wrapWith;
  toggleLink: typeof toggleLink;
}

const codemirrorContext: CodeMirrorContext = {
  EditorState,
  EditorView,
  createEditorState,
  undo,
  redo,
  openCardSearchEffect,
  focusChangeEffect,
  wrapWith,
  toggleLink,
};

export default codemirrorContext;
