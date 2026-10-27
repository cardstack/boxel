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
2. Otherwise prevents the default navigation and reads the file through
   `fetchRealmFile`, the authenticated read the media and HTML previews share:
   `credentials: 'same-origin'` (the auth service worker attaches the realm
   token) and `Accept: application/vnd.card+source`, so a `.gts`/`.ts`/`.js`
   file comes back as written rather than transpiled.
3. Saves the response by clicking a temporary anchor pointing at a `blob:`
   object URL with the link's `download` name (or the URL's last path segment
   for a nameless file), then revokes the object URL.
4. Reports each download's state to the component that owns the link, which
   renders it in the label: "Downloading…" while the bytes arrive, "Retry
   download" after a failure, announced through `aria-live`. Repeat clicks
   while a download is in flight are ignored, and tearing the link down aborts
   the fetch.

## Target files

- `packages/base/file-formats/file-presentation.gts` — the shared modifier.
- `packages/base/file-formats/file-shell-isolated.gts` — header Download.
- `packages/base/file-formats/file-preview-stage.gts` — fallback pane Download.

## Testing

Host integration test in
`packages/host/tests/integration/components/file-def-format-templates-test.gts`:
render an isolated file whose `url` is a fetchable `blob:` URL, click
Download, and assert the save is handed a `blob:` object URL carrying the
file's name and its bytes; render one whose `url` can't be fetched and assert
the link offers a retry.
