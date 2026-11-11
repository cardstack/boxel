// Pretui — CodeEditor: source code, edited in CodeMirror.
//
// CodeMirror is not a dependency of this module. The host loads it on demand
// and hands it over through `globalThis.__loadCodeMirror`, as base's markdown
// editor does, so a card that renders a CodeEditor ships no editor code of its
// own. Until CodeMirror arrives, and wherever it doesn't (a prerender, which
// never loads it, or a page with no loader), the code is shown read-only
// through CodeBlock, so the content is never blank.
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { isDestroyed, isDestroying } from '@ember/destroyable';
import type Owner from '@ember/owner';
import { modifier } from 'ember-modifier';
import { CodeBlock } from './code-block';
import { keepStyle, type KeptProperty } from '../internal/keep-style';

export type CodeEditorLanguage = 'javascript' | 'typescript' | 'json' | 'plain';

const LANGUAGES: readonly CodeEditorLanguage[] = [
  'javascript',
  'typescript',
  'json',
  'plain',
];

// CodeBlock's names for the same grammars, for the read-only fallback.
const FALLBACK_LANGUAGE: Record<CodeEditorLanguage, string | undefined> = {
  javascript: 'js',
  typescript: 'ts',
  json: 'json',
  plain: undefined,
};

// CodeMirror's DOM, styled from the theme's tokens. It reaches CodeMirror as
// an `EditorView.theme`, which outranks CodeMirror's own base theme: that one
// is injected unlayered, so rules in this module's cascade layer would lose to
// it. Tokens take CodeBlock's hues and the same ink derivation, so code reads
// the same whether it is being read or edited. The floor and ceiling are line
// COUNTS set on the component root; the line height is already in CSS, so the
// arithmetic stays here.
const ink = (hue: string, mix = '18%') =>
  `color-mix(in oklch, var(--foreground) ${mix}, ${hue})`;

const EDITOR_THEME: Record<string, Record<string, string>> = {
  '&': {
    minHeight:
      'calc(var(--pretui-code-editor-min, 3) * var(--pretui-code-leading, 1.6) * 1em + var(--boxel-sp-xs) * 2)',
    maxHeight:
      'calc(var(--pretui-code-editor-max, 24) * var(--pretui-code-leading, 1.6) * 1em + var(--boxel-sp-xs) * 2)',
    backgroundColor: 'transparent',
    color: 'inherit',
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: 'inherit',
    overflow: 'auto',
  },
  '.cm-content': {
    paddingBlock: 'var(--boxel-sp-xs)',
    caretColor: 'var(--foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'color-mix(in oklch, var(--muted) 60%, var(--card))',
    color: 'var(--muted-foreground)',
    borderInlineEnd: 'none',
    userSelect: 'none',
  },
  '.cm-activeLine, .cm-activeLineGutter': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 6%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
    {
      backgroundColor: 'color-mix(in oklch, var(--primary) 22%, transparent)',
    },
  '.cm-cursor, .cm-dropCursor': { borderInlineStartColor: 'var(--foreground)' },
  '&.cm-focused .cm-matchingBracket': {
    backgroundColor: 'color-mix(in oklch, var(--primary) 16%, transparent)',
    outline: '1px solid color-mix(in oklch, var(--primary) 40%, transparent)',
  },
  '.tok-comment': {
    color: ink('var(--pretui-code-comment, var(--muted-foreground))', '8%'),
    fontStyle: 'italic',
  },
  '.tok-string, .tok-string2': {
    color: ink('var(--pretui-code-string, var(--chart-1))'),
  },
  '.tok-number, .tok-bool, .tok-atom': {
    color: ink('var(--pretui-code-number, var(--chart-3))'),
  },
  '.tok-keyword': {
    color: ink('var(--pretui-code-keyword, var(--chart-4))'),
    fontWeight: '500',
  },
  '.tok-typeName, .tok-propertyName, .tok-definition': {
    color: ink('var(--pretui-code-name, var(--chart-2))'),
  },
  '.tok-punctuation, .tok-operator': {
    color:
      'color-mix(in oklch, var(--muted-foreground) 70%, var(--foreground))',
  },
};

// Read-only code has no active line to mark.
const READ_ONLY_THEME: Record<string, Record<string, string>> = {
  ...EDITOR_THEME,
  '.cm-activeLine, .cm-activeLineGutter': { backgroundColor: 'transparent' },
};

const DEFAULT_MIN_LINES = 3;
const DEFAULT_MAX_LINES = 24;

// The parts of the host's CodeMirror context this component reads. Kept
// structural so this module imports nothing from the host.
interface EditorViewLike {
  readonly dom: HTMLElement;
  readonly state: { readonly doc: { toString(): string; length: number } };
  dispatch(spec: {
    changes: { from: number; to: number; insert: string };
    annotations?: unknown;
  }): void;
  destroy(): void;
}

interface CodeMirrorLike {
  EditorView: new (config: {
    state: unknown;
    parent: Element;
  }) => EditorViewLike;
  Transaction: { addToHistory: { of(value: boolean): unknown } };
  createCodeEditorState(options: {
    doc: string;
    language?: CodeEditorLanguage;
    readOnly?: boolean;
    lineNumbers?: boolean;
    controlId?: string;
    label?: string;
    labelledBy?: string;
    describedBy?: string;
    theme?: Record<string, Record<string, string>>;
    onDocChange?: (text: string) => void;
  }): unknown;
}

export interface CodeEditorSignature {
  Args: {
    /** the source text */
    value?: string;
    /** fires with the whole text after every edit */
    onInput?: (value: string) => void;
    /** 'javascript' | 'typescript' | 'json' | 'plain' (default); anything
     * else is plain */
    language?: CodeEditorLanguage | string;
    /** shows the code and lets it be selected, but not changed */
    readOnly?: boolean;
    /** the line-number gutter (default true) */
    lineNumbers?: boolean;
    /** height floor, in lines (default 3) */
    minLines?: number;
    /** height ceiling, in lines; past it the editor scrolls (default 24) */
    maxLines?: number;
    /** an id for the editable element, so other elements can point at it */
    controlId?: string;
    /** the accessible name, when no element on the page names the editor */
    label?: string;
    /** the id of the element that names the editor: a Field's label, with
     * `@labelTag='span'`, since a `<label for>` can't name CodeMirror's
     * editable element */
    labelledBy?: string;
    /** the id(s) of elements that describe the editor, such as a Field's
     * message line */
    describedBy?: string;
  };
  Element: HTMLDivElement;
}

function lineCount(value: number | undefined, fallback: number): string {
  return String(
    typeof value === 'number' && Number.isFinite(value) && value > 0
      ? Math.round(value)
      : fallback,
  );
}

export class CodeEditor extends Component<CodeEditorSignature> {
  @tracked private cm: CodeMirrorLike | null = null;
  private view: EditorViewLike | null = null;
  // The editor's configuration when its view was made; a change rebuilds it.
  private viewConfig: string | undefined;
  // The text this editor last reported through @onInput. When the caller
  // passes it back as @value, that is an echo of the user's own typing, not a
  // new value, and the document is left alone.
  private lastReported: string | undefined;
  // True while the component itself replaces the document with an outside
  // @value. That change is not the user's, so it is not reported: reporting
  // it would also write the caller's state in the middle of a render.
  private applyingValue = false;
  // The @value this editor last took in. A different one is a new value from
  // outside; the same one, passed again, is not.
  private seenValue: string | undefined;

  constructor(owner: Owner, args: CodeEditorSignature['Args']) {
    super(owner, args);
    this.loadCodeMirror();
  }

  private async loadCodeMirror() {
    let load = (globalThis as { __loadCodeMirror?: () => Promise<unknown> })
      .__loadCodeMirror;
    // A prerender captures the read-only fallback rather than racing the
    // editor's load.
    if (
      typeof load !== 'function' ||
      (globalThis as { __boxelRenderContext?: unknown }).__boxelRenderContext
    ) {
      return;
    }
    try {
      let cm = (await load()) as Partial<CodeMirrorLike> | undefined;
      if (isDestroying(this) || isDestroyed(this)) {
        return;
      }
      if (
        typeof cm?.createCodeEditorState === 'function' &&
        typeof cm.EditorView === 'function' &&
        cm.Transaction
      ) {
        this.cm = cm as CodeMirrorLike;
      }
    } catch {
      // The read-only fallback stays.
    }
  }

  get language(): CodeEditorLanguage {
    let language = this.args.language;
    return LANGUAGES.includes(language as CodeEditorLanguage)
      ? (language as CodeEditorLanguage)
      : 'plain';
  }

  get fallbackLanguage(): string | undefined {
    return FALLBACK_LANGUAGE[this.language];
  }

  get lineNumbers(): boolean {
    return this.args.lineNumbers ?? true;
  }

  get maxLines(): number {
    return Number(lineCount(this.args.maxLines, DEFAULT_MAX_LINES));
  }

  get keptStyle(): KeptProperty[] {
    return [
      {
        property: '--pretui-code-editor-min',
        value: lineCount(this.args.minLines, DEFAULT_MIN_LINES),
        strength: 'arg',
      },
      {
        property: '--pretui-code-editor-max',
        value: lineCount(this.args.maxLines, DEFAULT_MAX_LINES),
        strength: 'arg',
      },
    ];
  }

  private mountEditor = modifier((element: HTMLElement) => {
    let cm = this.cm;
    if (!cm) {
      return;
    }
    let value = this.args.value ?? '';
    let readOnly = Boolean(this.args.readOnly);
    let config = JSON.stringify([
      this.language,
      readOnly,
      this.lineNumbers,
      this.args.controlId ?? '',
      this.args.label ?? '',
      this.args.labelledBy ?? '',
      this.args.describedBy ?? '',
    ]);
    // A value the caller hasn't passed before, and that isn't the caller
    // handing back what was typed, replaces the document.
    let outsideValue =
      value !== this.seenValue && value !== this.lastReported;
    this.seenValue = value;

    let view = this.view;
    if (view && element.contains(view.dom) && this.viewConfig === config) {
      let current = view.state.doc.toString();
      if (outsideValue && value !== current) {
        this.applyingValue = true;
        try {
          // Not the user's edit, so undo doesn't bring back what it replaced.
          view.dispatch({
            changes: { from: 0, to: view.state.doc.length, insert: value },
            annotations: cm.Transaction.addToHistory.of(false),
          });
        } finally {
          this.applyingValue = false;
        }
        this.lastReported = value;
      }
      return;
    }

    // A rebuilt view keeps what the user has typed, unless a new value
    // arrived along with the change that rebuilds it.
    let doc = view && !outsideValue ? view.state.doc.toString() : value;
    view?.destroy();
    element.replaceChildren();
    let state = cm.createCodeEditorState({
      doc,
      language: this.language,
      readOnly,
      lineNumbers: this.lineNumbers,
      controlId: this.args.controlId,
      label: this.args.label,
      labelledBy: this.args.labelledBy,
      describedBy: this.args.describedBy,
      theme: readOnly ? READ_ONLY_THEME : EDITOR_THEME,
      onDocChange: (text: string) => {
        if (isDestroying(this) || isDestroyed(this) || this.applyingValue) {
          return;
        }
        this.lastReported = text;
        this.args.onInput?.(text);
      },
    });
    this.view = new cm.EditorView({ state, parent: element });
    this.viewConfig = config;
  });

  willDestroy() {
    super.willDestroy();
    this.view?.destroy();
    this.view = null;
  }

  <template>
    <div
      class='pretui-code-editor'
      data-language={{this.language}}
      data-read-only={{if @readOnly 'true' 'false'}}
      data-loaded={{if this.cm 'true' 'false'}}
      {{keepStyle this.keptStyle}}
      data-test-pretui-code-editor
      ...attributes
    >
      {{#if this.cm}}
        <div
          class='pretui-code-editor-host'
          {{this.mountEditor}}
          data-test-pretui-code-editor-host
        ></div>
      {{else}}
        <CodeBlock
          class='pretui-code-editor-fallback'
          @code={{@value}}
          @language={{this.fallbackLanguage}}
          @lineNumbers={{this.lineNumbers}}
          @maxLines={{this.maxLines}}
          @noCopy={{true}}
          @label={{@label}}
          @density='compact'
        />
      {{/if}}
    </div>
    <style scoped>
      @layer PretComponent {
        /* The frame matches CodeBlock's: one depth token, no border for
           separation. CodeMirror's own DOM is styled by EDITOR_THEME above. */
        .pretui-code-editor {
          display: grid;
          border-radius: var(--boxel-border-radius);
          background-color: var(--card);
          color: var(--card-foreground);
          box-shadow: var(--pretui-shadow-card, 0 0 0 1px var(--border));
          overflow: hidden;
          font-family: var(--font-mono);
          font-size: var(--pretui-code-size, var(--boxel-font-size-xs));
          line-height: var(--pretui-code-leading, 1.6);
          font-variant-numeric: tabular-nums;
        }
        .pretui-code-editor:focus-within {
          outline: 2px solid var(--ring);
          outline-offset: 1px;
        }
        .pretui-code-editor-fallback {
          box-shadow: none;
          border-radius: 0;
        }
      }
    </style>
  </template>
}
