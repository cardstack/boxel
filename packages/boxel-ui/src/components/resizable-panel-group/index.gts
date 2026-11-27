import { action } from '@ember/object';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { WithBoundArgs } from '@glint/template';
import { TrackedArray } from 'tracked-built-ins';

import ResizeHandle from './handle.gts';
import ResizablePanel from './panel.gts';

export { default as ResizeHandle } from './handle.gts';
export { default as ResizablePanel } from './panel.gts';

import { guidFor } from '@ember/object/internals';
import { scheduleOnce } from '@ember/runloop';
import { htmlSafe } from '@ember/template';
import { buildWaiter } from '@ember/test-waiters';
import { modifier } from 'ember-modifier';

import { adjustLayoutByDelta } from './utils/adjust-layout-by-delta.ts';
import { calculateDeltaPercentage } from './utils/calculate-delta-percentage.ts';
import { calculateUnsafeDefaultLayout } from './utils/calculate-unsafe-default-layout.ts';
import { compareLayouts } from './utils/compare-layouts.ts';
import { PRECISION } from './utils/const.ts';
import { determinePivotIndices } from './utils/determine-pivot-indices.ts';
import { getResizeEventCursorPosition } from './utils/get-resize-event-cursor-position.ts';
import {
  type DragState,
  type Orientation,
  type ResizeEvent,
} from './utils/types.ts';
import { validatePanelGroupLayout } from './utils/validate-panel-group-layout.ts';

let waiter = buildWaiter('resizable-panel-group');

interface Signature {
  Args: {
    onLayoutChange?: (layout: number[]) => void;
    orientation: Orientation;
    reverseCollapse?: boolean;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof ResizablePanel,
        'groupId' | 'orientation' | 'registerPanel' | 'unregisterPanel'
      >,
      WithBoundArgs<
        typeof ResizeHandle,
        'groupId' | 'orientation' | 'registerResizeHandle'
      >,
    ];
  };
  Element: HTMLDivElement;
}

let managePanelsChanged = modifier(
  (element, [panelGroup]: [ResizablePanelGroup]) => {
    if (!panelGroup.element) {
      waiter.endAsync(panelGroup.initializationWaiter);
    }
    panelGroup.element = element as HTMLDivElement;

    scheduleOnce(
      'afterRender',
      panelGroup,
      panelGroup.calculateLayoutWhenPanelsChanged,
    );
    let observer = new MutationObserver((mutations) => {
      for (let mutation of mutations) {
        if (mutation.type === 'childList') {
          panelGroup.calculateLayoutWhenPanelsChanged();
        }
      }
    });
    observer.observe(panelGroup.element, {
      childList: true,
      subtree: false,
    });

    return () => {
      observer.disconnect();
    };
  },
);

export default class ResizablePanelGroup extends Component<Signature> {
  <template>
    <div
      class='boxel-panel-group {{@orientation}}'
      data-boxel-panel-group
      data-boxel-panel-group-id={{this.id}}
      {{managePanelsChanged this}}
      ...attributes
    >
      {{yield
        (component
          ResizablePanel
          groupId=this.id
          orientation=@orientation
          registerPanel=this.registerPanel
          unregisterPanel=this.unregisterPanel
        )
        (component
          ResizeHandle
          groupId=this.id
          orientation=@orientation
          registerResizeHandle=this.registerResizeHandle
        )
      }}
    </div>
    <style scoped>
      .boxel-panel-group {
        display: flex;
        height: 100%;
        width: 100%;
        overflow: 'hidden';
      }
      .vertical {
        flex-direction: column;
      }
      .horizontal {
        flex-direction: row;
      }
    </style>
  </template>

  private id = guidFor(this);
  element!: HTMLDivElement;

  private layout: TrackedArray<number> = new TrackedArray();
  private panels: ResizablePanel[] = [];
  private panelsChanged = false;
  private panelSizeBeforeCollapse: Map<string, number> = new Map();

  @tracked private dragState: DragState | null = null;
  @tracked hideHandles = false;
  minimumLengthToShowHandles = 30;

  initializationWaiter = waiter.beginAsync();

  @action
  registerPanel(panel: ResizablePanel) {
    this.panels.push(panel);
    this.panelsChanged = true;

    return () => {
      let flexGrow;
      let size = this.layout[this.panels.indexOf(panel)];
      if (size == null) {
        // Initial render (before panels have registered themselves)
        // In order to support server rendering, fall back to default size if provided
        flexGrow =
          panel.constraints.defaultSize != undefined
            ? panel.constraints.defaultSize.toPrecision(PRECISION)
            : '1';
      } else if (this.panels.length === 1) {
        // Special case: Single panel group should always fill full width/height
        flexGrow = '1';
      } else {
        flexGrow = size.toPrecision(PRECISION);
      }

      return htmlSafe(
        `flex: 0; flex-grow: ${flexGrow}; flex-shrink: 1; pointer-events: ${
          this.dragState !== null ? 'none' : undefined
        };`,
      );
    };
  }

  @action
  unregisterPanel(panel: ResizablePanel) {
    let panelIndex = this.panels.findIndex((p) => p === panel);

    if (panelIndex > -1) {
      this.panels.splice(panelIndex, 1);
      this.panelsChanged = true;
    }
    this.panelSizeBeforeCollapse.delete(panel.id);
  }

  @action
  registerResizeHandle(handle: ResizeHandle) {
    return {
      startDragging: (event: ResizeEvent) => {
        if (!this.element) {
          return;
        }
        let dragHandleId = handle.id;
        const initialCursorPosition = getResizeEventCursorPosition(
          this.args.orientation,
          event,
        );

        this.dragState = {
          dragHandleId,
          dragHandleRect: handle.element.getBoundingClientRect(),
          initialCursorPosition,
          initialLayout: [...this.layout],
        };
      },
      // When a drag ends, each panel it collapsed remembers its size from when
      // the drag started, so a double-click reopens it, as it does a panel a
      // double-click collapsed. A panel the drag leaves open forgets the size
      // from an earlier collapse.
      stopDragging: () => {
        let initialLayout = this.dragState?.initialLayout;
        this.dragState = null;
        // Start sizes match panels by position, which a panel added or
        // removed during the drag would shift.
        if (!initialLayout || initialLayout.length !== this.layout.length) {
          return;
        }
        this.layout.forEach((size, index) => {
          let panel = this.panels[index];
          if (!panel) {
            return;
          }
          let startSize = initialLayout[index];
          if (size > 0) {
            this.panelSizeBeforeCollapse.delete(panel.id);
          } else if (startSize) {
            this.panelSizeBeforeCollapse.set(panel.id, startSize);
          }
        });
      },
      resizeHandler: (event: ResizeEvent) => {
        event.preventDefault();
        let panelGroupElement = this.element;
        if (!panelGroupElement || !this.dragState) {
          return;
        }

        let { initialLayout } = this.dragState;

        const pivotIndices = determinePivotIndices(
          this.id,
          handle.id,
          panelGroupElement,
        );

        let delta = calculateDeltaPercentage(
          event,
          handle.id,
          this.args.orientation,
          this.dragState,
          panelGroupElement,
        );

        const panelConstraints = this.panels.map((panel) => panel.constraints);
        const prevLayout = [...this.layout];
        const nextLayout = adjustLayoutByDelta({
          delta,
          initialLayout: initialLayout ?? prevLayout,
          panelConstraints,
          pivotIndices,
          prevLayout,
        });
        const layoutChanged = !compareLayouts(prevLayout, nextLayout);
        if (layoutChanged) {
          this.updateLayout(nextLayout);
        }
      },
      // Double-click only works if the panel is either the first or last panel and is collapsible.
      doubleClickHandler: (event: ResizeEvent) => {
        event.preventDefault();
        let panelGroupElement = this.element;
        if (!panelGroupElement) {
          return;
        }
        const pivotIndices = determinePivotIndices(
          this.id,
          handle.id,
          panelGroupElement,
        );

        if (
          pivotIndices[0] !== 0 &&
          pivotIndices[1] !== this.panels.length - 1
        ) {
          return;
        }

        let isFirstElement =
          pivotIndices[0] === 0 &&
          !(
            this.args.reverseCollapse &&
            pivotIndices[1] === this.panels.length - 1
          );
        let panel = isFirstElement
          ? this.panels[0]
          : this.panels[this.panels.length - 1];
        let panelSize = isFirstElement
          ? this.layout[0]
          : this.layout[this.panels.length - 1];
        if (!panel || panelSize == null) {
          throw new Error('panel or panelSize is not found');
        }

        let delta;
        if (panelSize <= 0) {
          let panelSizeBeforeCollapse = this.panelSizeBeforeCollapse.get(
            panel.id,
          );
          if (panelSizeBeforeCollapse == null) {
            let nextLayout = this.layoutReopening(
              isFirstElement ? 0 : this.panels.length - 1,
            );
            if (nextLayout) {
              this.updateLayout(nextLayout);
            }
            return;
          }
          delta = isFirstElement
            ? panelSizeBeforeCollapse
            : 0 - panelSizeBeforeCollapse;
        } else {
          delta = isFirstElement ? 0 - panelSize : panelSize;
        }

        const panelConstraints = this.panels.map((panel) => panel.constraints);
        const prevLayout = [...this.layout];
        const nextLayout = adjustLayoutByDelta({
          delta,
          initialLayout: prevLayout,
          panelConstraints,
          pivotIndices,
          prevLayout,
        });
        const layoutChanged = !compareLayouts(prevLayout, nextLayout);
        if (layoutChanged) {
          // Only a collapsed panel keeps a size to reopen at.
          let nextPanelSize = isFirstElement
            ? nextLayout[0]
            : nextLayout[this.panels.length - 1];
          if (nextPanelSize) {
            this.panelSizeBeforeCollapse.delete(panel.id);
          } else if (panelSize > 0) {
            this.panelSizeBeforeCollapse.set(panel.id, panelSize);
          }
          this.updateLayout(nextLayout);
        }
      },
    };
  }

  // Opens a collapsed end panel that has no remembered size (it loaded
  // collapsed, or a re-layout collapsed it) at its default size, or else its
  // minimum, or else half the group, and never below its minimum. The other
  // panels make room from the handle outward, each down to its own minimum,
  // or to half its size when it sets none. The panel stays closed when they
  // can't make room for its minimum.
  private layoutReopening(panelIndex: number): number[] | undefined {
    let panel = this.panels[panelIndex];
    if (!panel) {
      return undefined;
    }
    let { defaultSize, maxSize, minSize } = panel.constraints;
    let target = Math.min(
      Math.max(defaultSize || minSize || 50, minSize ?? 0),
      maxSize ?? 100,
    );
    let layout = [...this.layout];
    let step = panelIndex === 0 ? 1 : -1;
    let room = 0;
    for (
      let index = panelIndex + step;
      index >= 0 && index < layout.length && room < target;
      index += step
    ) {
      let size = layout[index] ?? 0;
      let keep = this.panels[index]?.constraints.minSize ?? size / 2;
      let give = Math.min(Math.max(size - keep, 0), target - room);
      layout[index] = parseFloat((size - give).toFixed(PRECISION));
      room += give;
    }
    if (room <= 0 || room < (minSize ?? 0)) {
      return undefined;
    }
    // The panel takes what the others' rounded sizes leave, since a layout
    // that doesn't add up to 100 refuses every later resize.
    let others = layout.reduce(
      (sum, size, index) => (index === panelIndex ? sum : sum + size),
      0,
    );
    layout[panelIndex] = parseFloat((100 - others).toFixed(PRECISION));
    return layout;
  }

  @action
  calculateLayoutWhenPanelsChanged() {
    if (!this.panelsChanged) {
      return;
    }
    this.panelsChanged = false;
    let prevLayout = [...this.layout];
    let unsafeLayout = calculateUnsafeDefaultLayout({
      panels: this.panels,
    });
    // Validate even saved layouts in case something has changed since last render
    // e.g. for pixel groups, this could be the size of the window
    const nextLayout = validatePanelGroupLayout({
      layout: unsafeLayout,
      panelConstraints: this.panels.map((panel) => panel.constraints),
    });

    if (!compareLayouts(prevLayout, nextLayout)) {
      this.updateLayout(nextLayout);
    }
  }

  @action
  updateLayout(nextLayout: number[]) {
    this.layout.splice(0, this.layout.length);
    nextLayout.forEach((layout) => this.layout.push(layout));

    this.args.onLayoutChange?.(this.layout);
  }
}
