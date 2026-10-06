# HTML preview follows writes to its file

## Goal

An HTML file open in the host (interact stack or code submode preview) shows
the file's current content after any write to it — from the AI assistant, the
code editor, or another client — the same way a card does.

## Problem

`HtmlDef` deliberately keeps no copy of the document source in the index: the
preview fetches the file's bytes at view time and hands them to a sandboxed
iframe as `srcdoc`. `HtmlPreview` made that fetch once, in its constructor.

When the realm indexes a write, the store reloads every loaded `file-meta`
resource the invalidation names, so the `HtmlDef` behind the preview carries
the new `contentHash`. Nothing tied the fetched source to that revision, so the
frame kept rendering the first fetch until the component was torn down.

Markdown and other families whose content is a FileDef field (`content`) render
straight from the reloaded instance and already follow writes.

## Approach

- Drive the source fetch from a modifier on the preview's root element whose
  arguments are the source URL and the FileDef's `contentHash`. The modifier
  reruns whenever either changes, so a reloaded FileDef triggers a refetch.
- Abort the superseded fetch on teardown, and ignore results from an aborted or
  destroyed load.
- Keep the previous source on screen until the new one arrives, so the frame
  doesn't blank during a reload; clear a previous load error on success.
- Fitted cells keep their static summary and never fetch.
- The realm serves file bytes with `cache-control: max-age=0` and an ETag, so a
  refetch revalidates instead of reading a stale cached copy.

## Target files

- `packages/base/file-formats/html-preview.gts`
- `packages/host/tests/acceptance/code-submode/file-def-live-reload-test.gts`

## Testing

Acceptance tests in `Acceptance | code submode | file def live reload`:

- HTML frame updates after a realm write, in code submode and in an interact
  stack. The interact stack keeps the preview component mounted across the
  FileDef reload, so it is the case that exercises the refetch; code submode
  remounts the preview and guards that path.
- HTML source view updates after a realm write.
- Markdown preview in an interact stack updates after a realm write (guards
  the families that render from FileDef fields).
