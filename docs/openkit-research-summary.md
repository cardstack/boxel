# openkit — competitive research summary

Condensed from `docs/openkit-design-brief.md` (595 lines). Four reference
libraries studied, plus a component-level overlay of `@cardstack/boxel-ui`
against `react-bits`.

**What openkit is:** layer 03 of the Atlas Slice — the UI library that `iso`,
`northwind`, `ledgerworks` and `acme` all render through. It ships real Glimmer
components **as a Deck pack** (versioned, pinned, served from
`<realm>/_packages/`), _not_ as an Ember addon. That is the whole point: a
build-time library gives every card on a host exactly one version forever;
openkit gives each consumer the version they pinned.

---

## The four references

### 1. Beautiful UI — _"crafted primitives for AI-native interfaces"_

Twenty components. Take four things:

- **Depth by hairline + shadow, never by contrast.** Six surface steps inside 26
  values of grey. Every elevation token _begins_ with a 1px spread shadow
  (`0 0 0 1px var(--line), …`), so border and elevation are one property.
  Nothing sets `border`. Raising a surface can never leave its outline behind.
- **The chip recipe.** Caller supplies one hue; everything derives:
  `background: color-mix(in srgb, var(--hue) 14%, var(--surface))`,
  `color: color-mix(in srgb, white 16%, var(--hue))`, dot stays pure. Contrast
  holds because the ink is derived from the same hue rather than picked.
  (Reverse-engineered from rendered pixels, not guessed.)
- **Machine values get an inline code-pill.** Ids, enums, parameters as small
  accent-tinted monospace pills _inside ordinary prose_. Makes the prose/data
  boundary legible without a table.
- **Discrete segments beat continuous meters.** Confidence as ▮▮▮ beside "High
  confidence", not a percentage. Reads at a glance, survives greyscale,
  degrades to its text label.

Typography is Inter, body 14/21, headings 19/600 at `-0.02em`. The tight
negative tracking is most of the look and costs one declaration.

**Don't take:** it is dark-only with baked hexes; tag hues are hardcoded per
row; the AI framing. The primitives underneath are the value.

### 2. motion-primitives (MIT) — techniques only, nothing importable

React + Framer Motion + Tailwind + Radix. Two techniques worth real work:

- **The odometer.** Each digit is a `1ch` window with the ten digits stacked and
  sprung. The quality is one line: `if (offset > 5) memo -= 10 * height` — every
  digit takes the **shortest path around the 0–9 ring**, so 9→0 rolls forward by
  one instead of backwards through nine. Ten lines, and it's the difference
  between "nice" and "correct". Reimplementable with `translateY` + a transition.
- **The sliding highlight.** _One_ highlight element with a shared `layoutId`, so
  the indicator _travels_ between positions instead of cross-fading. ~15 lines
  dependency-free: absolutely-positioned element driven from the active item's
  `offsetLeft`/`offsetWidth`.

**Leave:** `tilt`, `magnetic`, `dock`, `spotlight`, `glow-effect`,
`spinning-text`. All decoration, and all invisible in a screenshot — which is
where most components are actually judged.

> **THE MOTION RULE:** motion is allowed where it encodes a state transition the
> reader would otherwise have to infer. It is forbidden where it merely
> decorates. A number that rolled tells you it changed and which way. A
> highlight that slid tells you where selection came from. A card that tilts
> tells you nothing.

Everything surviving that test goes behind `prefers-reduced-motion: reduce`,
with the **end state** as the fallback — never a frozen midpoint.

_Convenient consequence:_ motion is close to the ideal **minor version** —
additive, unmistakably visible, changes no field and no contract. And two pinned
versions on one page, one sliding and one snapping, demonstrates per-consumer
versioning better than two shades of a chip.

### 3. fancy components — the prop surface is the lesson

The components are weird (a typewriter that types, deletes, retypes). The **API
discipline** is the takeaway: typing and deleting are _separate_ rates because
they read differently; the cursor is a _slot_ accepting an arbitrary node, not a
character; the blink is caller-definable; every timing knob is named and
separately settable; defaults are good enough that none is required. Most
libraries would have shipped `speed` and stopped.

They also document what they _haven't_ got right ("ideally the component should
respect multiple lines"). Naming an unfinished edge in the docs is worth copying.

### 4. Paper Shaders — the one that could actually be vendored

~30 zero-dependency WebGL effects. **The important word is zero-dependency:** a
framework-agnostic core with a React wrapper on top. Everything in refs 2 and 3
must be reimplemented; _this can be pinned_. First candidate for the vendoring
path Deck already supports.

**For texture and atmosphere only** — never anything carrying information. A
shader is unreadable, unindexable and invisible to a screen reader. This sits
_outside_ the motion rule rather than violating it: that rule governs motion
that encodes state, and texture is not that. Allowed where nothing is being
communicated — empty states, backgrounds, chrome.

---

## Foundations: vendor the engines, not the wrapper

Could openkit take a literal dependency at the bottom, the way three.js is
vendored? **Yes — but not on react-bits.**

`react-bits` is 330 `.jsx`/`.tsx` files and one plain `.js`. All four of its
"variants" are React. Taking it means shipping React + react-dom into every card
that renders a Boxel field, to run components Glimmer cannot render anyway.

**But react-bits is a _wrapper library_** — almost nothing in it is original
capability. Its dependency list reads as a shopping list of exactly what openkit
wants, and the useful half is framework-free:

| Vendorable | `gsap` (timelines) · `ogl` (small WebGL) · `three` (3D) · `matter-js` (2D physics) · `lenis` (smooth scroll) · `gl-matrix`/`maath`/`mathjs` · `meshline`/`postprocessing` · `motion` **vanilla core** |
| Unusable | `@react-three/fiber`, `@react-three/drei`, `@use-gesture/react`, `lucide-react`, `sonner` |

So openkit gets react-bits' capabilities **not by depending on react-bits but by
depending on what react-bits depends on**, and writing the wrappers in Glimmer —
structurally the identical job, aimed at a different renderer. Paper Shaders
falls in the same category: vendor the core, skip the wrapper.

This also makes the slice's dependency graph genuinely deep, and the last hop
crosses from realm-authored packages into vendored npm:

```
acme/rfq-to-payment → ledgerworks/billing-kit → northwind/records
                    → openkit/motion          → lib/gsap@3.13.0  (vendored npm)
                    → openkit/texture         → lib/ogl@1.0.11   (vendored npm)
```

---

## The mandate: re-cover boxel-ui's territory, unbound from its legacy

openkit is **not a supplement** to `@cardstack/boxel-ui`. It covers the same
ground with a superset of features while owing nothing to how boxel-ui got
there. boxel-ui's 57 components are the **coverage floor**.

"Unbound from the legacy" = re-cover the _territory_, not the _API_. No
inherited names, no inherited argument shapes, no assumed build step, no
addon packaging. Where boxel-ui has three ways to render a fitted card, openkit
has one that adapts. Where it has `pill` and `tag` doing nearly the same job,
openkit has `<Chip>`.

**The gaps the references make obvious:** `<DataGrid>` (there is kanban and
filter-list but no records table — the most common data surface there is) ·
`<Token>` · `<Meter>` · `<Odometer>` · `<Chip>` with a _derived_ hue · `<Panel>`
with an action-bar convention · `<StreamingText>` · `<CommandPalette>` ·
`openkit/texture`.

The point is not "more components". It is that a versioned, per-consumer-pinned
library **can** be re-cut this way and a build-time addon cannot — boxel-ui's
shape is frozen by the fact that changing it changes it for everybody at once.
openkit gets to be opinionated precisely because a consumer who disagrees can
stay on the version they liked.

---

## boxel-ui ∩ react-bits — what the bottom layer must carry

react-bits ships 165 components (Animations 36, Backgrounds 53, Components 44,
TextAnimations 32). boxel-ui ships 57. **The overlap is small, and that is the
finding:** boxel-ui is a _forms-and-data_ library, react-bits is a
_motion-and-spectacle_ library. They meet in about a dozen places.

1. **Twelve foundation components** need _both_ a data contract and an
   expressive range — Button, Menu/Nav, Card surface, Grid/collection,
   Disclosure, Text input, Choice, Numeric display, Pending state, Label/chip,
   Reorder/drag, plus Stepper and Carousel (absent from boxel-ui outright).
   In every row the boxel-ui column is the **contract** and the react-bits
   column is a **menu of treatments**. openkit ships one component per row whose
   API is the contract and whose appearance is a choice.
2. **About twenty more are pure obligation** — `alert`, `tooltip`,
   `field-container`, `date-range-picker`, `color-picker`, `radio-input`,
   `switch`, `modal`, `avatar`, `broken-link`… No reference design, no glamour,
   used constantly. Cannot be deferred to a "polish" pass: they are where
   openkit is judged on whether an ordinary form is pleasant to fill in.
3. **The other ~150 are a menu, not a checklist** — strictly opt-in, and the
   reason the vendored-engine question was worth asking.
4. **`<Select>` is first.** It sits in the intersection, has no vendorable
   dependency, and is the component the per-consumer-versioning argument is
   about.

---

## Package split — load-bearing, not tidy

| Package              | Vendored deps                                                                |
| -------------------- | ---------------------------------------------------------------------------- |
| `openkit/structures` | none — chips, panels, grids are CSS                                          |
| `openkit/controls`   | none — the select is DOM and ARIA                                            |
| `openkit/motion`     | `lib/motion` vanilla core; `lib/gsap` only if timelines are genuinely needed |
| `openkit/texture`    | `lib/paper-shaders` or `lib/ogl`                                             |

**The two components that matter most — `<Select>` and `<Chip>` — take no
vendored dependency at all.** The foundation must be reachable without a
runtime, and weight must be opt-in at the _package boundary_. A monolithic UI
library cannot make that offer; a multi-package publisher can.

## Theming — mapped onto Boxel, not baked

Every reference is dark-only with fixed hexes. openkit expresses its ladder
against Boxel's semantic variables instead: `--ok-surface` → `--card`,
`--ok-ink` → `--foreground`, `--ok-line` → `--border`, `--ok-ring` → `--ring`,
and **status hues → `--chart-1 … --chart-5`** — the only palette Boxel
guarantees to be _mutually distinguishable and theme-supplied_, so a chip stays
legible under a theme openkit has never seen.

## Open questions

1. **Light theme.** Every reference is dark. The `color-mix` recipe inverts
   cleanly (mix toward black rather than white for the ink) but the crossover
   wants a real decision, not an automatic flip.
2. ~~How much motion.~~ Settled by reference 2.
3. **Where the odometer lives.** `<Odometer>` is an openkit component, but the
   money field is in `cardstack/contracts` one layer _below_ openkit — and layer
   02 must not depend on layer 03. Either money ships its own rolling display
   (duplication), or the odometer is a contracts-layer primitive openkit
   re-exports (inversion), or money simply does not roll. **This is the first
   genuine layering conflict the slice has produced, and exactly the kind of
   thing a six-publisher graph exists to surface** — in a single-publisher
   design it would have been settled by moving a file.
