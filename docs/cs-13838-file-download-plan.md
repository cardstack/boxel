# CS-13838 — File "Download" button fails

## Problem

The isolated file shell's **Download** button (and the generic fallback pane's
download link) is a plain `<a href={{url}} download={{name}}>`. The browser
fetches that URL as a download navigation, and the realm server answers it
with neither the file nor a usable error:

- With a navigation `Accept` header (`text/html,…`) the realm serves the host
  app shell, not the file bytes.
- Without an `Authorization` header a private realm answers `401`, which
  Chrome reports as "File wasn't available on site".
- When the realm is on a different origin from the host, the `download`
  attribute is ignored and the click navigates instead.

## Approach

Keep the anchor (so its `href`/`download` remain for copy-link, middle-click
and assistive tech) and add a click modifier that:

1. Lets modified clicks (meta/ctrl/shift/alt, non-primary button) through.
2. Otherwise prevents the default navigation and `fetch`es the URL with
   `credentials: 'same-origin'`, the same authenticated path the media and
   HTML previews use (the auth service worker attaches the realm token, and
   the default `Accept: */*` gets the file bytes).
3. Saves the response by clicking a temporary anchor pointing at a `blob:`
   object URL with the same `download` name, then revokes the object URL.
4. Marks the link `aria-busy` while the fetch is in flight and ignores repeat
   clicks; on failure logs the error and leaves the page unchanged.

## Target files

- `packages/base/file-formats/file-presentation.gts` — the shared modifier.
- `packages/base/file-formats/file-shell-isolated.gts` — header Download.
- `packages/base/file-formats/file-preview-stage.gts` — fallback pane Download.

## Testing

Host integration test in
`packages/host/tests/integration/components/file-def-format-templates-test.gts`:
render an isolated file whose `url` is a fetchable `blob:` URL, click
Download, and assert the save is handed a `blob:` object URL carrying the
file's name and its bytes.
