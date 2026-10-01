# Deploy the gallery to Boxel Site

This workflow uses your own Boxel account and source realm. No account, realm ID,
published demo URL, or credential is embedded in the repository. Obtain the
published site URL assigned to your realm through Boxel's publishing UI; do not
construct a URL from an account name or assume a particular hostname.

## Build a standalone release

From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
APP_BASE=./ APP_LOCATION=hash pnpm --dir test-app exec vite build --outDir ../out/widget-boxel-build
node scripts/package-widget-boxel.mjs
```

Output is `out/widget-boxel-publish/iframe/gallery/`. `WIDGET_BUILD` selects
another build directory; `WIDGET_PACKAGE` selects another package directory.
The package includes posters, narration, fonts, models, and demo dependencies.
Use a fresh output directory per release to avoid uploading stale chunks.

The packager preserves raw browser modules as `.mjs` because Boxel processes
`.js` realm modules. It also rewrites Draco loader filenames and embeds a
same-origin document bridge for Sagrada and Towers. Hash routing keeps nested
demos inside the published directory. These steps are required, not optional
minification or performance tweaks.

## Authenticate, inspect, and upload

Install the `@cardstack/boxel-cli` version supported by your Boxel deployment,
then authenticate with `boxel profile add` (browser sign-in). Switch to the
intended profile with `boxel profile switch` when using multiple environments.
Credentials remain in the CLI's local profile storage.

Set `BOXEL_SOURCE_REALM` to your source realm URL using your shell or local
secret configuration; do not commit its value. Inspect the files first:

```sh
node scripts/publish-widget-boxel.mjs --dry-run
node scripts/publish-widget-boxel.mjs
```

`BOXEL_CLI` optionally selects the CLI executable. `WIDGET_UPLOAD_ROOT` selects
the local upload tree (default `out/widget-boxel-publish`). Paths under this tree
become realm-relative paths. The uploader writes only those files, uploads HTML
last, and does not delete other content. A repeated upload replaces files at the
same paths; use a versioned release subdirectory when you need rollback.

If delivering a rendered MP4, place it under the upload tree's `media/` directory
before upload. Keep the source render outside Git.

## Publish and verify

Set `BOXEL_PUBLISHED_REALM` to the published site URL assigned by Boxel, then:

```sh
boxel realm indexing-errors --realm "$BOXEL_SOURCE_REALM"
boxel realm publish "$BOXEL_SOURCE_REALM" "$BOXEL_PUBLISHED_REALM"
```

Use the CLI's readiness/publishability checks. Do not bypass them with `--force`.
For CLI versions without `realm publish`, use Boxel's publishing UI instead.
Publishing a realm publishes its contents; choose a realm intended for sharing.

The gallery's path relative to the published root is:

```text
iframe/gallery/widget-room.html?acceptHeader=application%2Fvnd.card%2Bsource&film=1#/_widgets
```

A video path uses `?acceptHeader=video%2Fmp4`. The accept-header query ensures
that a browser receives the HTML or video rather than the card viewer.

Check the gallery anonymously on desktop and phone, confirm all posters load,
play consecutive full-tour clips, inspect Mockup in 3D, and run the freeze and
handoff checks against the published gallery URL. For MP4 delivery, verify
metadata, playback, seeking, and HTTP byte-range responses. The HTML has
`noindex,nofollow,noarchive`; an unlisted URL is still public to anyone who has it.
