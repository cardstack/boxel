## What it is

**The list of files being uploaded**, under a drop target. Each file shows its name, size, a progress bar while uploading, and a status in words, and a failed file says why and offers Retry. This is the list half of Ant Upload and Chakra FileUpload.

**Dropzone** and **FileTrigger** pick files. FileUpload shows what happened to them. It holds no bytes and runs no request. The caller owns `@files`, uploads each file, and updates its status and progress. The file itself belongs in a FileDef link, never in card JSON.

## The contract

```
@files ({ id, name, size?, status: 'queued' | 'uploading' | 'done' | 'error', progress?, error? }[])
@onAdd? (File[]), @onReject?, @onRemove?, @onRetry?
@accept?, @multiple? (default true), @max?, @maxSize?
@label?, @hint?, @disabled?
<:trigger as |api|>   — replaces the default Dropzone; api is { add, remaining }
Element: HTMLDivElement
```

**Adding.** The default trigger is a **Dropzone** with its own browse button, and it passes the screened files to `@onAdd`. `@accept` and `@maxSize` are enforced there, and refusals go to `@onReject` with the reason. `@max` caps the Dropzone's `maxFiles` at the room left, and removes the drop target once the list is full, when the summary adds "limit reached". A custom `<:trigger>` is yielded `add`, which cuts to the room left the same way, and `remaining`.

**Rows.** Each row has a tone stripe (info while uploading, success when done, danger when failed) and a status word: "Waiting", "Uploading", "Uploaded" or "Failed". An uploading row has a **ProgressBar** named for its file. A failed row shows its `error` text.

**Actions.** Remove appears when `@onRemove` is passed, and Retry on failed rows when `@onRetry` is passed. Each is named for its file: "Retry roast-curve.csv".

**One summary line.** A polite status sums the list up, "1 of 3 uploaded, 1 failed", so screen reader users hear progress without every bar announcing itself.

## Prior art

**Ant `Upload`** owns the request: `action`, `customRequest`, `fileList`, `onChange`, `beforeUpload`, `listType` (`text | picture | picture-card`) and `maxCount`. **Chakra `FileUpload`** (v3) splits a dropzone, a trigger and an item list, as here. **react-dropzone** is picking only, and agents hand-roll the list.

Where Pretui is better: **the caller owns the upload**, so any transport, signed URL or FileDef flow fits without a `customRequest` escape hatch. **Status is text, not only colour**, **actions are named for their file**, and **progress is summarised in one live line**.

Where it is thinner: **no picture thumbnails** or `picture-card` layout, **no drag-to-reorder**, and **no pause or cancel** beyond Remove. The caller decides what Remove does to an upload in flight.

## Accessibility

No single APG pattern. It is a list, buttons, progress bars and a status line.

- **The list is a `<ul>`** labelled by `@label`, with one `<li>` per file. The tests assert both.
- **Status is text.** Every row says "Uploaded", "Failed" and so on, and the stripe backs it up. The tests assert each status word.
- **Progress bars are named for their file**, "cupping-notes.docx upload progress", through **ProgressBar**. The tests assert the name.
- **Retry and Remove are `type="button"`, named for their file.** They appear only when their handler exists. The tests assert names, handlers and absence.
- **One polite summary**, `role="status"`, which the tests assert. A failure is not announced assertively on its own. If a failure needs attention right now, the caller can raise a **Toast**.
- **Adding is keyboard-reachable** through the Dropzone's browse button, so dragging is never the only path.
- **Focus never falls to the page.** When Retry goes away, focus moves to its row (rows are `tabindex="-1"`). After Remove it moves to the next row's Remove, or the drop target when the list is empty. When an add fills the list it moves to the list. The tests assert Retry and Remove.

## Theming

`--card` and `--border` (the rows), `--pretui-upload-tone` (the stripe, set from the status: `--pretui-info`, `--success`, `--destructive` or `--border`), `--muted-foreground` (size and status), `--foreground` and `--destructive` (the failed status and error text), `--primary` (Retry), `--hover`, `--ring`, `--radius-control`, `--font-sans`, `--text-ui-md`, `--text-ui-sm`, `--space-2` and `--space-3`. The drop target and the bars read **Dropzone**'s and **ProgressBar**'s own tokens.

The 3px stripe is fixed.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

| Agent types                      | Give them                                        |
| -------------------------------- | ------------------------------------------------ |
| Ant `<Upload fileList onChange>` | `<FileUpload @files @onAdd>`; the caller uploads |
| Ant `customRequest` / `action`   | your own upload, updating `@files`               |
| Ant `maxCount`                   | `@max`                                           |
| Ant `onRemove`                   | `@onRemove`                                      |
| Chakra `<FileUpload.ItemGroup>`  | the built-in list                                |
| react-dropzone `useDropzone`     | the built-in **Dropzone**, or `<:trigger>`       |
