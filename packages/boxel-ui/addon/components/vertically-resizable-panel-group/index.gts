import Component from '@glimmer/component';
import { action } from '@ember/object';
import { registerDestructor } from '@ember/destroyable';
import { TrackedMap } from 'tracked-built-ins';
import didResizeModifier from 'ember-resize-modifier/modifiers/did-resize';
import ResizablePanel from './panel';
import { WithBoundArgs } from '@glint/template';

export type VerticalPanelContext = {
  height: string;
  defaultHeight: string;
  minHeight?: string;
};

interface Signature {
  Element: HTMLDivElement;
  Args: {
    onListPanelContextChange?: (listPanelContext: PanelContext[]) => void;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof ResizablePanel,
        | 'registerPanel'
        | 'panelContext'
        | 'isLastPanel'
        | 'onResizeHandlerMouseDown'
        | 'onResizeHandlerDblClick'
      >,
    ];
  };
}

export default class VerticalResizablePanelGroup extends Component<Signature> {
  <template>
    <div
      class='boxel-panel-group'
      {{didResizeModifier this.onWindowResize}}
      ...attributes
    >
      {{yield
        (component
          ResizablePanel
          registerPanel=this.registerPanel
          panelContext=this.panelContext
          isLastPanel=this.isLastPanel
          onResizeHandlerMouseDown=this.onResizeHandlerMouseDown
          onResizeHandlerDblClick=this.onResizeHandlerDblClick
        )
      }}
    </div>
    <style>
      .boxel-panel-group {
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
        height: 100%;
      }
    </style>
  </template>

  constructor(args: any, owner: any) {
    super(args, owner);

    document.addEventListener('mouseup', this.onResizeHandlerMouseUp);
    document.addEventListener('mousemove', this.onResizeHandlerMouseMove);

    registerDestructor(this, () => {
      document.removeEventListener('mouseup', this.onResizeHandlerMouseUp);
      document.removeEventListener('mousedown', this.onResizeHandlerMouseMove);
    });
  }

  listPanelContext = new TrackedMap<number, PanelContext>();
  currentResizeHandler: {
    id: string;
    initialYPosition: number;
    topEl?: HTMLElement | null;
    bottomEl?: HTMLElement | null;
  } | null = null;

  @action
  registerPanel(context: PanelContext) {
    let id = Number(this.listPanelContext.size + 1);
    this.listPanelContext.set(id, context);

    return id;
  }

  @action
  panelContext(panelId: number) {
    return this.listPanelContext.get(panelId);
  }

  @action
  isLastPanel(panelId: number) {
    return panelId === this.listPanelContext.size;
  }

  @action
  onResizeHandlerMouseDown(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    if (this.currentResizeHandler || !buttonId) {
      return;
    }

    let parentElement = document.querySelector(`#${buttonId}`)?.parentElement;
    this.currentResizeHandler = {
      id: buttonId,
      initialYPosition: event.clientY,
      topEl: parentElement?.previousElementSibling as HTMLElement,
      bottomEl: parentElement?.nextElementSibling as HTMLElement,
    };
  }

  @action
  onResizeHandlerMouseUp(_event: MouseEvent) {
    this.currentResizeHandler = null;
  }

  @action
  onResizeHandlerMouseMove(event: MouseEvent) {
    if (
      !this.currentResizeHandler ||
      !this.currentResizeHandler.topEl ||
      !this.currentResizeHandler.bottomEl
    ) {
      return;
    }

    let deltaY = event.clientY - this.currentResizeHandler.initialYPosition;
    let newTopElHeight = this.currentResizeHandler.topEl.clientHeight + deltaY;
    let newBottomElHeight =
      this.currentResizeHandler.bottomEl.clientHeight - deltaY;
    if (newTopElHeight < 0 && newBottomElHeight > 0) {
      newBottomElHeight = newBottomElHeight + newTopElHeight;
      newTopElHeight = 0;
    } else if (newTopElHeight > 0 && newBottomElHeight < 0) {
      newTopElHeight = newTopElHeight + newBottomElHeight;
      newBottomElHeight = 0;
    }

    let topElMinHeight = this.currentResizeHandler.topEl
      .computedStyleMap()
      .get('min-height') as { value: number };
    let bottomElMinHeight = this.currentResizeHandler.bottomEl
      .computedStyleMap()
      .get('min-height') as { value: number };
    if (
      (topElMinHeight && newTopElHeight < topElMinHeight.value) ||
      (bottomElMinHeight && newBottomElHeight < bottomElMinHeight.value)
    ) {
      return;
    }

    let topElId = Number(this.currentResizeHandler.topEl?.id);
    let bottomElId = Number(this.currentResizeHandler.bottomEl?.id);
    this.setTopAndBottomPanelContext(
      topElId,
      bottomElId,
      `${newTopElHeight}px`,
      `${newBottomElHeight}px`,
    );

    this.currentResizeHandler.initialYPosition = event.clientY;
  }

  // This event only applies to the first and last resize handler.
  // When triggered, it will close either the first or last panel.
  // In this scenario, the minimum height of the panel will be disregarded.
  @action
  onResizeHandlerDblClick(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    let parentElement = document.querySelector(`#${buttonId}`)?.parentElement;
    let topEl = parentElement?.previousElementSibling as HTMLElement;
    let bottomEl = parentElement?.nextElementSibling as HTMLElement;

    let topElHeight = topEl.offsetHeight;
    let bottomElHeight = bottomEl.offsetHeight;
    let topElContext = this.listPanelContext.get(Number(topEl.id));
    let bottomElContext = this.listPanelContext.get(Number(bottomEl.id));

    if (buttonId.includes('1') && topElHeight > 0) {
      this.setTopAndBottomPanelContext(
        Number(topEl.id),
        Number(bottomEl.id),
        '0px',
        `${topElHeight + bottomElHeight}px`,
        `0px`,
      );
    } else if (buttonId.includes('1') && topElHeight <= 0 && topElContext) {
      this.setTopAndBottomPanelContext(
        Number(topEl.id),
        Number(bottomEl.id),
        topElContext.defaultHeight,
        `calc(${bottomElHeight}px - ${topElContext.defaultHeight})`,
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      bottomElHeight > 0
    ) {
      this.setTopAndBottomPanelContext(
        Number(topEl.id),
        Number(bottomEl.id),
        `${topElHeight + bottomElHeight}px`,
        '0px',
        undefined,
        '0px',
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      bottomElHeight <= 0 &&
      bottomElContext
    ) {
      this.setTopAndBottomPanelContext(
        Number(topEl.id),
        Number(bottomEl.id),
        `calc(${topElHeight}px - ${bottomElContext.defaultHeight})`,
        bottomElContext.defaultHeight,
      );
    }
  }

  @action
  setTopAndBottomPanelContext(
    topElId: number,
    bottomElId: number,
    newTopElHeight: string,
    newBottomElHeight: string,
    newTopElMinHeight?: string,
    newBottomElMinHeight?: string,
  ) {
    let topPanelContext = this.listPanelContext.get(topElId);
    if (topPanelContext) {
      this.listPanelContext.set(topElId, {
        ...topPanelContext,
        height: newTopElHeight,
        minHeight: newTopElMinHeight,
      });
    }

    let bottomPanelContext = this.listPanelContext.get(bottomElId);
    if (bottomPanelContext) {
      this.listPanelContext.set(bottomElId, {
        ...bottomPanelContext,
        height: newBottomElHeight,
        minHeight: newBottomElMinHeight,
      });
    }

    this.args.onListPanelContextChange?.(
      Array.from(this.listPanelContext, ([_name, value]) => value),
    );
  }

  @action
  onWindowResize(entry: ResizeObserverEntry, _observer: ResizeObserver) {
    let panelGroupEl = entry.target as HTMLElement;

    let panelHeights = [];
    for (let index = 1; index <= this.listPanelContext.size; index++) {
      let panelEl = panelGroupEl.querySelector(
        `[id='${index}'].boxel-panel`,
      ) as HTMLElement;
      if (!panelEl) {
        console.error(
          `Could not find selector: [id='${index}'].boxel-panel when handling window resize for resizeable panel group`,
        );
        continue;
      }
      panelHeights.push(panelEl.offsetHeight);
    }
    let totalPanelHeight = panelHeights.reduce(
      (partialSum, a) => partialSum + a,
    );
    let resizeHandlerEl = panelGroupEl.querySelector(
      '#vertical-resize-handler-1',
    ) as HTMLElement;
    if (!resizeHandlerEl) {
      console.error(
        `Could not find selector: #resize-handler when handling window resize for resizeable panel group`,
      );
      return;
    }

    let resizeHandlerHeight = (resizeHandlerEl as HTMLElement).offsetHeight;
    let totalResizeHandlerHeight =
      resizeHandlerHeight * (this.listPanelContext.size - 1);

    let panelGroupWithoutResizeHandlerHeight =
      entry.contentRect.height - totalResizeHandlerHeight;
    let panelGroupRemainingHeight =
      panelGroupWithoutResizeHandlerHeight - totalPanelHeight;

    if (panelGroupRemainingHeight <= 0) {
      return;
    }

    let largestPanel = {
      id: 1,
      height: 0,
    };
    for (let index = 1; index <= this.listPanelContext.size; index++) {
      let panelHeight = panelHeights[index - 1];
      let newHeight =
        panelHeight +
        Math.round(
          (panelHeight / totalPanelHeight) * panelGroupRemainingHeight,
        );
      let panelContext = this.listPanelContext.get(index);
      if (panelContext) {
        this.listPanelContext.set(index, {
          ...panelContext,
          height: `${newHeight}px`,
        });
      }
      if (largestPanel.height < newHeight) {
        largestPanel.id = index;
        largestPanel.height = newHeight;
      }

      panelGroupWithoutResizeHandlerHeight =
        panelGroupWithoutResizeHandlerHeight - newHeight;
    }

    let largestPanelContext = this.listPanelContext.get(largestPanel.id);
    if (panelGroupWithoutResizeHandlerHeight > 0 && largestPanelContext) {
      this.listPanelContext.set(largestPanel.id, {
        ...largestPanelContext,
        height: `${
          largestPanel.height + panelGroupWithoutResizeHandlerHeight
        }px`,
      });
    }
  }
}
