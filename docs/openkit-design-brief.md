# openkit — design brief

What `openkit` looks like and why. Gleaned from reference designs rather than
invented, then mapped onto Boxel theme variables so a card using openkit still
obeys the theme it is rendered inside.

`openkit` is layer 03 of the Atlas Slice — the third-party UI library that
`iso`, `northwind`, `ledgerworks` and `acme` all render through. It ships real
Glimmer components as a Deck pack (versioned, pinned, served from
`/_packages/`), **not** as an Ember addon. That distinction is the point: a
build-time library gives every card on a host exactly one version forever;
openkit gives each consumer the version they pinned.

---

## Reference 1 — Beautiful UI (beautiful-ui-five.vercel.app)

_"Crafted primitives for AI-native interfaces."_ Twenty components: Loading
State, Thinking, Streaming Text, Approval Card, Tool Chips, Task Rows, Chat,
Prompt Bar, Recommendation Card, Context Cards, Diff Table, Records Table,
Filter Table, Sidebar Nav, Search, Insight Cards, Code Block, Fine-tune Card,
Selection Actions.

### What is actually good about it

**1. Depth by hairline and shadow, never by contrast.**

Their surface ladder spans a startlingly narrow range — `#17181a` → `#1c1d1f` →
`#1f2022` → `#232427` → `#2a2b2e` → `#313236`. Six steps inside twenty-six
values of grey. Nothing separates by being much lighter than its neighbour;
separation comes entirely from a 1px hairline and a soft shadow.

The mechanism is the good part: **every elevation token begins with a
1px spread shadow**, so the border and the elevation are one property.

```css
--shadow-hairline: 0 0 0 1px var(--line);
--shadow-btn: 0 0 0 1px var(--line-strong), 0 1px 2px rgb(0 0 0 / 0.3);
--shadow-card:
  0 0 0 1px var(--line), 0 1px 2px rgb(0 0 0 / 0.2), 0 2px 6px rgb(0 0 0 / 0.2);
--shadow-raised: 0 0 0 1px var(--line), 0 2px 10px rgb(0 0 0 / 0.22);
--shadow-overlay: 0 0 0 1px var(--line-strong), 0 8px 28px rgb(0 0 0 / 0.34);
--shadow-inset: inset 0 1px 2px rgb(0 0 0 / 0.38);
```

Nothing in the design sets `border`. Raising an element one step means swapping
one token, and the outline follows automatically — which is why their surfaces
never drift out of step with their borders. Worth stealing outright.

**2. The chip recipe: one hue in, a complete chip out.**

Their record tags set a single inline custom property and derive everything
else from it:

```html
<span class="records-tag" style="--tag-color:#9a5cff">
  <span class="records-tag-dot"></span>Gelato
</span>
```

Working backwards from the computed values, the two derivations are exactly:

```css
background: color-mix(in srgb, var(--tag-color) 14%, var(--surface));
color: color-mix(in srgb, white 16%, var(--tag-color));
```

(Verified against three channels of a rendered tag, not guessed.) The dot stays
the pure hue. So a caller supplies **one colour** and gets a tinted surface, a
readable lightened ink, and a solid indicator — with contrast that holds because
the ink is derived from the same hue rather than picked independently.

Geometry: `padding: 0 7px`, `radius: 6px`, `font-size: 11px`, `weight: 500`,
`letter-spacing: -0.14px`.

**3. Machine values get a code-pill, inline in prose.**

> Reorder waffle cones from `cone_king` with lead time `7_days`.

Identifiers, enum values and parameters are rendered as small monospace pills
tinted with the accent, sitting inside an ordinary sentence. It makes the
boundary between prose and data legible without a table, and it is instantly
scannable.

This solves a problem the Atlas Slice already has: my version stamps are
currently a limp grey `<span>`. **A resolved version is exactly a machine
value inside prose** — `contracts@2.2.0` belongs in this treatment.

**4. Discrete segments beat continuous meters.**

Confidence renders as three small bars — ▮▮▮ — beside the words "High
confidence", not as a percentage or a progress bar. Discrete steps read at a
glance, survive greyscale, and degrade gracefully to their text label. Their
Records Table uses the same idea for relationship strength ("Very strong",
"Weak", "No communication").

**5. Cards are body + hairline + action bar.**

One horizontal rule separates content from a footer that carries status on the
left and actions on the right. Secondary buttons are surface + hairline;
primary is solid accent with dark ink. Radius ~8px on controls, ~12px on cards.

**6. Typography is Inter with negative tracking, and that is most of the look.**

Body 14px/21px (1.5). Headings 19px/600 at `letter-spacing: -0.02em`. The tight
negative tracking on headings is the single most identifiable thing about this
aesthetic, and it costs one declaration.

### What not to take

- **It is dark-only.** Every token is a fixed dark hex. openkit must work in
  whatever theme a consuming card carries, so the ladder has to be expressed
  against Boxel's semantic variables rather than baked.
- **The tag hues are hardcoded per row.** Fine for a demo, wrong for a library:
  openkit derives a hue from the value being displayed so the same status is
  the same colour everywhere, with an override for callers who need one.
- **AI-native framing.** Thinking traces and streaming text are not what layer
  03 of this slice needs. The _primitives underneath_ them are.

---

## Reference 2 — motion-primitives (`~/Projects/motion-primitives`, MIT)

_"Beautifully designed, easy-to-integrate motion components"_, built on
`motion/react` (Framer Motion) with Tailwind and Radix. Thirty-odd components:
`sliding-number`, `animated-number`, `animated-background`, `transition-panel`,
`morphing-dialog`, `morphing-popover`, `text-shimmer`, `border-trail`,
`disclosure`, `in-view`, plus a decorative set — `tilt`, `magnetic`, `dock`,
`spotlight`, `glow-effect`, `spinning-text`.

**Nothing here is importable.** React hooks, a Framer Motion runtime, Tailwind
classes and Radix primitives — openkit is Glimmer and self-contained. So this
reference contributes _techniques_, and two of them are worth real work.

### The odometer, and the one line that makes it good

`sliding-number.tsx` renders each digit as a `1ch`-wide window with
`overflow-y: clip`, stacks all ten digits inside it, and springs the stack's
`y`. The quality of the effect is entirely in the offset maths:

```js
const offset = (10 + number - placeValue) % 10;
let memo = offset * height;
if (offset > 5) memo -= 10 * height; // <- this line
```

That last line makes every digit take the **shortest path around the 0–9 ring**.
Without it, 9→0 rolls _backwards through nine digits_; with it, it rolls forward
by one, which is what a physical odometer does and what the eye expects. Ten
lines, and it is the difference between "nice" and "correct".

Directly applicable: **an amount that changes should roll, not swap.** A money
field is the single best place in this slice for it — a total that recomputes
after an edit currently blinks to a new value, telling you nothing about
whether it went up or down.

Reimplementable with no dependency: `transform: translateY()` on a stacked
column plus a transition. The spring can be approximated closely with CSS
`linear()` easing from sampled points, or honestly with a cubic-bezier.

### The sliding highlight

`animated-background.tsx` renders **one** highlight element with a shared
`layoutId`, so as selection moves the browser FLIPs it between positions — the
indicator _travels_ from tab to tab instead of cross-fading. This is the best
single interaction detail in the whole library and it applies straight to
`<Select>`, tabs, and segmented controls.

Also dependency-free: one absolutely-positioned element whose `translate` and
`width` are set from the active item's `offsetLeft`/`offsetWidth`, with a CSS
transition on both. Roughly fifteen lines. Boxel already has view-transition
precedent in the corpus if a more capable version is wanted later.

### What to leave

`animated-number` is the weaker sibling of `sliding-number` — a spring on a
number plus `toLocaleString()`. Its only real lesson is `tabular-nums`, which
the money field already does.

`tilt`, `magnetic`, `dock`, `spotlight`, `glow-effect`, `spinning-text` are
decoration. A data library that leans on them looks unserious at best and
unreadable at worst, and every one of them is invisible in a screenshot, which
is where most of these components will actually be judged.

### The rule this settles

The first brief said motion should be "additive only, unless a later reference
argues otherwise." This one argues otherwise, but narrowly, and the distinction
is worth stating as a rule openkit holds to:

> **Motion is allowed where it encodes a state transition the reader would
> otherwise have to infer. It is forbidden where it merely decorates.**

A number that rolled tells you it changed and which way. A highlight that slid
tells you where selection came from. A card that tilts under the cursor tells
you nothing. Everything that survives that test also goes behind
`prefers-reduced-motion: reduce`, with the end state — never a frozen midpoint —
as the fallback.

### A convenient consequence for the slice

Motion is close to the ideal **minor version**: additive, unmistakably visible,
and it changes no field and no contract. `openkit@1.2.0 — the selection
highlight now travels` is exactly the compatible-but-obvious upgrade §2 wants to
demonstrate, and `cardstack/contracts` gaining an odometer is the same shape one
layer down.

Better still, it makes coexistence _legible_: two pinned versions of openkit on
one page, one sliding and one snapping, is a more convincing demonstration of
per-consumer versioning than two shades of the same chip.

---

## Reference 3 — fancy components (fancycomponents.dev)

The user's framing was _"weird, but worth collecting"_, and that is the right
framing: a typewriter that types a string, deletes it, and types the next one
is not something a records table needs. Two things are still worth taking.

**The prop surface is the lesson.** For a decorative component, the API is
unusually complete and unusually honest:

|                                          |                                                                           |
| ---------------------------------------- | ------------------------------------------------------------------------- |
| `text`                                   | `string \| string[]` — one phrase or a cycle                              |
| `speed` / `deleteSpeed`                  | typing and deleting are **separate** rates, because they read differently |
| `initialDelay` / `waitTime`              | before starting, and between phrases                                      |
| `loop`, `showCursor`, `hideCursorOnType` |                                                                           |
| `cursorChar`                             | a string **or an arbitrary node** — an SVG cursor is supported            |
| `cursorAnimationVariants`                | the blink itself is caller-definable                                      |

Every timing knob is named and separately settable; the cursor is a _slot_
rather than a character; the defaults are sensible enough that none of it is
required. That is the standard openkit's components should hold to — most
component libraries would have shipped `speed` and stopped.

They also write down what they have _not_ got right — _"Ideally, the component
should respect multiple lines. If you experience otherwise, please let me
know."_ Naming an unfinished edge in the docs is worth copying.

**The expressive tier is real.** Reference 1 shipped Streaming Text for the same
reason: text that arrives progressively is now an ordinary thing for an
interface to do. openkit should own that as a real component rather than
leaving each consumer to hand-roll a `setInterval`.

## Reference 4 — Paper Shaders (shaders.paper.design)

_"Ultra fast zero-dependency shaders for your designs."_ Around thirty WebGL
effects in three groups: image filters (paper texture, fluted glass, water,
dithering, halftone, lens distortion), generative effects (mesh gradient, grain
gradient, warp, spiral, waves, perlin/simplex/voronoi noise, dot grid, dot
orbit, metaballs, pulsing border, smoke ring, god rays), and logo animations
(heatmap, liquid metal, gem smoke).

**The important word is zero-dependency.** `@paper-design/shaders-react` is a
React wrapper over a framework-agnostic core, and a framework-agnostic core with
no dependencies is the one thing in these four references that openkit could
_actually vendor_ — a canvas and a shader program care nothing about Glimmer.
Everything from references 2 and 3 has to be reimplemented; this could be
pinned. It is therefore also the reference most likely to become a real
`openkit` dependency rather than an influence, which makes it the first
candidate for the vendoring path Deck already supports.

**What it is for, and what it is not.** Texture and atmosphere: a paper grain
behind a card, a mesh gradient on an empty state, a pulsing border on something
that is actively updating. What it is emphatically not for is anything carrying
information — a shader is unreadable, unindexable, and invisible to a screen
reader.

So it sits **outside** the motion rule from reference 2 rather than violating
it: that rule governs motion that encodes state, and this is not that. Texture
is allowed in the places where nothing is being communicated — empty states,
backgrounds, the chrome around content — and nowhere else. `pulsing border` is
the one borderline case, since "this is live" _is_ information; if it ships, it
ships with a text affordance beside it.

It should also be optional at the package level. A card realm that never uses a
shader must not pay for a WebGL runtime, which argues for `openkit/texture` as a
**separate package** from `openkit/structures` — a decision the multi-package
publisher model makes cheap and a monolithic UI library makes impossible.

---

## Foundations: vendored engines under openkit

The question was whether openkit could take a literal dependency at the bottom,
the way three.js is vendored. **Yes — that is exactly what the vendoring path is
for, and it is the right architecture.** But not on react-bits, and the reason
is worth stating precisely.

### react-bits itself: no

`~/Projects/react-bits` has **330 `.jsx`/`.tsx` files and one plain `.js`**. Its
four "variants" — `content`, `ts-default`, `tailwind`, `ts-tailwind` — vary by
TypeScript-vs-JavaScript and CSS-vs-Tailwind. **All four are React.** There is no
non-React react-bits to depend on. Taking it would mean shipping React and
react-dom into every card that renders a Boxel field, to run components Glimmer
cannot render anyway.

### What react-bits actually is, and why that is the useful part

react-bits is a **wrapper library**. Almost nothing in it is original
capability — the capability is in what it wraps, and its dependency list reads
as a shopping list of exactly the engines openkit wants:

| Engine                                                                                    | What it buys                  | Framework-bound?            |
| ----------------------------------------------------------------------------------------- | ----------------------------- | --------------------------- |
| `gsap`                                                                                    | the timeline animation engine | no                          |
| `ogl`                                                                                     | a small WebGL renderer        | no                          |
| `three`                                                                                   | full 3D                       | no                          |
| `matter-js`                                                                               | 2D physics                    | no                          |
| `lenis`                                                                                   | smooth scroll                 | no                          |
| `gl-matrix`, `maath`, `mathjs`                                                            | vector/matrix maths           | no                          |
| `meshline`, `postprocessing`                                                              | rendering extras              | no                          |
| `motion` (vanilla core)                                                                   | springs and layout animation  | no — only `motion/react` is |
| `@react-three/fiber`, `@react-three/drei`, `@use-gesture/react`, `lucide-react`, `sonner` | React bindings                | **yes — unusable**          |

Every engine in the top group is a plain ES module that talks to the DOM,
canvas or WebGL. **All of them vendor exactly like three.js already does.** So
openkit gets react-bits' capabilities not by depending on react-bits but by
depending on what react-bits depends on, and writing the wrappers in Glimmer —
which is structurally the identical job, aimed at a different renderer.

Reference 4's Paper Shaders falls in the same category: a framework-agnostic
zero-dependency core with a React wrapper on top. Vendor the core, skip the
wrapper.

### Why this is good for the slice, not just for openkit

Today the store's `lib/` namespace holds one synthetic package — the seed
script's own header says _"A real vendored dependency would…"_. Putting real
engines under openkit exercises the vendoring path against the publishing path
for the first time, and it makes the slice's dependency graph genuinely deep:

```
acme/rfq-to-payment  →  ledgerworks/billing-kit  →  northwind/records
                     →  openkit/motion           →  lib/gsap@3.13.0   (vendored npm)
                     →  openkit/texture          →  lib/ogl@1.0.11    (vendored npm)
```

Five levels, and the last hop **crosses from realm-authored packages into
vendored npm**. That makes B9 a much better question than it was: when a
vendored library publishes a patch, does the blast radius behave the same as
when a realm package does? It should — a pin is a pin — but "should" is what B9
exists to check, and the answer matters more for `lib/*` than anywhere else,
because that is where somebody else's release schedule enters the building.

### The cost, and what it forces

Every engine is real bytes, and a card that renders a money field must not pay
for a physics engine. That makes the package split load-bearing rather than
tidy:

| Package              | Vendored deps                                                                              |
| -------------------- | ------------------------------------------------------------------------------------------ |
| `openkit/structures` | none — chips, panels, grids are CSS                                                        |
| `openkit/controls`   | none — the select is DOM and ARIA                                                          |
| `openkit/motion`     | `lib/motion` (vanilla core) for springs; `lib/gsap` only if timelines are genuinely needed |
| `openkit/texture`    | `lib/paper-shaders` or `lib/ogl`                                                           |

**The two components that matter most — `<Select>` and `<Chip>` — take no
vendored dependency at all.** That is deliberate: the foundation should be
reachable without a runtime, and weight should be opt-in at the package
boundary. A monolithic UI library cannot make that offer; a multi-package
publisher can, which is the same argument that put six publishers in §0.

---

## The mandate: re-cover boxel-ui's territory, unbound from its legacy

openkit is not a supplement to `@cardstack/boxel-ui`. It has to **cover the same
ground with a superset of the features**, while owing nothing to how boxel-ui
got there.

`@cardstack/boxel-ui` currently ships 57 components. That inventory is the
coverage floor, grouped by territory:

| Territory           | boxel-ui today                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Text input          | `input`, `email-input`, `phone-input`, `input-group`, `field-container`                                                                        |
| Choice              | `select`, `multi-select`, `picker`, `dropdown`, `radio-input`, `switch`, `sort-dropdown`, `view-selector`                                      |
| Specialised pickers | `date-range-picker`, `color-picker`, `color-palette`, `swatch`                                                                                 |
| Actions             | `button`, `icon-button`, `add-button`, `context-button`, `copy-button`, `menu`, `selection-menu`                                               |
| Labelling           | `tag`, `tag-list`, `pill`, `label`, `avatar`, `realm-icon`, `entity-icon-display`, `entity-thumbnail-display`                                  |
| Feedback            | `alert`, `message`, `tooltip`, `progress-bar`, `progress-radial`, `loading-indicator`, `circle-spinner`, `skeleton-placeholder`, `broken-link` |
| Containers          | `container`, `card-container`, `grid-container`, `header`, `card-header`, `tabbed-header`, `modal`, `accordion`, `resizable-panel-group`       |
| Card formats        | `fitted-card`, `fitted-card-container`, `basic-fitted`                                                                                         |
| Collections         | `kanban`, `filter-list`, `drag-and-drop`, `selection-checkmark`                                                                                |

**"Unbound from the legacy" means openkit re-covers the territory, not the API.**
No inherited names, no inherited argument shapes, no assumption of a build step,
and no Ember-addon packaging. Where boxel-ui has three overlapping ways to
render a fitted card, openkit has one that adapts. Where boxel-ui has `pill` and
`tag` doing nearly the same job, openkit has `<Chip>`.

**Superset** means every territory above is covered _and_ the gaps are filled.
The gaps the four references make obvious:

| openkit adds                 | Why boxel-ui has no equivalent                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `<DataGrid>`                 | there is `kanban` and `filter-list`, but no records table — the most common data surface there is |
| `<Token>`                    | machine values inline in prose have no treatment at all                                           |
| `<Meter>`                    | `progress-bar` measures completion; nothing expresses a discrete qualitative level                |
| `<Odometer>`                 | numbers change by replacement, so a change communicates nothing                                   |
| `<Chip>` with a derived hue  | `tag` takes a colour; nothing derives one, so the same status is a different colour per author    |
| `<Panel>` with an action bar | `card-container` has no footer convention, so every consumer invents one                          |
| `<StreamingText>`            | progressive text is now ordinary and has no home                                                  |
| `<CommandPalette>`           | search exists as a route, not as a primitive                                                      |
| `openkit/texture`            | no texture layer at all                                                                           |

The point of the exercise is not "more components". It is that a versioned,
per-consumer-pinned library **can** be re-cut this way, and a build-time addon
cannot — boxel-ui's shape is frozen by the fact that changing it changes it for
everybody at once. openkit gets to be opinionated precisely because a consumer
who disagrees can stay on the version they liked.

---

## boxel-ui ∩ react-bits: what the bottom layer has to carry

react-bits ships **165 components**: Animations 36, Backgrounds 53, Components
44, TextAnimations 32. boxel-ui ships 57. Laying them over each other is the
fastest way to see what openkit's foundation actually has to be, and the first
finding is that **the overlap is small** — which is itself the answer.

boxel-ui is a _forms-and-data_ library. react-bits is a _motion-and-spectacle_
library. They are solving different problems, and they meet in about a dozen
places.

### The intersection — components that need BOTH a data contract and an expressive treatment

These are the foundation components. Each needs boxel-ui's correctness (value,
change events, validation, a11y, keyboard) **and** react-bits' expressive range,
which is precisely what "superset of features" means.

| Foundation            | boxel-ui side                                                          | react-bits side                                                                                                          |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Button**            | `button`, `icon-button`, `add-button`, `context-button`, `copy-button` | `SpecularButton`, `StarBorder`, `ClickSpark`, `Magnet`                                                                   |
| **Menu / Nav**        | `menu`, `selection-menu`, `dropdown`, `view-selector`, `tabbed-header` | `BubbleMenu`, `FlowingMenu`, `GooeyNav`, `StaggeredMenu`, `InfiniteMenu`, `Dock`, `PillNav`, `CardNav`, `LineSidebar`    |
| **Card surface**      | `card-container`, `fitted-card`, `basic-fitted`                        | `SpotlightCard`, `PixelCard`, `TiltedCard`, `DecayCard`, `ProfileCard`, `ReflectiveCard`, `GlassSurface`                 |
| **Grid / collection** | `grid-container`, `kanban`, `filter-list`                              | `Masonry`, `MagicBento`, `ChromaGrid`, `ShapeGrid`, `AnimatedList`                                                       |
| **Disclosure**        | `accordion`                                                            | `AccordionGallery`, `Folder`                                                                                             |
| **Text input**        | `input`, `email-input`, `phone-input`, `input-group`                   | `CurvedInput`, `TextCursor`                                                                                              |
| **Choice**            | `select`, `multi-select`, `picker`, `sort-dropdown`                    | `OptionWheel`, `ElasticSlider`                                                                                           |
| **Numeric display**   | `progress-bar`, `progress-radial`                                      | `Counter`, `CountUp`                                                                                                     |
| **Pending state**     | `loading-indicator`, `circle-spinner`, `skeleton-placeholder`          | `ShinyText`, `LogoLoop`, `GradualBlur`                                                                                   |
| **Label / chip**      | `tag`, `tag-list`, `pill`, `label`                                     | `StarBorder`, `BorderGlow`, `ElectricBorder`                                                                             |
| **Reorder / drag**    | `drag-and-drop`, `selection-checkmark`                                 | `Stack`, `DriftWall`, `MorphSlider`                                                                                      |
| **Stepwise flow**     | —                                                                      | `Stepper`                                                                                                                |
| **Carousel**          | —                                                                      | `Carousel`, `CircularGallery`, `DepthCarousel`, `CardSwap`, `BounceCards`, `FlyingPosters`, `DomeGallery`, `ScrollStack` |

Twelve overlaps plus two react-bits-only categories. **That is the foundation
list** — and note that in every row the boxel-ui column is the _contract_ and the
react-bits column is a _menu of treatments_. openkit's job is one component per
row whose API is the contract and whose appearance is a choice.

The last two rows are gaps in boxel-ui outright: there is no stepper and no
carousel, and both are ordinary things applications need.

### boxel-ui only — openkit's obligations, with no expressive precedent

react-bits has nothing to say about any of these, because they are the
unglamorous half of an interface. openkit still owes every one of them:

`alert` · `message` · `tooltip` · `field-container` · `label` ·
`date-range-picker` · `color-picker` · `color-palette` · `swatch` ·
`radio-input` · `switch` · `modal` · `resizable-panel-group` · `container` ·
`header` · `card-header` · `avatar` · `realm-icon` · `entity-icon-display` ·
`entity-thumbnail-display` · `broken-link` · `fitted-card-container`

Roughly twenty components with no reference design behind them. They are also
the ones a real application uses most, so they cannot be deferred to a
"polish" pass — and they are where openkit will be judged by whether an
ordinary form is pleasant to fill in.

### react-bits only — the optional expressive layer, grouped by what it costs

The remaining ~150 are not foundation. They are the tier that makes an
interface feel authored rather than assembled, and they are exactly where the
vendored engines earn their weight:

| Tier                    | Examples                                                                                                         | Engine needed                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **CSS-only**            | `FadeContent`, `AnimatedContent`, `ShinyText`, `GradientText`, `StarBorder`, `BlurText`, `GradualBlur`           | none                                   |
| **Text effects**        | `SplitText`, `ScrambledText`, `DecryptedText`, `CountUp`, `RotatingText`, `TextType`, `SplitFlapText`, `Shuffle` | none, or `lib/gsap` for the timed ones |
| **Scroll-driven**       | `ScrollReveal`, `ScrollFloat`, `ScrollVelocity`, `ScrollStack`, `ScrollExpand`                                   | `lib/lenis`                            |
| **Cursor**              | `BlobCursor`, `PixelTrail`, `ImageTrail`, `SplashCursor`, `TargetCursor`, `Crosshair`                            | none, or `lib/gsap`                    |
| **2D canvas / physics** | `Ballpit`, `MetaBalls`, `Antigravity`, `Ferrofluid`                                                              | `lib/matter-js`                        |
| **WebGL backgrounds**   | `Aurora`, `Silk`, `Threads`, `Plasma`, `Iridescence`, `LiquidChrome`, `Galaxy`, `Dither`, `Prism`, `LightRays`   | `lib/ogl`                              |
| **3D**                  | `ModelViewer`, `Lanyard`, `FluidGlass`, `Cubes`, `Orb`                                                           | `lib/three`                            |

**The layering falls out of this table.** The CSS-only and text tiers need no
dependency at all and can live in `openkit/structures` from day one. Everything
below `lib/lenis` is opt-in weight, which is why `openkit/motion` and
`openkit/texture` are separate packages: a card realm that renders invoices
should never load a physics engine, and with a monolithic library it would have
no way to avoid it.

### What this settles about "what the bottom layer needs"

1. **Twelve foundation components** carry both a data contract and an
   expressive range. These are the superset components, and they are the ones
   that must be excellent before anything above openkit can be.
2. **About twenty more** are pure obligation — no reference, no glamour, and
   used constantly.
3. **The other ~150 are a menu, not a checklist.** They are how openkit stays
   interesting after the foundation is done, they are strictly opt-in, and
   they are the reason the vendored-engine question was worth asking.
4. `<Select>` sits in the intersection, has no vendorable dependency, and is
   the component §7 is about. It is the first thing to build.

---

## What openkit takes from this

### The surface ladder, mapped onto Boxel

Each fallback stated exactly once at the component root, per the theme skill;
bare `var()` reads below it.

| openkit        | Boxel variable            | role                               |
| -------------- | ------------------------- | ---------------------------------- |
| `--ok-page`    | `--background`            | the page behind everything         |
| `--ok-surface` | `--card`                  | a card, a row, a panel             |
| `--ok-inset`   | `--muted`                 | a well: code blocks, table headers |
| `--ok-field`   | `--input`                 | an input's interior                |
| `--ok-hover`   | `--accent`                | hover and selection                |
| `--ok-ink`     | `--foreground`            | primary text                       |
| `--ok-ink-2`   | `--muted-foreground`      | labels, secondary                  |
| `--ok-line`    | `--border`                | every hairline                     |
| `--ok-ring`    | `--ring`                  | focus outline                      |
| status hues    | `--chart-1` … `--chart-5` | the five distinguishable accents   |

Using `--chart-1…5` for status hues is deliberate: they are the only palette
Boxel guarantees to be mutually distinguishable _and_ theme-supplied, so a chip
stays legible under a theme openkit has never seen. They also give the Atlas
Slice its per-version accents for free.

### The components openkit ships

Layer 03 is _Reusable Semantic Building Blocks_, so these are the primitives the
layers above compose — not an application.

| Component      | Taken from                                 | Notes                                                                                      |
| -------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------ |
| `<Chip>`       | ref 1, the tag recipe                      | one `@hue` in; dot + tint + derived ink out                                                |
| `<StatusChip>` | ref 1, tags + strength                     | a chip whose hue is derived from the status value, so "overdue" is the same red everywhere |
| `<Token>`      | ref 1, the inline code-pill                | machine values inside prose — ids, enums, **versions**                                     |
| `<Meter>`      | ref 1, the confidence bars                 | discrete segments with a text label, never bare                                            |
| `<Panel>`      | ref 1, card + action bar                   | body, hairline, footer with status left / actions right                                    |
| `<Field>`      | ref 1, their form rows                     | label, control, hint, error — the wrapper every input needs                                |
| `<Select>`     | ref 1 picker + **ref 2 sliding highlight** | a real listbox: keyboard, typeahead, rich options, travelling selection                    |
| `<DataGrid>`   | ref 1, Records Table                       | header, zebra via `--stripe`, sortable, tag column                                         |
| `<Odometer>`   | **ref 2, sliding-number**                  | a numeric display that rolls on change, shortest path per digit                            |
| `AddressField` | —                                          | a FieldDef, the slice's own requirement                                                    |

`<Select>` is the one that cannot be a re-export. It is the component the whole
§7 argument is about — _the dropdown that sits under everything_ — so openkit
has to actually own it: listbox semantics, arrow/Home/End/typeahead, `aria-
activedescendant`, and rich option rendering.

### The version stamp, redone

Every module in the slice prints its own resolved coordinates. Today that is a
grey span. It becomes a `<Token>`:

```
northwind/records@2.4.0
```

Monospace, accent-tinted, inline. The stamp stops looking like debug output and
starts looking like the thing it is — a machine value worth reading.

---

## Open, pending more references

The user has more reference designs coming; this document absorbs them as
sections. Two things to settle once there are enough of them:

1. **Light theme.** Every reference so far is dark. The `color-mix` recipe
   inverts cleanly (mix toward `black` rather than `white` for the ink) but the
   crossover wants a real decision, not an automatic flip.
2. ~~How much motion.~~ **Settled by reference 2**: motion where it encodes a
   state transition, never where it decorates, always behind
   `prefers-reduced-motion`.
3. **Where the odometer lives.** `<Odometer>` is an openkit component, but the
   money field is in `cardstack/contracts` one layer BELOW openkit — and layer
   02 must not depend on layer 03. Either the money field ships its own rolling
   display (duplication), or the odometer is a contracts-layer primitive that
   openkit re-exports (inversion), or money simply does not roll and only
   openkit's own numeric displays do. **This is the first genuine layering
   conflict the slice has produced, and it is exactly the kind of thing a
   six-publisher graph exists to surface** — in a single-publisher design it
   would have been settled by moving a file.
