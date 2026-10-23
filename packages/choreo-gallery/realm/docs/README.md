# Choreo documentation

The long-form documentation for glimmer-motion, Choreo and choreo-player. Each
package's README is its reference: what it exports and how to install it.

- [glimmer-motion](https://github.com/cardstack/boxel/tree/main/packages/glimmer-motion#readme):
  the Motion engine bound to Glimmer, with `{{motion}}`, `<Presence>`,
  `<LayoutGroup>`, drag and reorder
- [@cardstack/choreo](https://github.com/cardstack/boxel/tree/main/packages/choreo#readme):
  `<Choreo>`, its vocabulary and design decisions, and `<Film>`
- [@cardstack/choreo-player](https://github.com/cardstack/boxel/tree/main/packages/choreo-player#readme):
  the headless transport for clocking Choreo runs from outside

## Start here

- [guide.md](guide.md): Choreo from a Glimmer card. How you actually write
  motion in a `.gts` file, in the order you meet the problems.
- [The Choreo guides](guides/README): the guided path through
  glimmer-motion, interactive Choreo, spatial Choreo and Film, with the live
  demos embedded, and a guide for every public API.

## The choreography model

- [choreography.md](choreography.md): the model. A region, its render pass's
  changeset, and the timeline declared over it, plus the boxel-motion lineage
  they descend from.
- [choreo-constructs.md](choreo-constructs.md): the full construct reference.
- [step-vocabulary.md](step-vocabulary.md): the open vocabulary. Anchors,
  composite steps and derived values.
- [nested-choreo.md](nested-choreo.md): regions inside regions, and far
  matching between them.
- [choreo-splices.md](choreo-splices.md): cuts as a first-class part of a score.

## Space and film

- [planes-and-cameras.md](planes-and-cameras.md) and [dom-in-3d.md](dom-in-3d.md):
  a `<Choreo>` region as a plane in a three.js scene.
- [film.md](film.md): the `<Film>` construct, as built.

## External clocks

- [demo-recording.md](demo-recording.md): keeping a demo correct both when
  someone pokes at it and when a recorder clocks it frame by frame.

## Post-mortem

- [postmortem-follow.md](postmortem-follow.md): the engineering post-mortem that
  shaped the derived-value API. It is kept because the mistakes teach more than
  the result.

## Design history

[The design notes](../design/README.md) are the workshop behind these documents:
design records, handoffs, measurements, and the films' scripts. They are drafts
by definition. Some describe things that were proposed and never built, or
built and then changed.
