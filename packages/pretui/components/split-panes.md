## What it is

Two or more resizable panes with a draggable divider between them. Use it for a persistent side-by-side arrangement the user should be able to retune — a list beside a detail, an editor beside a preview, a tree beside a canvas. If the second region is transient, use **Drawer** or **Popover**. If the split is fixed, plain CSS grid is lighter. If you need a full canvas workspace, that is **NodeCanvas**.

## The contract

```
@orientation? 'horizontal' | 'vertical'   (default 'horizontal')
@reverseCollapse?
@onLayoutChange?(layout: number[])
<:default as |Panel, Handle|>
```

`Panel` takes `defaultSize` / `minSize` / `maxSize` / `collapsible`, all in **percent**. `Handle` is placed between panels.

Two behaviours worth knowing. **Double-clicking a handle collapses a pane**, and `@reverseCollapse` switches which one — the last instead of the first. And `@onLayoutChange` reports the whole layout as an array of percentages, which is what you persist if you want the split to survive a reload; nothing here stores it for you.

## Prior art

This is a **thin runtime wrap of boxel-ui's `ResizablePanelGroup`**, per the territory's foundation rule: the machinery is boxel-ui's and only the cloth changes. The engine supplies per-panel constraint solving, pointer-captured drag (so the drag survives the pointer leaving the handle), and the double-click collapse.

The dress note is the interesting implementation detail: **boxel-ui's handle declares its own `--boxel-panel-resize-handle-*` colours *from* `--boxel-450` and `--boxel-highlight`**, so the wrapper cannot repoint the handle tokens directly — it has to remap those two upstream channel tokens for the subtree instead. That is the general shape of the retrofit pattern in this kit: when a token is derived rather than read, you re-skin one level up.

Against the field: **`react-resizable-panels`** (which shadcn wraps as `ResizablePanel`) is the reference — `direction`, `defaultSize`/`minSize`/`maxSize`, `collapsible`/`collapsedSize`, `onLayout`, `autoSaveId` for localStorage persistence, and `ResizableHandle withHandle`. **Web Awesome `wa-split-panel`** takes `position`/`position-in-pixels`, `vertical`, `disabled`, `primary`, `snap` and `snap-threshold`. **React Spectrum** has no equivalent.

Where Pretui/boxel-ui is comparable or better: percent-based constraints with real solving (Web Awesome's single `position` cannot express a three-pane minimum), and pointer capture done properly.

Where it is behind: **no `autoSaveId`** (persistence is entirely yours via `@onLayoutChange`), **no snap points** (Web Awesome's `snap`/`snap-threshold` is the nicest thing in that component), and no visible grip affordance arg equivalent to shadcn's `withHandle`.

## Accessibility

Governing pattern: **ARIA `separator` with `aria-valuenow`** — a focusable separator is one of the few cases where `separator` is an interactive role. The contract is: `role="separator"` on the handle, `tabindex="0"`, `aria-valuenow`/`aria-valuemin`/`aria-valuemax` describing the position as a percentage, `aria-orientation`, an accessible name (`aria-label` such as "Resize panels"), and **arrow keys moving the divider** — Left/Right for a horizontal split, Up/Down for a vertical one, with Home/End going to the extremes and Enter or F6 toggling collapse.

**All of that belongs to boxel-ui's engine, not to this wrapper.** What the engine does today:

- **The handle is a native `<button>` named "Resize handle".** Tab reaches it, and double-click collapses the pane.
- **There is no keyboard resizing and no `aria-valuenow`.** Arrow keys do nothing on the handle, and a screen-reader user is not told where the divider sits. That is a **WCAG 2.1.1 Keyboard** gap for arbitrary resizing, and **WCAG 2.5.7 Dragging Movements** has only the collapse as a single-pointer alternative. The fix belongs in boxel-ui's ResizeHandle.
- **Name each handle.** The yielded `Handle` splats its attributes after its own label, so `aria-label='Resize the sidebar'` replaces the generic name. In a three-pane layout, "Resize handle" three times is not enough.
- `@onLayoutChange` fires continuously during a drag; do not put an announcement on it.

## Theming

Consumed: `--text-ui-md`, `--track-ui`, and the layout tokens.

Remapped for the subtree: `--boxel-450` and `--boxel-highlight` → the Pretui handle colours (rest and active). Because the handle's own custom properties are *derived* from those two, this is the only place a season can reach the handle — repointing `--boxel-panel-resize-handle-*` directly has no effect.

`data-orientation` is reflected on the wrapper for season hooks. Note the group fills its host, so **the wrapping context must have a height** — a SplitPanes in an auto-height container collapses to nothing, which is the first thing to check when it renders blank.

The styles sit in `@layer PretComponent`, so a caller's unlayered CSS overrides them without a more specific selector.

## React ecosystem

shadcn `Resizable` (`react-resizable-panels`) is this tile (alias stub).
Ant/Mantine `Splitter` too.
