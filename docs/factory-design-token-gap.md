# The factory's design tokens never reach the cards it builds

Every card the software factory builds renders unstyled — white ground,
browser-default sans, none of the palette, type, spacing or rule discipline
its own design turn just specified. The design language is produced, written
down, agreed, and then dropped on the way to the card.

This reproduces on `main`, has reproduced since the mechanism was introduced,
and no validation gate can see it. It needs its own ticket; the notes below
are the investigation.

---

## The symptom

The design turn writes `design/<slug>.html`, screenshots it, critiques it and
revises. That mockup looks right: warm paper, Fraunces display, monospace
slugs, the left hairline rule, a single terracotta accent.

The build turn translates it into `<slug>.gts` faithfully — same markup, same
class names, ~110 `var(--…)` references to exactly the token names the guide
defines.

The rendered card is white with default sans. In the control run, labels
collide with their values (`EMAILamara@fieldnotes.press`) because the spacing
tokens are absent too.

## The mechanism

`design/tokens.css` holds every value:

```css
:root {
  --color-paper: #f7f3ec;
  --font-display: 'Fraunces', 'Playfair Display', Georgia, serif;
}
```

A **mockup** is an HTML page, so it `<link>`s that stylesheet. Tokens land on
`:root`, every `var()` resolves, the page looks correct.

A **card** is a `.gts` module whose CSS lives in `<style scoped>` blocks. It
has no way to link a workspace CSS file — it is a module the host loads, not a
page. Nothing ever defines those custom properties in the scope where the
card's `var()` calls are evaluated.

It fails silently because that is what CSS specifies. A `var(--x)` where `--x`
is undefined **and no fallback is given** makes the whole declaration _invalid
at computed-value time_: the property does not keep a previous value, it takes
its inherited value if inheritable, else its initial value.

| declaration                        | with the token missing              |
| ---------------------------------- | ----------------------------------- |
| `background: var(--color-paper)`   | initial → transparent → white       |
| `font-family: var(--font-display)` | inherited → browser default sans    |
| `padding: var(--space-4)`          | initial → `0` → labels touch values |

No console error. No build warning. The cards carry **zero** fallbacks —
`var(--color-paper, #f7f3ec)` would have degraded gracefully.

## It is not a regression

Three factory runs against the same brief and corpus, one per code revision:

| workspace                                                    | `var()` refs in the card | palette tokens defined |
| ------------------------------------------------------------ | ------------------------ | ---------------------- |
| `user/field-notes` (spike branch)                            | 100                      | 0                      |
| `user/fieldnotes-control` (unmodified `main` @ `3280ec8943`) | 132                      | 0                      |
| `user/fieldnotes-reuse` (catalog-reuse branch)               | 113                      | 0                      |

No factory-built card has ever defined a palette token. The control was run
specifically to test this, in a worktree at the commit the reuse branch starts
from, with the same brief, the same corpus, a fresh realm, and the same host
dist and CLI build so the agent's tooling was identical.

## Why it was never wired

`design/tokens.css` enters in **`cf3c875af5`** ("Factory v2/v3: resume-safe
restarts, session reuse, bug-fix path, run-log activity feed", 2026-07-17)
alongside `issue-design-foundation.md`. The entire bridge between the file and
the cards is one word, unchanged since:

> **`design/tokens.css`** — the same decisions as CSS custom properties …
> Every future mockup links this file; every future `.gts` template
> **mirrors** these variables.

"Mirrors" is readable as _reproduce them_. Every instruction the build turn
actually reads resolves it the other way:

| file                  | says                                                                |
| --------------------- | ------------------------------------------------------------------- |
| `issue-build.md:83`   | "Use theme CSS variables (`var(--*)`) per the notes' token mapping" |
| `issue-design.md:128` | notes carry "theme-token mapping for every hard-coded color/size"   |

A _mapping_ says which token replaces which colour. Nothing instructs anyone
to emit the definitions, and the mockup never needs them emitted.

**There is no code on either side.** Searching the package for the filename
returns four hits, all of them prose the agent reads —
`factory-seed.ts:607/621/622` (the seed checklist) and a comment at
`claude-code.ts:583`. Nothing generates the file, nothing consumes it, nothing
checks the link. `run-log.ts:42` classifies it explicitly as a _non-card file_
that never ships, which is correct for a mockup asset and is exactly why it
never reaches a card.

The ambiguity is then re-resolved, in writing, every run — by the agent that
writes the brand guide. From the control run's own `tokens.css` header:

> Every `.gts` template **references** these via `var(--fn-*)`.
> No hard-coded colors, sizes, or spacings anywhere else.

That prohibition is correct and worth keeping. What it lacks is a carve-out
for the one place literals must live.

## Why nothing caught it for two months

Four checkpoints, each blind to this failure for a different reason:

1. **The design turn's crit pass.** It screenshots the _mockup_, which links
   the stylesheet and looks perfect. The turn that owns the tokens never sees
   a card.
2. **The four validation gates.** Parse, lint, evaluate and instantiate check
   TypeScript, templates, module loading and card structure. None evaluates
   CSS — custom-property resolution exists only in a browser, at paint.
3. **The render gate.** It screenshots the real card, but a verifier asked
   "is every acceptance criterion visible?" sees all the content present. The
   card is unstyled, not missing, and no criterion says "warm paper".
4. **CSS itself**, which is specified to fail silently here.

The comparison that would reveal it — mockup and card side by side — is
precisely the one nobody makes: the mockup is signed off in one turn and the
card is built in the next.

---

## Recommendation

**`tokens.css` is the right idea in the wrong file format.** The fix is not to
let cards hard-code values; it is to put the single source of literals in a
file a card can import. The discipline is unchanged — literals in exactly one
place, references everywhere else.

Copy the two-layer pattern the catalog's own blog-app already uses. From
`@cardstack/catalog/7af9aa-blog-app/blog-defaults`:

```css
--blog-color-bg: var(--background, #ffffff);
--blog-font-family: var(--font-sans, 'Inter', system-ui, sans-serif);
```

Two layers, each doing one job:

1. The app defines its **own namespaced tokens** in a block the card injects
   at runtime, so they exist wherever the card renders.
2. Each one **reads a generic theme variable with the literal as fallback**,
   so a `StructuredTheme` card (base ships one — `cssVariables` is a
   `CSSField` applied via `@themeCss`) can override it, and with no theme
   present the literal still paints.

### The change

- `issue-design-foundation` emits, alongside `design/tokens.css`, a
  `<app>-tokens.gts` exporting the same decisions as a CSS string in that
  two-layer form. Authored in the turn that already decides these values.
- Each card imports it and renders it in one `<style>` on its outermost
  element.
- Card CSS is untouched — every existing `var(--fn-paper)` reference keeps
  working.
- The brand guide gains one sentence: _the token module is the one place
  literals live; every other file references them._ The existing prohibition
  stays exactly as written.

### Why not the alternatives

- **Fallbacks on every `var()`** — cheapest, but copies the guide's values
  across ~113 sites, so a palette change means editing 113 places and the
  brand guide stops being the source of truth.
- **A Theme card alone** — right long-term shape, but makes rendering
  _depend_ on a Theme existing; the card breaks again whenever one is absent.

The two-layer pattern gets both properties: self-sufficient by default,
themeable when a theme is present.

### One tension, recorded

This is the same mechanism that made catalog `Author` `REUSE-BLOCKED` in the
catalog-reuse work — an app-specific token block the card carries. But the
token block is not what blocked adoption; the `.blog-scope` layout assumptions
and the decorated `isolated` static were. The fallback layer actively helps
portability: because `blog-defaults` reads generic names like `--background`,
a card dropped into another app picks up _that_ app's theme rather than
nothing. Namespaced tokens reading generic variables is the portable form.

## Also worth doing: a gate

The fix is ~20 lines of prompt. The reason this survived is that four checks
pass on a broken card, and while that stays true the next wording drift
reintroduces it silently.

A static lint rule would have failed all three runs:

> a `var(--x)` whose custom property is neither defined in this file, nor a
> `--boxel-*` host token, nor given a fallback

Cheap, static, no browser required, and the only one of the five checkpoints
that could have caught this.

## Evidence

- Workspaces: `/var/folders/…/boxel-factory-workspaces/https_localhost_4201_user_fieldnotes-{reuse,control}`
- Renders: `design/render/Contributor-*-isolated.png` in each
- Accepted mockup for comparison: `design/contributor-v2.png` (reuse run)
- Introducing commit: `cf3c875af5`
