// Pretui — SplitPanes: drag-resizable panes, a thin wrap of boxel-ui ResizablePanelGroup.
import Component from '@glimmer/component';
import { ResizablePanelGroup as BoxelResizablePanelGroup } from '@cardstack/boxel-ui/components';

// ── SplitPanes — WRAPS boxel-ui ──────────────────────────────────────────
// boxel-ui's ResizablePanelGroup drag-resize engine intact: per-panel
// constraint solving (defaultSize/minSize/maxSize/collapsible, in
// percent), pointer-captured drag, double-click collapse (reversible via
// @reverseCollapse). The yielded Panel/Handle pair passes straight
// through. Handle dress note: boxel's handle declares its own
// --boxel-panel-resize-handle-* colors FROM --boxel-450 /
// --boxel-highlight, so the wrapper re-skins one level up — remapping
// those two channel tokens to the Pretui equivalents for this subtree.

export interface SplitPanesSignature {
  Args: {
    /** 'horizontal' (default) lays panes left-to-right */
    orientation?: 'horizontal' | 'vertical';
    /** double-click collapse folds the LAST panel instead of the first */
    reverseCollapse?: boolean;
    onLayoutChange?: (layout: number[]) => void;
  };
  Blocks: {
    /* eslint-disable @typescript-eslint/no-explicit-any -- the yielded
       pair are boxel-ui's curried ResizablePanel / ResizeHandle */
    default: [any, any];
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
  Element: HTMLDivElement;
}

export class SplitPanes extends Component<SplitPanesSignature> {
  get orientation(): 'horizontal' | 'vertical' {
    return this.args.orientation ?? 'horizontal';
  }
  <template>
    <div
      class='pretui-splitpanes'
      data-orientation={{this.orientation}}
      data-test-pretui-split-panes
      ...attributes
    >
      <BoxelResizablePanelGroup
        @orientation={{this.orientation}}
        @reverseCollapse={{@reverseCollapse}}
        @onLayoutChange={{@onLayoutChange}}
        as |Panel Handle|
      >
        {{yield Panel Handle}}
      </BoxelResizablePanelGroup>
    </div>
    <style scoped>
      @layer PretComponent {
        /* The group fills its host — give the wrapping context a height.
           Handle idle color rides the Pretui hairline voice; hover snaps to
           primary (both via the remapped --boxel-* channel, see above). */
        .pretui-splitpanes {
          height: 100%;
          min-height: 0;
          font-size: var(--text-ui-md, 12.5px);
          letter-spacing: var(--track-ui, 0.01em);
          color: var(--foreground);
          --boxel-450: var(--muted-foreground);
          --boxel-highlight: var(--primary);
        }
      }
    </style>
  </template>
}
