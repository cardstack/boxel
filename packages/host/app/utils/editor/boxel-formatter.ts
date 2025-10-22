export type LintAndFixFn = (input: {
  realm: string;
  filename: string;
  fileContent: string;
}) => Promise<{ output: string } | { output?: undefined }>; // allow undefined for safety

export interface EditorLike {
  pushUndoStop(): void;
}

export interface ModelLike {
  getValue(): string;
  getFullModelRange(): unknown;
  pushEditOperations(...args: any[]): any;
}

export interface FormatWithBoxelOptions {
  lintAndFix: LintAndFixFn;
  realm: string;
  filename: string;
  fileContent: string;
  editor: EditorLike;
  model: ModelLike;
}

export async function applyBoxelFormatting({
  lintAndFix,
  realm,
  filename,
  fileContent,
  editor,
  model,
}: FormatWithBoxelOptions): Promise<
  { output: string; changed: boolean } | { output: undefined; changed: false }
> {
  let result = await lintAndFix({ realm, filename, fileContent });
  let output = result?.output;

  if (output == null || output === model.getValue()) {
    return { output: output, changed: false };
  }

  editor.pushUndoStop();
  model.pushEditOperations(
    [],
    [
      {
        range: model.getFullModelRange(),
        text: output,
      },
    ],
    () => null,
  );
  editor.pushUndoStop();

  return { output, changed: true };
}
