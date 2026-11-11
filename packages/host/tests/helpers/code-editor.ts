import { settled, waitFor } from '@ember/test-helpers';

import { EditorView } from '@codemirror/view';

// Drives Pret UI's CodeEditor in host tests. `selector` names the editor's
// root (`[data-test-pretui-code-editor]`, or a caller's own data-test
// attribute on the component). Each helper finds the live CodeMirror view, so
// it keeps working after the editor re-renders.

export const CODE_EDITOR_SELECTOR = '[data-test-pretui-code-editor]';

// The editable content element, found by the `aria-multiline` the component
// sets on it rather than by CodeMirror's own class names.
export function codeEditorContentSelector(selector = CODE_EDITOR_SELECTOR) {
  return `${selector} [aria-multiline='true']`;
}

export async function waitForCodeEditor(
  selector = CODE_EDITOR_SELECTOR,
  options?: { timeout?: number },
): Promise<void> {
  await waitFor(codeEditorContentSelector(selector), options);
}

export function codeEditorView(selector = CODE_EDITOR_SELECTOR): EditorView {
  let content = document.querySelector(codeEditorContentSelector(selector));
  let view = content ? EditorView.findFromDOM(content as HTMLElement) : null;
  if (!view) {
    throw new Error(`no CodeMirror view in ${selector}`);
  }
  return view;
}

export function codeEditorContent(selector = CODE_EDITOR_SELECTOR): string {
  return codeEditorView(selector).state.doc.toString();
}

// Typing goes through the same transactions CodeMirror's input makes, which
// a read-only editor doesn't stop on its own; it refuses the keyboard, so the
// helpers refuse too, and a test can't type into what a person couldn't.
function editableView(selector: string): EditorView {
  let view = codeEditorView(selector);
  if (view.state.readOnly) {
    throw new Error(`the CodeMirror view in ${selector} is read-only`);
  }
  return view;
}

// Types at the end of the document, focused, the way CodeMirror's own input
// handling does: a transaction tagged as user input.
export async function typeInCodeEditor(
  selector: string,
  text: string,
): Promise<void> {
  let view = editableView(selector);
  view.focus();
  let end = view.state.doc.length;
  view.dispatch({
    changes: { from: end, insert: text },
    selection: { anchor: end + text.length },
    userEvent: 'input.type',
  });
  await settled();
}

// Replaces the whole document as one user edit.
export async function setCodeEditorContent(
  selector: string,
  text: string,
): Promise<void> {
  let view = editableView(selector);
  view.focus();
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: 'input.type',
  });
  await settled();
}
