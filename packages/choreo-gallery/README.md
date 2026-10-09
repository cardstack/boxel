# Choreo gallery

The gallery and documentation site for glimmer-motion and Choreo, authored as
Boxel realm content. Everything in [`realm/`](realm/) is the realm: cards,
their data, and the modules they import. Cards import `glimmer-motion` and
`@cardstack/choreo` like any other card; the host serves both to realms.

The rest of the package is tooling and source material that is not served:
`tools/` (the realm check and the film and widget tools), `scripts/`,
`docs/`, `notes/` and `agent-skills/`.

## The realm

| Path                | What it is                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `realm.json`        | The realm's config.                                                                                                           |
| `index.json`        | The gallery: a `ChoreoGallery` card linking every demo, in the order the gallery shows them.                                  |
| `gallery.gts`       | `ChoreoGallery`. Its isolated format is the whole site; embedded and fitted are a summary.                                    |
| `demo.gts`          | `GalleryDemo`, one gallery entry: its title, group, lede, API pills, usage example, walkthrough and teaching lesson.          |
| `demos/<slug>.json` | One `GalleryDemo` per demo. The catalog is this data.                                                                         |
| `shell/`            | The site's components: the frame, the grid, the demo page, the How panel and the pickers.                                     |
| `stages/<slug>.gts` | A demo's own `GalleryDemo` subclass, supplying its live stage and its notes.                                                  |
| `notes/`            | Each demo's long-form notes (its Deep Dive).                                                                                  |
| `asset/`            | Media the demos load: the films' narration, looks, textures, picture pages, vendored three.js and posters.                    |
| `film-app/`         | The films' own app, built from `packages/choreo-film-app` by `pnpm push`. Not committed.                                      |
| `reel/`             | The feature reel: three demos, live, in one camera'd world under a title, brand and timecode plane. `feature-reel.json`.      |
| `lib/`              | The crossing between the grid and a demo page, tempo and theme preferences, syntax highlighting, and `onstage`/`restWhenOff`. |
| `theme.json`        | The fonts the gallery is set in. The palette is declared by the gallery's root element, `shell/choreo-root.gts`.              |
| `*.test.gts`        | The gallery's tests, run by `boxel test`.                                                                                     |

A demo's stage and its long-form notes are components, not data. A demo that
has them adopts from its own subclass of `GalleryDemo`, in
`stages/<slug>.gts`, which sets `static stage` and `static notes`; its
instance in `demos/` then adopts from that module. A demo without a stage
shows a placeholder.

## The films

Towers, Sagrada and Sylva each run in a document of their own: a three.js
world, a shader post pass and per-beat audio do not share a page with the
gallery. Their sources are `packages/choreo-film-app`, a small app that plays
one film per document. `pnpm push` builds it into `film-app/` before it
pushes the realm, with every script renamed `.mjs`, because the realm compiles
`.js` files as card modules and serves `.mjs` files verbatim. The build is not
committed; anything else that copies the realm (a deploy, say) runs
`pnpm --filter choreo-film-app build:realm` first.

- In the grid a film is a poster (`shell/film-tile.gts`); its play control
  opens the film's page in theater.
- On the demo page, `shell/film-frame.gts` fetches `film-app/index.html` as
  card source and mounts it through `srcdoc`, naming the film on its root
  element. A film's picture page (`asset/towers-model.html`,
  `asset/sagrada-model.html`) reaches the picture the same way.
- Theater brings the stage to the front of the page at the window's height.
  It is state held by the gallery card (or a demo card opened on its own), so
  it never changes the host's URL, and the frame is never re-parented.

CI builds the film app into the realm in the Choreo Film App Tests job, so a
change that breaks that build fails there rather than at deploy.

The film documents load their scripts and media with plain requests, without
the viewer's realm session, so the films play only from a realm everyone can
read. The deployed gallery is publicly readable; give a development realm the
same read permission for `*`.

Moving between the grid and a demo page is state inside the gallery card, so
the site frame's `<Choreo @route>` region sees each move as one render pass
and flies the tile into the page. The gallery never writes the host's URL or
title.

## Developing

Serve the realm from the local stack and push your edits to it.

1. Start the stack from the repository root: `mise run dev-all`.
2. Install the Boxel CLI at the version CI uses:
   `npm install -g @cardstack/boxel-cli@0.8.0-unstable.0`.
3. Sign in to the local stack: `boxel profile add --local`. Use the
   `@user:localhost` test user (`pnpm --filter matrix register-test-user`), or
   any account you have registered locally.
4. Create a realm for the gallery: `boxel realm create choreo-gallery "Choreo"`.
   It prints the realm's URL, such as
   `https://localhost:4201/user/choreo-gallery/`.
5. Push the realm from this package, and push again after each edit:

   ```sh
   pnpm push https://localhost:4201/user/choreo-gallery/ --delete
   ```

   `--delete` removes files you have deleted or renamed locally, so the realm
   mirrors `realm/`. It never deletes the remote `index.json` or `realm.json`.

6. Open `https://localhost:4200/`, choose the realm, and open the Choreo
   gallery card.

## Checks

```sh
pnpm lint   # eslint, template lint, prettier, types, and the realm check
pnpm test   # boxel test realm
```

`pnpm lint:realm` (`tools/check-realm.mjs`) checks the realm's contents
against the libraries it documents:

- `docs/api-inventory.json` names every public export of glimmer-motion,
  Choreo and choreo-player, and every member of the `ChoreoContext` and
  `FilmVocabulary` vocabularies, and maps each to a guide;
- every `demos/*.json` is well formed, `index.json` links exactly that set,
  and each demo has a complete teaching lesson naming a known guide;
- every guide meets the prose floor, has a preamble, and links only to guides
  that exist.

The guides themselves, and the guide pages that embed the demos, are still
`choreo-test-app` sources; the check reads them from there.

Tests that load the gallery's cards from their realm source run in the host
suite, `packages/host/tests/integration/choreo-*-test.gts`, through
`tests/helpers/choreo-gallery.ts`: the films' faces and theater, and the
feature reel under an external clock.

`pnpm test:theater-sizing` checks the film theater's sizing rules in
`choreo-test-app`'s stylesheet.
