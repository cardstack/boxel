# Choreo gallery

The gallery and documentation site for glimmer-motion and Choreo, authored as
Boxel realm content. Everything in [`realm/`](realm/) is the realm: cards,
their data, and the modules they import. Cards import `glimmer-motion` and
`@cardstack/choreo` like any other card; the host serves both to realms.

The rest of the package is tooling that is not served: `tools/` (the realm
check, the published site's check, and the film and widget tools) and
`scripts/` (among them the site's republish). The agent skills for working on the libraries and the
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
| `docs/guides/`      | The Choreo guides, one Markdown file each, with their live demos embedded, and beside each its page, a `Guide` card. `README.md` is the index. |
| `guide.gts`         | `Guide`, a guide's page: the site's frame around the guide's Markdown, with the guides' sections beside it.                                    |
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

Each guide is a Markdown file in `docs/guides/`, and the Markdown is its only
source. A guide embeds its live demo as a card, `::card[../../demos/<slug>]`,
which renders the demo card's embedded format: the stage, what the demo is,
its guide, and its lab. The first-steps guides embed the application they
build the same way, from `studies/`.

A guide is read on its page: a `Guide` card (`guide.gts`) beside the Markdown,
`docs/guides/<slug>.json` for `docs/guides/<slug>.md`, so the page's URL is the
file's without `.md`. The card holds no prose. It links its Markdown file
(`document`) and the index (`index`, `README.md`), and its title and
description are the file's first heading and opening paragraph. The index has
a page too, `docs/guides/README`. The page (`shell/guide-page.gts`) is the
site's frame, whose brand leads back to the gallery, around two columns:

- the guides' sections, read from the index's `## 01 Section` headings and
  `- [Title](slug)` items, with the guide being read marked. On a narrow card
  they fold into a "Guides" button above the guide.
- the guide's Markdown, through base's content-only `MarkdownPreview`, which
  resolves the guide's embeds into live demos and draws none of the host's
  file chrome. The gallery sets its type and palette through the renderer's
  `--markdown-*` properties, in either theme. Code blocks keep a dark surface
  in both, because the renderer sets their text light.

Because the page sits beside its Markdown, the guide's relative links resolve
the same from either: `../../demos/inbox`, `../../widget-room`, `../film.md`.
Guides link one another, and the index, by their pages: `[…](core-layout)`,
not `core-layout.md`, and each guide's last line is its pager, in that form.
A guide's `.md` URL still opens the host's view of the file.

A demo's lesson names its concept guide (`lesson.guide`). `shell/guide-link.gts`
turns that into "Read the guide →", a real link to the guide's page that the
host follows; the grid's tiles, the demo page and the embedded demo all carry
it. A guide's page provides the guide being read
(`CurrentGuideContext`, `lib/guide-index.ts`), and an embedded demo leaves the
link out when it would lead to that page.

The lab is a DialKit panel over the values a demo declares through
`lib/tuning.ts` (`demoTuning(slug)`), opened from the demo page or an embedded
demo. `lib/lab.ts` bridges the two: the panel's controls are the values the
stage registers as it renders, and an edit is written back to
`demoTuning(slug).values`, where the stage reads it. The panel is
`shell/dial-panel.gts`, the one Drift and Hang use, and the demo's authored
looks (`lib/presets.ts`) are its shipped tunes. An edit reaches the stage as
it renders, and motion already running takes the new timing where it is: the
lab calls glimmer-motion's `retime` on every stage showing the demo (each
`DemoStage` carries `data-demo-tuning`), and an edited Choreo timeline
replaces its run, which carries each ambient loop on from the point of its
cycle it had reached. The lab's replay runs the stage from the start.

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

### The published site

`https://choreo.boxel.site/` serves a published copy of the production realm.
The realm's root is the site's root, so a file's path in `realm/` is its path
on the site: the gallery (`index.json`) is `https://choreo.boxel.site/`, a demo
(`demos/towers.json`) is `https://choreo.boxel.site/demos/towers`, and a guide's
page (`docs/guides/<name>.json`) is `https://choreo.boxel.site/docs/guides/<name>`.
The libraries' READMEs, the docs and the guides link to the gallery by these
URLs, and `pnpm lint:realm` checks that each names a file in the realm.

Publishing copies the realm's files into a realm of their own, which indexes
them and renders each card and file to HTML. Everyone can read the copy and
nobody can write it. It changes only when the realm is published again, so an
edit to the realm, or a deploy that updates it, reaches the site at the next
publish.

The account that publishes is `choreo_gallery_writer`, which can write the
gallery realm but doesn't own it. The realm server lets only a realm's owner
publish it, except for the realms listed in its
`PUBLISHED_REALM_DOMAIN_OVERRIDES` environment variable. The variable is a JSON
object from source realm URL to domain, set in production's realm-server
environment outside this repository, and the gallery's entry is:

```json
{ "https://app.boxel.ai/choreo-gallery/": "choreo.boxel.site" }
```

For a realm listed there, any account that can write the realm can publish it
to that domain and no other, and the Publish dialog offers the domain. The
variable stands in for registering a custom domain to a realm, which Boxel
doesn't offer yet. When it does, the gallery moves to that and its entry
goes.

### Republishing

Every production release republishes the site. Once the release is live,
Manual Deploy [boxel] starts a run of
[`republish-choreo-gallery.yml`](../../.github/workflows/republish-choreo-gallery.yml),
which signs in as `choreo_gallery_writer` and runs
[`scripts/republish.sh`](scripts/republish.sh). It reads the writer's password
from the SSM parameter `/<environment>/boxel/choreo_gallery_writer_pw`, through
the `boxel-choreo-republish` AWS role (`configs/boxel-choreo-republish` in
cardstack/infra). That role can read only that parameter, and only a run on
this repository's `main` branch can assume it. The script:

1. waits until the realm has indexed the files the deploy changed;
2. publishes with `boxel realm publish`, which refuses to publish if a gallery
   card depends on a realm not everyone can read, or fails to index;
3. waits until the site's HTML is rendered.

A release republishes even when the gallery didn't change. The copy's cards
import glimmer-motion and Choreo from the host the release deploys, so a copy
left as it was runs its cards against libraries newer than the realm it was
taken from. The republish runs apart from the deploy, so the deploy neither
waits for it nor fails with it, and the next deploy doesn't queue behind it. A
republish that fails leaves the previous copy serving and turns only its own
run red. The script never unpublishes the site.

To republish without a deploy, run "Republish the Choreo gallery" on `main`
from the repository's Actions tab. Or sign in as the writer and run the script
yourself (it needs the Boxel CLI on your `PATH`):

```sh
boxel profile add --user @choreo_gallery_writer:boxel.ai
packages/choreo-gallery/scripts/republish.sh
```

The Publish dialog does the same publish: sign in to `https://app.boxel.ai/`
as `choreo_gallery_writer`, open the gallery realm in Host mode, choose
Publish, and select `choreo.boxel.site`.

Staging's realm is published the same way to
`https://choreo.staging.boxel.build/`, under its own override entry
(`"https://realms-staging.stack.cards/choreo-gallery/": "choreo.staging.boxel.build"`).
No deploy republishes it: staging deploys on every merge, and a full render
of the gallery on each would only add to staging's queue. Republish it by hand
when a change needs trying on a published copy, with the workflow's
`staging` environment or the script:

```sh
boxel profile add --user @choreo_gallery_writer:stack.cards
SOURCE_REALM_URL=https://realms-staging.stack.cards/choreo-gallery/ \
PUBLISHED_REALM_URL=https://choreo.staging.boxel.build/ \
  packages/choreo-gallery/scripts/republish.sh
```

A publish renders every card again when the code that renders them has
changed since the last one, which is the case after every release. Until a
page's new HTML is rendered, the site keeps serving the HTML from the previous
publish. A page that has no HTML yet (every page, on the first publish) is
served as the app alone, which renders the page in the browser once it starts,
under a generic title and with no link preview.

### Checking the site

[`tools/check-published-site.mjs`](tools/check-published-site.mjs) sweeps the
published site in headless Chrome. It reads the published realm's file list, so
it checks whatever the copy holds:

- the grid shows a tile for every demo;
- every demo's URL loads that demo's page, and the lab opens;
- each film's frame plays its first frame;
- each tile opens its demo, and Back returns to the grid;
- the 3D Gallery link opens the widget room, and the room renders;
- every guide's page renders in the site's frame, with the guides' sections,
  its pager and a live demo for each card it embeds, and none of the file
  view's chrome; no embedded demo links back to the guide it is in.

It runs the grid, the demo pages and the guides' index in both the dark and
the light theme. Any
console error, uncaught exception, failed request, or error response from the
site fails the check it happened in, except the platform problems the script
names in `knownIssue` and `knownConsoleIssue`, which it reports as `known:`
lines without failing. Run it after each publish (it needs Chrome installed,
and `pnpm install` for Playwright):

```sh
node packages/choreo-gallery/tools/check-published-site.mjs
node packages/choreo-gallery/tools/check-published-site.mjs --only towers,crossing --themes dark
node packages/choreo-gallery/tools/check-published-site.mjs --json sweep.json
```

It exits 1 when any check fails. `--only` limits it to the named demos (and
skips the grid, the room and the guides), `--themes` to the named themes, and
`--json` also writes the results to a file. The first argument, when given, is
the site to sweep instead of `https://choreo.boxel.site/`.

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
- each guide, and the index, has its `Guide` card beside its Markdown,
  linking only that file and the index;
- every card a doc embeds (`::card[…]`) is a card instance in the realm, and
  every demo has a guide that embeds it;
- `docs/` and `design/` link only to realm files and headings that exist;
- every import written in `docs/`, the guides and the package READMEs names
  an export its package has, so none still reaches Choreo or Film through
  `glimmer-motion` (`design/` sketches APIs that were never built, so its
  imports aren't checked);
- every `choreo.boxel.site` URL names a file in the realm, and every link into
  the monorepo names a file that exists, along with the heading any `#fragment`
  names;
- a realm doc's link to a guide, and any `choreo.boxel.site` URL of one, leads
  to its page, not its `.md` file. A package README's relative link to a guide
  stays on its `.md` file, which is what GitHub can show.

Tests that load the gallery's cards from their realm source run in the host
suite, `packages/host/tests/integration/choreo-*-test.gts`, through
`tests/helpers/choreo-gallery.ts` and `tests/helpers/choreo-gallery-stage.gts`:
every stage rendering on its own, each demo's behaviour, the gallery site and
its crossing between the grid and a demo page, the guides' pages, the films'
faces and theater, and the feature reel under an external clock.
