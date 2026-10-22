# Choreo Documentation Website

> The design of the test app's documentation site, which the gallery realm's
> guides take over. Paths into the test app name it as it was. The tools and
> checks are named where they live now, in `packages/choreo-gallery`; the realm
> check (`pnpm lint:realm`) replaced `docs:check`. [The guides in the gallery
> realm](#the-guides-in-the-gallery-realm) describes how the realm presents
> them.

The guides are part of `test-app`, sharing its brand mark, theme, navigation, and deployment. Open `/docs`; `/docs/:topic_id` is a guide, `/playground/:demo_id` is a live tuning workspace, and `/_widgets` opens the 3D gallery.

## Information Architecture

The library is taught in four sections:

1. **Core glimmer-motion:** element targets, transitions, presence, layout, gestures, accessibility, and tests.
2. **Interactive Choreo:** render-pass changesets, sequencing, destinations, regions, semantic actions, derived motion, and host integration.
3. **Spatial & 3D Choreo:** cameras, live DOM projection, interaction, and gallery design.
4. **Recorded & Film Choreo:** explicit clock ownership, Film graphs, narration, frame capture, and deployment.

These are learning paths, not four npm packages. Imports retain their real names: `glimmer-motion`, `@cardstack/choreo/film`, and `@cardstack/choreo-player`.

## Writing a Guide

The writing reference is [ember-learn/guides-source](https://github.com/ember-learn/guides-source), specifically its [contributor style guide](https://github.com/ember-learn/guides-source/blob/master/CONTRIBUTING.md) and [Component State and Actions](https://guides.emberjs.com/release/components/component-state-and-actions/).

Use a friendly, direct explanation of an observable behavior. Start with the common case, show a small example, then explain the relevant lines. Introduce technical terms when the reader needs them. Open each page with a preamble that explains its purpose before the live example. Each main section starts with Motivation and Learning Goals. Keep a guide focused enough to read in a few screens, and split advanced topics into linked pages. Code blocks show a filename or explicitly identify an excerpt. Use this repository's named exports and `.gts` conventions instead of copying Ember's `.gjs` naming literally.

Source Markdown lives in `test-app/app/content/guides/`. Register introductory pages in `test-app/app/lib/guides.ts` and deeper concept pages in `test-app/app/lib/guide-reference.ts`. The reviewed metadata is recorded in `test-app/app/content/guide-topics.json`. The renderer escapes raw HTML, highlights code with the gallery's existing highlighter, and rewrites internal URLs through Ember's router so hash and subdirectory deployments work.

Use `/docs/<slug>` for guide links, the public catalog ID for demos, and `/_widgets` for the 3D room. Do not assume an example filename is its public route ID. Label proposal-only material clearly; the guides describe implemented behavior.

## Live Demonstrations

A guide mounts its live demo automatically after the opening preamble. Closing it or changing the guide destroys the iframe and its rendering work. The isolated workspace keeps each demo’s variables separate from documentation navigation and from other examples.

Every catalog entry has a workspace. Its DialKit controls are registered where named variables enter that demo’s motion or renderer. The code supplies defaults and ranges; the panel supplies edited values. A spring experiment changes that spring, not unrelated fades or neighboring examples. Replay resets interaction state; Restore demo defaults clears edits. The native editor includes spring curves, direct numeric input, saved versions, and copying.

Motion's `type: 'tween'` and DialKit's `type: 'easing'` are translated at the adapter boundary. Explicit Choreo spring steps stay springs; an easing experiment does not change their step kind. A film's narration and picture clock remain controlled by its own transport. Custom simulation parameters remain in their domain-specific panels.

## Agent Support

The canonical skill is the monorepo's `.claude/skills/choreo-create/SKILL.md`. Invoke `/choreo-create` in Claude Code. It routes agents through the catalog, existing motion-pattern skills, composition recipes, live tuning, and recording verification. Card authors working in a realm use boxel-skills' `card-motion` skill instead.

## Local Development and Build

```sh
pnpm build
pnpm --filter test-app exec vite --host 0.0.0.0 --port 4592
```

For a portable subdirectory build:

```sh
APP_BASE=./ APP_LOCATION=hash pnpm --filter test-app build
```

Publish the complete build and required static media using the chosen host. Do not embed private realm URLs, account identifiers, or credentials in the guide manifest or skill.

## API Coverage and Depth

`packages/choreo-gallery/tools/api-inventory.json` maps the exported names and yielded vocabulary members to their concept guides. Each registered guide has at least 300 explanatory prose words, excluding code and API tables. Related aliases and supporting types share their behavior chapter. `packages/choreo-gallery/tools/check-realm.mjs` compares the inventory with the packages' exports and checks depth, preambles, section goals, and internal guide links. Run `pnpm lint:realm` in `packages/choreo-gallery` after an API or documentation change.

The inventory appears at `/docs/core-api-inventory`. Keep it synchronized when adding a public API. Do not automatically map a new export to a broad introduction simply to satisfy the check: review whether its concept needs a dedicated treatment.

The demonstration and native DialKit editor share a bounded workspace. Desktop layouts keep them side by side; narrow layouts retain the preview above an independently scrolling editor. The embedded document itself does not scroll. Only variables consumed by the current demo appear in its panel. Numeric names include units; labels and formatted values have separate space. Shared spring constants remain shared across the states that use them.

## Binding a Demo Variable

Declare the variable at the point where the example consumes it. The workbench discovers that binding and renders its DialKit input. Keep defaults in the example, not in a generic panel schema.

```ts
const peakScale = tuneNumber('keyframes', 1.14, 'peakScale (×)', 0.5, 2, 0.01);
const lift = tuneNumber('keyframes', 28, 'lift (px)', 0, 80, 1);
return { scale: [1, 0.82, peakScale, 1], y: [0, -lift, 10, 0] };
```

Use the same binding name wherever the same source variable is shared. Use distinct names for independent springs. Read these values in a getter, template helper, or the actual simulation update; a one-time module snapshot will not respond to edits. Native simulation controls such as Drift and Hang use their existing tracked Dial stores. Long Take’s two camera regions share one `shotTempo` variable, preserving their timing relationship.

Timing-only edits use the workbench’s `live-demo-motion.ts` adapter after
Glimmer’s `postRender` hook. It retimes the existing Motion visual elements
and preserves repeating animations’ phase; it does not remount the demo.
Run `node packages/choreo-gallery/tools/check-demo-live-controls.mjs` against the dev server to
verify live duration and target edits, DOM identity, and compact control rows.

Each catalog demo includes two authored looks in DialKit’s Versions menu.
`demo-presets.ts` maps each look to explicit demo variable names and values.
Version 1 restores the source defaults; choosing a look keeps the demo mounted.
Add presets only after their variables are registered, and keep all numeric
values inside their declared ranges. Run `node packages/choreo-gallery/tools/check-demo-presets.mjs`
against the development server to exercise both looks and restoration.

Teaching coverage is tracked in `test-app/app/content/demo-lessons.json`. Each
catalog example has a concept explanation, an experiment, a pitfall, a composition
idea and a concept-guide link. The shared GuideDemo renders these beside the
example code. Seven focused walkthroughs are registered in `demo-guides.ts`.
`pnpm lint:realm` verifies that all catalog examples remain embedded and have complete
teaching records; prose correctness still requires source review.

[docs-studies-plan.md](docs-studies-plan.md) specifies the planned docs-only spatial and film
studies. Keep these separate from shipped demo coverage until implemented.
The 3D room and its tile frames force a dark palette without overwriting the
visitor’s saved theme. `packages/choreo-gallery/tools/check-guide-lessons.mjs` checks real embedded
controls and this gallery theme behaviour against the development server.

## Complete tutorials

`core-first-app`, `spatial-first-scene`, and `film-first-export` embed the standalone
components from `test-app/app/components/tutorials/`. The app generator copies
those exact sources; they must not import gallery-specific services or styles.
`core-troubleshooting` records integration failures and their diagnostic checks.
Run the generated consumer's build and type check, then use
`packages/choreo-gallery/scripts/verify-tutorials.mjs` against its server.
`record-tutorial.mjs` renders and probes a complete 1080p60 MP4 with local cue audio.
Keep generated apps and output media outside the source tree.

## The guides in the gallery realm

The gallery realm keeps the site's brand mark, theme and navigation for its
guides. Each guide is still Markdown, `docs/guides/<slug>.md`, and is read on
its page: a `Guide` card beside the file, at the file's URL without `.md`
(`https://choreo.boxel.site/docs/guides/core-start`). The index,
`docs/guides/README.md`, has a page of its own at `docs/guides/README`.

- **Frame and brand.** The page wears the gallery's site frame: the Choreo
  mark and name, which lead back to the gallery, the theme picker, the 3D
  Gallery and GitHub links, and the licence. It follows the visitor's theme,
  dark or light, like every gallery page.
- **Navigation.** Down the side are the four sections, in the index's order,
  each listing its guides, with the guide being read marked and scrolled into
  view. "← Gallery" and "All guides" head the list. On a narrow card the list
  folds into a "Guides" button above the guide.
- **The guide.** The Markdown renders through base's content-only renderer,
  set in the gallery's type: Syne headings, IBM Plex Sans text, IBM Plex Mono
  code, copper links. It carries no file chrome (no file name, badge, Download
  or Copy link). Code blocks keep a dark surface in either theme.
- **Live demos.** A guide's `::card[…]` embeds render the demo cards live, with
  their labs. A demo embedded in the guide its lesson names leaves out "Read
  the guide →", which would lead back to the page.
- **Moving on.** Each guide ends on its pager, previous · All guides · next, in
  the index's order. Guides link one another by their pages
  (`[…](core-layout)`), and `pnpm lint:realm` refuses a link to a guide's `.md`
  file.

The page's title and description are the guide's first heading and opening
paragraph, so the published site's HTML names each guide and previews it when
shared.
