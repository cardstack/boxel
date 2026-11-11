## What it is

Source code you can edit: a CodeMirror editor with a language mode, line numbers, undo and the editing keys people expect from a code editor. Use it where a card lets someone write a script, a query or a snippet in place. To show code that is read and never edited, use **CodeBlock**. It is lighter, it copies, and it renders in a prerender where this cannot. For prose, use **Textarea**.

## The contract

```
@value?       — the source text
@onInput?     — fires with the whole text after every edit
@language?    — 'javascript' | 'typescript' | 'json' | 'plain' (default); anything else is plain
@readOnly?    — the code can be read, selected and copied, but not changed
@lineNumbers? — the gutter (default true)
@minLines?    — height floor, in lines (default 3)
@maxLines?    — height ceiling, in lines (default 24); past it the editor scrolls
@controlId?   — lands on the editable element, for a Field's <label for>
@label?       — the accessible name when no label points at the editor
Element: HTMLDivElement
```

**CodeMirror is the host's, not this module's.** The component asks for it through `globalThis.__loadCodeMirror`, the loader the host sets for base's markdown editor, and calls the context's `createCodeEditorState`. A card that renders a CodeEditor ships no editor code, and the editor arrives in its own chunk the first time any page needs one.

**Until it arrives, the code is shown, not hidden.** Before CodeMirror loads, and wherever it can't (a prerender, a page with no loader, a host whose context has no code editor), the component renders the same text read-only through **CodeBlock**, with the same language and line numbers. A search result or a printed card shows the code, and the swap to the live editor doesn't move anything.

**An echo of your own typing is not a new value.** The editor reports every change through `@onInput`, and a caller usually stores it and passes it straight back as `@value`. The component remembers the last text it reported and ignores a `@value` that matches it, so the caller's round trip never resets the document or the caret. Any other `@value`, such as a save from somewhere else, replaces the document in the same editor.

**A change of language, read-only, line numbers, id or label rebuilds the editor, keeping its text.** Those are fixed when CodeMirror makes its state; rebuilding keeps what the user typed rather than reverting to `@value`.

**Tab moves focus.** The editor doesn't take Tab for indentation, so it is never a keyboard trap; indentation comes from Enter, which keeps the current line's indent.

## Prior art

**CodeMirror 6** is the editor. The wrapper's shape follows the kit's other text controls (**Input**, **Textarea**): a value in, the whole value out through `@onInput`, and a `@controlId` the surrounding **Field** mints.

Where Pretui is better: the echo rule and the read-only fallback. Wrappers commonly reset the caret when the parent passes the typed value back, and commonly render nothing until the editor loads.

Where it is thinner: no autocompletion, linting, folding, search panel or diff view, and three languages. Monaco, in code mode, is the full IDE; this is the editor a card can carry.

## Accessibility

- **The editable element is CodeMirror's content element**, a `contenteditable` with `aria-multiline`. `@controlId` puts the id there, so a Field's label names the editor; without one, `@label` is its `aria-label`.
- **Read-only is announced and enforced.** The content element is not editable and carries `aria-readonly`, and the text can still be selected and copied.
- **Tab is never captured**, so a keyboard user always has a way out.
- **The gutter is not editable or selectable**, and the fallback's gutter is `aria-hidden`, as CodeBlock's is.
- **Focus is visible on the whole frame** (`:focus-within`, outlined in `--ring`), since CodeMirror's own focus outline is turned off.

## Theming

`--pretui-code-size`, `--pretui-code-leading` and `--pretui-code-tab` (type metrics, shared with CodeBlock), `--pretui-shadow-card`, and the syntax channel CodeBlock reads: `--pretui-code-keyword`, `--pretui-code-string`, `--pretui-code-number`, `--pretui-code-comment`, `--pretui-code-name`. Code reads the same whether it is being read or edited.

The frame sits in `@layer PretComponent`. CodeMirror's own DOM is styled through an `EditorView.theme` the component hands the editor, because CodeMirror injects its base theme as unlayered CSS that a layered rule can't outrank; the theme's values are the same tokens. `--pretui-code-editor-min` and `--pretui-code-editor-max` (line counts) are set from `@minLines` and `@maxLines`.

CodeMirror injects its styles at run time, so this component doesn't run on the secure origin, whose Content Security Policy forbids that.
