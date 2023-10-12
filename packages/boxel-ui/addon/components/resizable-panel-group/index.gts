import Component from '@glimmer/component';
import { action } from '@ember/object';
import { registerDestructor } from '@ember/destroyable';
import { TrackedMap } from 'tracked-built-ins';
import didResizeModifier from 'ember-resize-modifier/modifiers/did-resize';
import ResizablePanel from './panel';
import { WithBoundArgs } from '@glint/template';

export type PanelContext = {
  width: string;
  defaultWidth: string;
  minWidth?: string;
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

export default class ResizablePanelGroup extends Component<Signature> {
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
        flex-direction: row;
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
    initialXPosition: number;
    leftEl?: HTMLElement | null;
    rightEl?: HTMLElement | null;
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
      initialXPosition: event.clientX,
      leftEl: parentElement?.previousElementSibling as HTMLElement,
      rightEl: parentElement?.nextElementSibling as HTMLElement,
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
      !this.currentResizeHandler.leftEl ||
      !this.currentResizeHandler.rightEl
    ) {
      return;
    }

    let deltaX = event.clientX - this.currentResizeHandler.initialXPosition;
    let newLeftElWidth = this.currentResizeHandler.leftEl.clientWidth + deltaX;
    let newRightElWidth =
      this.currentResizeHandler.rightEl.clientWidth - deltaX;
    if (newLeftElWidth < 0 && newRightElWidth > 0) {
      newRightElWidth = newRightElWidth + newLeftElWidth;
      newLeftElWidth = 0;
    } else if (newLeftElWidth > 0 && newRightElWidth < 0) {
      newLeftElWidth = newLeftElWidth + newRightElWidth;
      newRightElWidth = 0;
    }

    let leftElMinWidth = this.currentResizeHandler.leftEl
      .computedStyleMap()
      .get('min-width') as { value: number };
    let rightElMinWidth = this.currentResizeHandler.rightEl
      .computedStyleMap()
      .get('min-width') as { value: number };
    if (
      (leftElMinWidth && newLeftElWidth < leftElMinWidth.value) ||
      (rightElMinWidth && newRightElWidth < rightElMinWidth.value)
    ) {
      return;
    }

    let leftElId = Number(this.currentResizeHandler.leftEl?.id);
    let rightElId = Number(this.currentResizeHandler.rightEl?.id);
    this.setLeftAndRightPanelContext(
      leftElId,
      rightElId,
      `${newLeftElWidth}px`,
      `${newRightElWidth}px`,
    );

    this.currentResizeHandler.initialXPosition = event.clientX;
  }

  // This event only applies to the first and last resize handler.
  // When triggered, it will close either the first or last panel.
  // In this scenario, the minimum width of the panel will be disregarded.
  @action
  onResizeHandlerDblClick(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    let parentElement = document.querySelector(`#${buttonId}`)?.parentElement;
    let leftEl = parentElement?.previousElementSibling as HTMLElement;
    let rightEl = parentElement?.nextElementSibling as HTMLElement;

    let leftElWidth = leftEl.offsetWidth;
    let rightElWidth = rightEl.offsetWidth;
    let leftElContext = this.listPanelContext.get(Number(leftEl.id));
    let rightElContext = this.listPanelContext.get(Number(rightEl.id));

    if (buttonId.includes('1') && leftElWidth > 0) {
      this.setLeftAndRightPanelContext(
        Number(leftEl.id),
        Number(rightEl.id),
        '0px',
        `${leftElWidth + rightElWidth}px`,
        `0px`,
      );
    } else if (buttonId.includes('1') && leftElWidth <= 0 && leftElContext) {
      this.setLeftAndRightPanelContext(
        Number(leftEl.id),
        Number(rightEl.id),
        leftElContext.defaultWidth,
        `calc(${rightElWidth}px - ${leftElContext.defaultWidth})`,
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      rightElWidth > 0
    ) {
      this.setLeftAndRightPanelContext(
        Number(leftEl.id),
        Number(rightEl.id),
        `${leftElWidth + rightElWidth}px`,
        '0px',
        undefined,
        '0px',
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      rightElWidth <= 0 &&
      rightElContext
    ) {
      this.setLeftAndRightPanelContext(
        Number(leftEl.id),
        Number(rightEl.id),
        `calc(${leftElWidth}px - ${rightElContext.defaultWidth})`,
        rightElContext.defaultWidth,
      );
    }
  }

  @action
  setLeftAndRightPanelContext(
    leftElId: number,
    rightElId: number,
    newLeftElWidth: string,
    newRightElWidth: string,
    newLeftElMinWidth?: string,
    newRightElMinWidth?: string,
  ) {
    let leftPanelContext = this.listPanelContext.get(leftElId);
    if (leftPanelContext) {
      this.listPanelContext.set(leftElId, {
        ...leftPanelContext,
        width: newLeftElWidth,
        minWidth: newLeftElMinWidth,
      });
    }

    let rightPanelContext = this.listPanelContext.get(rightElId);
    if (rightPanelContext) {
      this.listPanelContext.set(rightElId, {
        ...rightPanelContext,
        width: newRightElWidth,
        minWidth: newRightElMinWidth,
      });
    }

    this.args.onListPanelContextChange?.(
      Array.from(this.listPanelContext, ([_name, value]) => value),
    );
  }

  @action
  onWindowResize(entry: ResizeObserverEntry, _observer: ResizeObserver) {
    let panelGroupEl = entry.target as HTMLElement;

    let panelWidths = [];
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
      panelWidths.push(panelEl.offsetWidth);
    }
    let totalPanelWidth = panelWidths.reduce((partialSum, a) => partialSum + a);
    let resizeHandlerEl = panelGroupEl.querySelector(
      '#resize-handler-1',
    ) as HTMLElement;
    if (!resizeHandlerEl) {
      console.error(
        `Could not find selector: #resize-handler when handling window resize for resizeable panel group`,
      );
      return;
    }

    let resizeHandlerWidth = (resizeHandlerEl as HTMLElement).offsetWidth;
    let totalResizeHandlerWidth =
      resizeHandlerWidth * (this.listPanelContext.size - 1);

    let panelGroupWithoutResizeHandlerWidth =
      entry.contentRect.width - totalResizeHandlerWidth;
    let panelGroupRemainingWidth =
      panelGroupWithoutResizeHandlerWidth - totalPanelWidth;

    if (panelGroupRemainingWidth <= 0) {
      return;
    }

    let largestPanel = {
      id: 1,
      width: 0,
    };
    for (let index = 1; index <= this.listPanelContext.size; index++) {
      let panelWidth = panelWidths[index - 1];
      let newWidth =
        panelWidth +
        Math.round((panelWidth / totalPanelWidth) * panelGroupRemainingWidth);
      let panelContext = this.listPanelContext.get(index);
      if (panelContext) {
        this.listPanelContext.set(index, {
          ...panelContext,
          width: `${newWidth}px`,
        });
      }
      if (largestPanel.width < newWidth) {
        largestPanel.id = index;
        largestPanel.width = newWidth;
      }

      panelGroupWithoutResizeHandlerWidth =
        panelGroupWithoutResizeHandlerWidth - newWidth;
    }

    let largestPanelContext = this.listPanelContext.get(largestPanel.id);
    if (panelGroupWithoutResizeHandlerWidth > 0 && largestPanelContext) {
      this.listPanelContext.set(largestPanel.id, {
        ...largestPanelContext,
        width: `${largestPanel.width + panelGroupWithoutResizeHandlerWidth}px`,
      });
    }
  }
}
