# Choreo gallery

The gallery and documentation site for glimmer-motion and Choreo, authored as
Boxel realm content. Everything in [`realm/`](realm/) is the realm: cards,
their data, and the modules they import. Cards import `glimmer-motion` and
`@cardstack/choreo` like any other card; the host serves both to realms.

The rest of the package is tooling that is not served: `tools/` (the realm
check and the film and widget tools) and `scripts/`. The agent skills for working on the libraries and the
gallery are in the monorepo's `.claude/skills/` (`motion-pattern` routes to
the rest).

## The realm

| Path                | What it is                                                                                                                                     |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `realm.json`        | The realm's config.                                                                                                                            |
| `index.json`        | The gallery: a `ChoreoGallery` card linking every demo, in the order the gallery shows them.                                                   |
| `gallery.gts`       | `ChoreoGallery`. Its isolated format is the whole site; embedded and fitted are a summary.                                                     |
| `demo.gts`          | `GalleryDemo`, one gallery entry: its title, group, lede, API pills, usage example, walkthrough and teaching lesson.                           |
| `demos/<slug>.json` | One `GalleryDemo` per demo. The catalog is this data.                                                                                          |
| `shell/`            | The site's components: the frame, the grid, the demo page, the How panel and the pickers.                                                      |
| `stages/<slug>.gts` | A demo's own `GalleryDemo` subclass, supplying its live stage and its notes.                                                                   |
| `notes/`            | Each demo's long-form notes (its Deep Dive).                                                                                                   |
| `docs/`             | The long-form documentation, as Markdown: the guide, the choreography model, the construct reference, Film. `docs/README.md` indexes it.       |
| `docs/guides/`      | The Choreo guides, one Markdown file each, with their live demos embedded. `docs/guides/README.md` indexes them in reading order.              |
| `study.gts`         | `GuideStudy`, the small application a first-steps guide builds. `studies/<name>.gts` supplies each one; `studies/<name>.json` is its instance. |
| `design/`           | Design history: design records, handoffs, measurements, and the films' scripts. Drafts by definition.                                          |
| `licenses/`         | Attribution for third-party material the demos use.                                                                                            |
| `asset/`            | Media the demos load: the films' narration, looks, textures, picture pages, vendored three.js and posters.                                     |
| `film-app/`         | The films' own app, built from `packages/choreo-film-app` (see [The films](#the-films)). Not committed.                                        |
| `reel/`             | The feature reel: three demos, live, in one camera'd world under a title, brand and timecode plane. `feature-reel.json`.                       |
| `lib/`              | The crossing between the grid and a demo page, tempo and theme preferences, syntax highlighting, and `onstage`/`restWhenOff`.                  |
| `theme.json`        | The fonts the gallery is set in. The palette is declared by the gallery's root element, `shell/choreo-root.gts`.                               |
| `*.test.gts`        | The gallery's tests, run by `boxel test`.                                                                                                      |

A demo's stage and its long-form notes are components, not data. A demo that
has them adopts from its own subclass of `GalleryDemo`, in
`stages/<slug>.gts`, which sets `static stage` and `static notes`; its
instance in `demos/` then adopts from that module. A demo without a stage
shows a placeholder.

## The guides and the lab

Each guide is a Markdown file in `docs/guides/`, and the host renders it as
any Markdown file in a realm. A guide embeds its live demo as a card,
`::card[../../demos/<slug>]`, which renders the demo card's embedded format:
the stage, what the demo is, its guide, and its lab. The first-steps guides
embed the application they build the same way, from `studies/`.

A demo's lesson names its concept guide (`lesson.guide`). `shell/guide-link.gts`
turns that into "Read the guide →", a real link to the guide's file that the
host follows; the grid's tiles, the demo page and the embedded demo all carry
it.

The lab is a DialKit panel over the values a demo declares through
`lib/tuning.ts` (`demoTuning(slug)`), opened from the demo page or an embedded
demo. `lib/lab.ts` bridges the two: the panel's controls are the values the
stage registers as it renders, and an edit is written back to
`demoTuning(slug).values`, where the stage reads it. The panel is
`shell/dial-panel.gts`, the one Drift and Hang use, and the demo's authored
looks (`lib/presets.ts`) are its shipped tunes. An edit reaches the stage as
it renders; motion already running keeps its timing until the demo moves
again, and the lab's replay runs the stage from the start.

## The films

Towers, Sagrada and Sylva each run in a document of their own: a three.js
world, a shader post pass and per-beat audio do not share a page with the
gallery. Their sources are `packages/choreo-film-app`, a small app that plays
one film per document. `pnpm push` builds it into `film-app/` before it
pushes the realm, with every script renamed `.mjs`, because the realm compiles
`.js` files as card modules and serves `.mjs` files verbatim. The build is not
committed: the realm-server image builds it into the realm before a deploy
copies the realm, and the local stack builds it when `film-app/` is absent.
`pnpm --filter choreo-film-app build:realm` rebuilds it.

- In the grid a film is a poster (`shell/film-tile.gts`); its play control
  opens the film's page in theater.
- On the demo page, `shell/film-frame.gts` fetches `film-app/index.html` as
  card source and mounts it through `srcdoc`, naming the film on its root
  element. A film's picture page (`asset/towers-model.html`,
  `asset/sagrada-model.html`) reaches the picture the same way.
- The page's stage shows the film's poster under the frame. The frame stays
  clear until the film posts `choreo-film:first-frame` to the page
  (`choreo-film-app`'s `lib/first-frame.ts`), so the film fades in over a
  still of itself. When the page leaves, the frame is taken down a frame
  ahead of the crossing and the poster is what flies back to the tile:
  moving an iframe reloads it, and the crossing moves what leaves.
- Theater brings the stage to the front of the page, edge to edge across the
  card and as tall as what the viewer can see of it (the element that scrolls
  the card, which in the host sits under the host's chrome and the card's
  header). The stage glides between its page box and its theater box. Theater
  is state held by the gallery card (or a demo card opened on its own), so it
  never changes the host's URL, and the frame is never re-parented.

CI builds the film app into the realm in the Choreo Film App Tests job, so a
change that breaks that build fails there rather than at deploy.

The film documents load their scripts and media with plain requests, without
the viewer's realm session, so the films play only from a realm everyone can
read. Chrome hands a `srcdoc` frame to the host's auth service worker, which
adds the session, so a private realm can appear to work there; Firefox does
not, and the frame says the realm must be publicly readable. The deployed
gallery is publicly readable; give a development realm the same read
permission for `*`.

Moving between the grid and a demo page is state inside the gallery card, so
the site frame's `<Choreo @route>` region sees each move as one render pass
and flies the tile into the page. The gallery never writes the host's URL or
title.

## Where it's served

The realm server mounts `realm/` as the realm `choreo-gallery`:

| Environment | URL                                                  |
| ----------- | ---------------------------------------------------- |
| Production  | `https://app.boxel.ai/choreo-gallery/`               |
| Staging     | `https://realms-staging.stack.cards/choreo-gallery/` |
| Local       | `https://localhost:4201/choreo-gallery/`             |

Each deploy copies `realm/` onto the realm's disk with `rsync --delete`
(`setup:choreo-gallery-in-deployment` in `packages/realm-server`), so git is
the realm's source of truth: staging follows `main`, production follows each
production deploy, and an edit made in the app lasts only until the next
deploy. The service account `choreo_gallery_realm` owns the realm,
`choreo_gallery_writer` can read and write it, and everyone can read it.

## Developing

The local stack (`mise run dev-all` from the repository root) serves `realm/`
itself at `https://localhost:4201/choreo-gallery/` and reindexes files as you
save them. Set `SKIP_CHOREO_GALLERY=true` to leave it out of the stack.

To work on a copy in a realm of your own instead, push the realm to it:

1. Start the stack from the repository root: `mise run dev-all`.
2. Install the Boxel CLI at the version CI uses:
   `npm install -g @cardstack/boxel-cli@0.9.0-unstable.1`.
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

- `tools/api-inventory.json` names every public export of glimmer-motion,
  Choreo and choreo-player, and every member of the `ChoreoContext` and
  `FilmVocabulary` vocabularies, and maps each to a guide;
- every `demos/*.json` is well formed, `index.json` links exactly that set,
  and each demo has a complete teaching lesson naming a known guide;
- every guide meets the prose floor and has a preamble, the guides' index
  lists each guide once, and each guide's pager names its neighbours in it;
- every card a doc embeds (`::card[…]`) is a card instance in the realm, and
  every demo has a guide that embeds it;
- `docs/` and `design/` link only to realm files and headings that exist;
- every import written in `docs/`, the guides and the package READMEs names
  an export its package has, so none still reaches Choreo or Film through
  `glimmer-motion` (`design/` sketches APIs that were never built, so its
  imports aren't checked);
- every `choreo.boxel.site` URL names a file in the realm, and every link into
  the monorepo names a file that exists, along with the heading any `#fragment`
  names.

Tests that load the gallery's cards from their realm source run in the host
suite, `packages/host/tests/integration/choreo-*-test.gts`, through
`tests/helpers/choreo-gallery.ts` and `tests/helpers/choreo-gallery-stage.gts`:
every stage rendering on its own, each demo's behaviour, the gallery site and
its crossing between the grid and a demo page, the films' faces and theater,
and the feature reel under an external clock.
