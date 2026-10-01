## What it is

**An in-product walkthrough** attached to the live interface: one card per step, anchored to the real control it explains, with a ring around that control. Step N of M, Back, Next, Done, and Skip.

Reach for a neighbour when the job is different:

- **Onboarding** is a first-run scene of its own.
- **Tooltip** is one hint on one control.
- **Popover** is one panel on demand.

## The contract

```
@steps ({ id, title, body, target?, placement? }[])
@open?, @defaultOpen?, @onOpenChange?
@index?, @onIndexChange?, @onFinish?, @onSkip?
@modal? (default false)
@backLabel?, @nextLabel?, @doneLabel?, @skipLabel?
Element: HTMLDivElement
```

**Anchoring.** A step's `target` is a CSS selector for the control it explains. The target is scrolled into view (nearest, never the whole page). The card is placed by the kit's `anchorTo` on its `placement` side (`bottom` by default, then `top`, `start` or `end`, logical in RTL). It flips to the other side when there is no room, so it never covers the target, and it follows the target on scroll and resize. A step with no target, or with a selector that isn't valid, is centred. A ring is drawn around the target and never covers it.

**Moving.** Next advances, Back returns, and on the last step Next becomes Done, which calls `@onFinish` and closes. Skip, the close button and Escape call `@onSkip` and close. Escape counts only while focus is in the card, so any other control on the page keeps its own Escape. The step can be controlled with `@index` and `@onIndexChange`, and visibility with `@open` and `@onOpenChange`.

**Modal only on request.** By default the page stays usable around the card. `@modal` adds a scrim around the target, drawn as four rects that catch the pointer, so the rest of the page can't be clicked while the target stays pressable. Under `@modal`, Escape skips the tour from anywhere. The page is not made inert for the keyboard, so the dialog is never marked `aria-modal`.

## Prior art

**Ant `Tour`** takes `steps` (`title`, `description`, `target`, `placement`, `cover`), `open`, `current`, `onChange`, `onClose`, `onFinish`, `mask` and `type`. **React Joyride** takes `steps`, `run`, `stepIndex`, `callback` and `spotlightClicks`. **Shepherd.js** and **Driver.js** are the framework-free libraries. **Mantine** has none.

Where Pretui is better: **focus is handled.** Next takes focus on every step, and closing returns focus to where it was before the tour. Joyride and Driver.js leave focus on the page behind. **Non-modal by default**, so the reader can try the control the step describes. **It is a labelled dialog**, titled and described by the step.

Where it is thinner: **no arrow pointing at the target**, **no per-step custom content** beyond title and body, **no beacon mode** (Joyride's pulsing hotspots), and **no persistence** of whether the tour was seen. Store that yourself from `@onFinish` and `@onSkip`.

## Accessibility

APG **Dialog**, non-modal by default.

- **The card is `role="dialog"`**, labelled by the step title (`aria-labelledby`) and described by its body (`aria-describedby`). It carries no `aria-modal`, because the page is never inert. The tests assert all three.
- **Focus.** Next (or Done) takes focus when the tour opens and on every step, so the reader can press Enter through it. However the tour closes (Skip, Done, Escape or a controlled `@open={{false}}`), focus returns to the element that had it when that open began. The tests assert each, including a second open returning to its own opener.
- **Escape skips while focus is in the card**, and another control's Escape stays its own. The tests assert both. **The close button is named** after the skip label.
- **The ring and scrim are decoration**, `aria-hidden`. The step text carries the meaning (Law 6). The ring outlines the target and never hides it.
- **Progress is text**, "Step 2 of 5".

## Theming

`--pretui-tour-ring` (default `--primary`), `--pretui-overlay-scrim` (the `@modal` scrim), `--pretui-z-overlay` (the card and ring), `--popover`, `--popover-foreground`, `--pretui-shadow-overlay`, `--radius-surface`, `--radius-control`, `--border`, `--hover`, `--ring`, `--muted-foreground`, `--foreground`, `--font-sans`, `--font-serif` (the title), `--text-heading`, `--weight-heading`, `--text-ui-md`, `--text-ui-xs`, `--track-eyebrow`, `--leading-body`, `--space-2`, `--space-4`, and `--pretui-dur-snap` / `--pretui-ease-snap` (the ring moving between steps).

The card is 20rem wide at most. The ring's move is dropped under reduced motion.

## React ecosystem

| Agent types                              | Give them                                    |
| ---------------------------------------- | -------------------------------------------- |
| Ant `<Tour steps open current onChange>` | `<Tour @steps @open @index @onIndexChange>`  |
| Ant `mask`                               | `@modal={{true}}`                            |
| Ant step `target: () => ref.current`     | step `target: '.css-selector'`               |
| Joyride `run` / `stepIndex` / `callback` | `@open` / `@index` / `@onFinish` + `@onSkip` |
| Driver.js `driver().drive()`             | `<Tour @defaultOpen={{true}}>`               |
