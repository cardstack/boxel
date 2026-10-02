## What it is

**Resizable** is **SplitPanes** under the shadcn name (shadcn `Resizable` is built on `react-resizable-panels`). The export is the same component. Import it when a port already says Resizable; the **SplitPanes** writeup carries the depth. It lays out two or more panes with draggable handles between them, on boxel-ui's ResizablePanelGroup engine.

## The contract

```
@orientation? ('horizontal' | 'vertical'; default 'horizontal')
@reverseCollapse?   — double-click collapse folds the last pane instead of the first
@onLayoutChange?    — called with the pane sizes, as percentages
<:default as |Panel Handle|>
Element: HTMLDivElement
```

Identical to SplitPanes. The block yields the Panel and Handle components. A Panel takes `defaultSize`, `minSize`, `maxSize` and `collapsible` args.

## Prior art

**shadcn `ResizablePanelGroup` / `ResizablePanel` / `ResizableHandle`** map one to one onto SplitPanes and its yielded `Panel` / `Handle`. shadcn takes `direction` where SplitPanes takes `@orientation`, and `onLayout` where it takes `@onLayoutChange`. `react-resizable-panels` also has `autoSaveId` to persist sizes, which SplitPanes does not: persist the `@onLayoutChange` sizes yourself and pass them back as `@defaultSize`.

## Accessibility

Identical to SplitPanes. A handle is an interactive `separator` with `aria-valuenow` for its position. All of that belongs to boxel-ui's engine rather than this wrapper, so check that each handle is keyboard reachable and operable in your boxel-ui version. A drag-only divider fails WCAG 2.1.1.

## Theming

Identical to SplitPanes: `--foreground`, `--muted-foreground`, `--primary` (the active handle), `--text-ui-md` and `--track-ui`, plus boxel-ui's `--boxel-panel-resize-handle-*` properties on the handle.

## React ecosystem

| shadcn                            | Pretui                                         |
| --------------------------------- | ---------------------------------------------- |
| `<ResizablePanelGroup direction>` | `<Resizable @orientation as \|Panel Handle\|>` |
| `<ResizablePanel defaultSize>`    | `<Panel @defaultSize>`                         |
| `<ResizableHandle withHandle />`  | `<Handle />`                                   |
| `onLayout`                        | `@onLayoutChange`                              |
| `autoSaveId`                      | not supported; persist `@onLayoutChange`       |
