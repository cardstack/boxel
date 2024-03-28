import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { WithBoundArgs } from '@glint/template';
import { nodeFor } from 'ember-ref-bucket';
import didResizeModifier from 'ember-resize-modifier/modifiers/did-resize';
import { TrackedMap } from 'tracked-built-ins';

import type { PanelContext } from './panel.gts';
import ResizablePanel from './panel.gts';
import ResizeHandle from './resize-handler.gts';

export { default as ResizablePanel } from './panel.gts';
export { default as ResizeHandle } from './resize-handler.gts';

function sumArray(array: number[]) {
  return array.reduce((partialSum, a) => partialSum + a, 0);
}

const resizablePanelElIdPrefix = 'resizable-panel';
const ResizeHandleElIdPrefix = 'resize-handler';

interface Signature {
  Args: {
    onListPanelContextChange?: (listPanelContext: PanelContext[]) => void;
    orientation: 'horizontal' | 'vertical';
    reverseCollapse?: boolean;
  };
  Blocks: {
    default: [
      WithBoundArgs<
        typeof ResizablePanel,
        | 'isLastPanel'
        | 'orientation'
        | 'panelContext'
        | 'panelGroupComponent'
        | 'registerPanel'
        | 'unregisterPanel'
        | 'resizablePanelElId'
      >,
      WithBoundArgs<
        typeof ResizeHandle,
        | 'hideHandle'
        | 'isLastPanel'
        | 'onResizeHandleMouseDown'
        | 'onResizeHandleDblClick'
        | 'orientation'
        | 'panelContext'
        | 'panelGroupComponent'
        | 'registerResizeHandle'
        | 'unRegisterResizeHandle'
        | 'resizeHandleElId'
        | 'reverseHandlerArrow'
      >,
    ];
  };
  Element: HTMLDivElement;
}

export default class ResizablePanelGroup extends Component<Signature> {
  <template>
    <div
      class='boxel-panel-group {{@orientation}}'
      {{didResizeModifier this.onContainerResize}}
      ...attributes
    >
      {{#if this.panelGroupElement}}
        {{yield
          (component
            ResizablePanel
            orientation=@orientation
            registerPanel=this.registerPanel
            unregisterPanel=this.unregisterPanel
            panelContext=this.panelContext
            isLastPanel=this.isLastPanel
            panelGroupComponent=this
            resizablePanelElId=this.panelElId
          )
          (component
            ResizeHandle
            orientation=@orientation
            registerResizeHandle=this.registerResizeHandle
            unRegisterResizeHandle=this.unRegisterResizeHandle
            panelContext=this.panelContext
            isLastPanel=this.isLastPanel
            onResizeHandleMouseDown=this.onResizeHandleMouseDown
            onResizeHandleDblClick=this.onResizeHandleDblClick
            reverseHandlerArrow=@reverseCollapse
            hideHandle=this.hideHandles
            panelGroupComponent=this
            resizeHandleElId=this.ResizeHandleElId
          )
        }}
      {{/if}}
    </div>
    <style>
      .boxel-panel-group {
        display: flex;
        flex-shrink: 0;
        height: 100%;
      }

      .horizontal {
        flex-direction: row;
      }

      .vertical {
        flex-direction: column;
      }
    </style>
  </template>

  constructor(args: any, owner: any) {
    super(args, owner);

    document.addEventListener('mouseup', this.onResizeHandleMouseUp);
    document.addEventListener('mousemove', this.onResizeHandleMouseMove);

    registerDestructor(this, () => {
      document.removeEventListener('mouseup', this.onResizeHandleMouseUp);
      document.removeEventListener('mousedown', this.onResizeHandleMouseMove);
    });
  }

  @tracked private panelGroupElement: HTMLDivElement | undefined;

  private get isHorizontal() {
    return this.args.orientation === 'horizontal';
  }

  private get clientPositionProperty() {
    return this.isHorizontal ? 'clientX' : 'clientY';
  }

  private get clientLengthProperty() {
    return this.isHorizontal ? 'clientWidth' : 'clientHeight';
  }

  private get offsetLengthProperty() {
    return this.isHorizontal ? 'offsetWidth' : 'offsetHeight';
  }

  private get perpendicularLengthProperty() {
    return this.isHorizontal ? 'clientHeight' : 'clientWidth';
  }

  private get panelGroupLengthPx() {
    return this.panelGroupElement?.[this.offsetLengthProperty];
  }

  private get panelGroupLengthWithoutResizeHandlePx() {
    let ResizeHandleSelector = `${ResizeHandleElIdPrefix}-${this.args.orientation}-0`;
    let ResizeHandleEl = this.getHtmlElement(ResizeHandleSelector);

    let resizeHandleContainer = (ResizeHandleEl as HTMLElement)?.parentElement;
    let ResizeHandleLength = resizeHandleContainer
      ? resizeHandleContainer[this.offsetLengthProperty]
      : 0;
    let panelGroupElement = this.panelGroupElement;
    if (panelGroupElement === undefined) {
      console.warn('Expected panelGroupElement to be defined');
      return undefined;
    }

    let totalResizeHandle = Array.from(panelGroupElement.children).filter(
      (node) => {
        return (
          node.nodeType === 1 &&
          node.children[0] &&
          node.children[0].id.includes(
            `${ResizeHandleElIdPrefix}-${this.args.orientation}`,
          )
        );
      },
    ).length;
    let totalResizeHandleLength = ResizeHandleLength * totalResizeHandle;
    let panelGroupLengthPx = this.panelGroupLengthPx;
    if (panelGroupLengthPx === undefined) {
      console.warn('Expected panelGroupLengthPx to be defined');
      return undefined;
    }
    return panelGroupLengthPx - totalResizeHandleLength;
  }

  @tracked hideHandles = false;
  @tracked totalResizeHandle = 0;
  minimumLengthToShowHandles = 30;

  resizablePanelIdCache = new WeakMap<ResizablePanel, number>();
  listPanelContext = new TrackedMap<number, PanelContext>();
  currentResizeHandle: {
    id: string;
    initialPosition: number;
    nextPanelEl?: HTMLElement | null;
    prevPanelEl?: HTMLElement | null;
  } | null = null;

  @action
  registerPanel(context: {
    collapsible: boolean | undefined;
    defaultLengthFraction: number | undefined;
    lengthPx: number | undefined;
    minLengthPx: number | undefined;
  }) {
    let id = Number(this.listPanelContext.size);

    if (context.lengthPx === undefined) {
      if (
        this.panelGroupLengthPx === undefined ||
        context.defaultLengthFraction === undefined
      ) {
        context.lengthPx = -1;
      } else {
        context.lengthPx =
          context.defaultLengthFraction * this.panelGroupLengthPx;
      }
    }
    //Update previous lengthPx
    let previousId = id - 1;
    let previousContextEl = this.listPanelContext.get(previousId);
    if (
      previousContextEl !== undefined &&
      previousContextEl.defaultLengthFraction &&
      this.panelGroupLengthPx
    ) {
      previousContextEl.lengthPx =
        previousContextEl.defaultLengthFraction * this.panelGroupLengthPx;
    }
    this.listPanelContext.set(id, {
      id,
      defaultLengthFraction: context.defaultLengthFraction,
      lengthPx: context.lengthPx,
      initialMinLengthPx: context.minLengthPx,
      minLengthPx: context.minLengthPx,
      collapsible:
        context.collapsible == undefined ? true : context.collapsible,
    });

    this.onContainerResize();
    return id;
  }

  @action
  unregisterPanel(id: number) {
    this.listPanelContext.delete(id);
    this.onContainerResize();
  }

  @action
  panelContext(panelId: number) {
    return this.listPanelContext.get(panelId);
  }

  @action
  isLastPanel(panelId: number) {
    return panelId === this.listPanelContext.size - 1;
  }

  @action
  registerResizeHandle() {
    let id = Number(this.totalResizeHandle);
    this.totalResizeHandle++;
    return id;
  }

  @action
  unRegisterResizeHandle() {
    this.totalResizeHandle--;
  }

  @action
  onResizeHandleMouseDown(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    if (this.currentResizeHandle || !buttonId) {
      return;
    }

    let { prevPanelEl, nextPanelEl } = this.findPanelsByResizeHandle(buttonId);
    if (!prevPanelEl || !nextPanelEl) {
      console.warn('Expected prevPanelEl and nextPanelEl are required');
      return undefined;
    }
    this.currentResizeHandle = {
      id: buttonId,
      initialPosition: event[this.clientPositionProperty],
      prevPanelEl: prevPanelEl,
      nextPanelEl: nextPanelEl,
    };
  }

  @action
  onResizeHandleMouseUp(_event: MouseEvent) {
    this.currentResizeHandle = null;
  }

  @action
  onResizeHandleMouseMove(event: MouseEvent) {
    if (
      !this.currentResizeHandle ||
      !this.currentResizeHandle.prevPanelEl ||
      !this.currentResizeHandle.nextPanelEl
    ) {
      return;
    }

    let delta =
      event[this.clientPositionProperty] -
      this.currentResizeHandle.initialPosition;
    if (delta === 0) {
      return;
    }

    let newPrevPanelElLength =
      this.currentResizeHandle.prevPanelEl[this.clientLengthProperty] + delta;
    let newNextPanelElLength =
      this.currentResizeHandle.nextPanelEl[this.clientLengthProperty] - delta;
    let prevPanelElId = this.panelId(this.currentResizeHandle.prevPanelEl?.id);
    let nextPanelElId = this.panelId(this.currentResizeHandle.nextPanelEl?.id);
    let prevPanelElContext = this.listPanelContext.get(Number(prevPanelElId));
    let nextPanelElContext = this.listPanelContext.get(Number(nextPanelElId));
    if (!prevPanelElContext || !nextPanelElContext) {
      console.warn(
        'Expected prevPanelElContext && nextPanelElContext to be defined',
      );
      return;
    }

    if (newPrevPanelElLength < 0 && newNextPanelElLength > 0) {
      newNextPanelElLength = newNextPanelElLength + newPrevPanelElLength;
      newPrevPanelElLength = 0;
    } else if (newPrevPanelElLength > 0 && newNextPanelElLength < 0) {
      newPrevPanelElLength = newPrevPanelElLength + newNextPanelElLength;
      newNextPanelElLength = 0;
    } else if (
      prevPanelElContext.initialMinLengthPx &&
      newPrevPanelElLength < prevPanelElContext.initialMinLengthPx &&
      newPrevPanelElLength > prevPanelElContext.lengthPx
    ) {
      newNextPanelElLength =
        newNextPanelElLength -
        (prevPanelElContext.initialMinLengthPx - newPrevPanelElLength);
      newPrevPanelElLength = prevPanelElContext.initialMinLengthPx;
    } else if (
      nextPanelElContext.initialMinLengthPx &&
      newNextPanelElLength < nextPanelElContext.initialMinLengthPx &&
      newNextPanelElLength > nextPanelElContext.lengthPx
    ) {
      newPrevPanelElLength =
        newPrevPanelElLength +
        (nextPanelElContext.initialMinLengthPx - newNextPanelElLength);
      newNextPanelElLength = nextPanelElContext.initialMinLengthPx;
    } else if (
      prevPanelElContext.initialMinLengthPx &&
      newPrevPanelElLength < prevPanelElContext.initialMinLengthPx &&
      newPrevPanelElLength < prevPanelElContext.lengthPx
    ) {
      newNextPanelElLength = newNextPanelElLength + newPrevPanelElLength;
      newPrevPanelElLength = 0;
    } else if (
      nextPanelElContext.initialMinLengthPx &&
      newNextPanelElLength < nextPanelElContext.initialMinLengthPx &&
      newNextPanelElLength < nextPanelElContext.lengthPx
    ) {
      newPrevPanelElLength = newPrevPanelElLength + newNextPanelElLength;
      newNextPanelElLength = 0;
    }

    this.setSiblingPanelContexts(
      prevPanelElId,
      nextPanelElId,
      newPrevPanelElLength,
      newNextPanelElLength,
      (prevPanelElContext.initialMinLengthPx &&
        newPrevPanelElLength >= prevPanelElContext.initialMinLengthPx) ||
        !prevPanelElContext.collapsible
        ? prevPanelElContext.initialMinLengthPx
        : 0,
      (nextPanelElContext.initialMinLengthPx &&
        newNextPanelElLength >= nextPanelElContext.initialMinLengthPx) ||
        !nextPanelElContext.collapsible
        ? nextPanelElContext.initialMinLengthPx
        : 0,
    );

    this.currentResizeHandle.initialPosition =
      event[this.clientPositionProperty];
  }

  // This event only applies to the first and last resize handler.
  // When triggered, it will close either the first or last panel.
  // In this scenario, the minimum length of the panel will be disregarded.
  @action
  onResizeHandleDblClick(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    let isFirstButton = buttonId.includes('0');
    let isLastButton = buttonId.includes(
      String(this.listPanelContext.size - 2),
    );
    let panelGroupLengthPx = this.panelGroupLengthWithoutResizeHandlePx;
    if (panelGroupLengthPx === undefined) {
      console.warn('Expected panelGroupLengthPx to be defined');
      return undefined;
    }

    let { prevPanelEl: prevPanelEl, nextPanelEl: nextPanelEl } =
      this.findPanelsByResizeHandle(buttonId);
    if (!prevPanelEl || !nextPanelEl) {
      console.warn('Expected prevPanelEl and nextPanelEl are required');
      return undefined;
    }

    let prevPanelElContext = this.listPanelContext.get(
      this.panelId(prevPanelEl.id),
    );
    let nextPanelElContext = this.listPanelContext.get(
      this.panelId(nextPanelEl.id),
    );
    if (!prevPanelElContext || !nextPanelElContext) {
      console.warn(
        'Expected prevPanelElContext && nextPanelElContext to be defined',
      );
      return undefined;
    }
    let prevPanelElLength = prevPanelElContext.lengthPx;
    let nextPanelElLength = nextPanelElContext.lengthPx;

    if (
      isFirstButton &&
      prevPanelElLength > 0 &&
      !this.args.reverseCollapse &&
      prevPanelElContext.collapsible
    ) {
      this.setSiblingPanelContexts(
        this.panelId(prevPanelEl.id),
        this.panelId(nextPanelEl.id),
        0,
        prevPanelElLength + nextPanelElLength,
        0,
        nextPanelElContext.initialMinLengthPx,
      );
    } else if (isFirstButton && prevPanelElLength <= 0) {
      this.setSiblingPanelContexts(
        this.panelId(prevPanelEl.id),
        this.panelId(nextPanelEl.id),
        prevPanelElContext.defaultLengthFraction
          ? panelGroupLengthPx * prevPanelElContext.defaultLengthFraction
          : prevPanelElContext.lengthPx,
        prevPanelElContext.defaultLengthFraction
          ? nextPanelElLength -
              panelGroupLengthPx * prevPanelElContext.defaultLengthFraction
          : panelGroupLengthPx - nextPanelElLength,
        prevPanelElContext.initialMinLengthPx,
        nextPanelElContext.initialMinLengthPx,
      );
    } else if (
      isLastButton &&
      nextPanelElLength > 0 &&
      nextPanelElContext.collapsible
    ) {
      this.setSiblingPanelContexts(
        this.panelId(prevPanelEl.id),
        this.panelId(nextPanelEl.id),
        prevPanelElLength + nextPanelElLength,
        0,
        prevPanelElContext.initialMinLengthPx,
        0,
      );
    } else if (isLastButton && nextPanelElLength <= 0) {
      this.setSiblingPanelContexts(
        this.panelId(prevPanelEl.id),
        this.panelId(nextPanelEl.id),
        nextPanelElContext.defaultLengthFraction
          ? prevPanelElLength -
              panelGroupLengthPx * nextPanelElContext.defaultLengthFraction
          : panelGroupLengthPx - prevPanelElLength,
        nextPanelElContext.defaultLengthFraction
          ? panelGroupLengthPx * nextPanelElContext.defaultLengthFraction
          : nextPanelElContext.lengthPx,
        prevPanelElContext.initialMinLengthPx,
        nextPanelElContext.initialMinLengthPx,
      );
    }
  }

  @action
  setSiblingPanelContexts(
    prevPanelElId: number,
    nextPanelElId: number,
    newPrevPanelElLength: number,
    newNextPanelElLength: number,
    newPrevPanelElMinLength?: number,
    newNextPanelElMinLength?: number,
  ) {
    let leftPanelContext = this.listPanelContext.get(prevPanelElId);
    if (leftPanelContext) {
      this.listPanelContext.set(prevPanelElId, {
        ...leftPanelContext,
        lengthPx: newPrevPanelElLength,
        minLengthPx: newPrevPanelElMinLength,
      });
    }

    let rightPanelContext = this.listPanelContext.get(nextPanelElId);
    if (rightPanelContext) {
      this.listPanelContext.set(nextPanelElId, {
        ...rightPanelContext,
        lengthPx: newNextPanelElLength,
        minLengthPx: newNextPanelElMinLength,
      });
    }

    this.args.onListPanelContextChange?.(
      Array.from(this.listPanelContext, ([_name, value]) => value),
    );
  }

  get panelRatios() {
    let panelLengths = Array.from(this.listPanelContext.values()).map(
      (panelContext) => panelContext.lengthPx,
    );

    let panelRatios = [];
    for (let index = 0; index < panelLengths.length; index++) {
      let panelLength = panelLengths[index];
      if (panelLength == undefined) {
        break;
      }
      panelRatios[index] = panelLength / sumArray(panelLengths);
    }
    return panelRatios;
  }

  @action
  onContainerResize(entry?: ResizeObserverEntry, _observer?: ResizeObserver) {
    if (!this.panelGroupElement) {
      if (entry) {
        this.panelGroupElement = entry.target as HTMLDivElement;
        next(this, this.onContainerResize, entry, _observer);
      }
      return;
    }

    this.hideHandles =
      this.panelGroupElement[this.perpendicularLengthProperty] <
      this.minimumLengthToShowHandles;

    let panelLengths: number[] = Array.from(this.listPanelContext.values()).map(
      (panelContext) => panelContext.lengthPx,
    );

    let newContainerSize = this.panelGroupLengthWithoutResizeHandlePx;
    if (newContainerSize == undefined) {
      console.warn('Expected newContainerSize to be defined');
      return;
    }

    let remainingContainerSize = newContainerSize;
    let calculateLengthsOfPanelWithMinLegth = () => {
      let panelContexts = Array.from(this.listPanelContext)
        .map((panelContextTuple) => panelContextTuple[1])
        .filter((panelContext) => panelContext.initialMinLengthPx);

      panelContexts.forEach((panelContext) => {
        let panelRatio = this.panelRatios[panelContext.id];
        if (!panelRatio || !newContainerSize) {
          console.warn(
            'Expected panelRatio and newContainerSize to be defined',
          );
          return;
        }
        let proportionalSize = panelRatio * newContainerSize;
        let actualSize = Math.round(
          panelContext?.initialMinLengthPx
            ? Math.max(proportionalSize, panelContext.initialMinLengthPx)
            : proportionalSize,
        );
        panelLengths[panelContext.id] = actualSize;
        remainingContainerSize = remainingContainerSize - actualSize;
      });
    };
    calculateLengthsOfPanelWithMinLegth();

    let calculateLengthsOfPanelWithoutMinLength = () => {
      let panelContexts = Array.from(this.listPanelContext)
        .map((panelContextTuple) => panelContextTuple[1])
        .filter((panelContext) => !panelContext.initialMinLengthPx);
      let panelContextIds = panelContexts.map(
        (panelContext) => panelContext.id,
      );
      let newPanelRatios = this.panelRatios.filter((_panelRatio, index) =>
        panelContextIds.includes(index),
      );
      let totalNewPanelRatio = newPanelRatios.reduce(
        (prevValue, currentValue) => prevValue + currentValue,
        0,
      );
      newPanelRatios = newPanelRatios.map(
        (panelRatio) => panelRatio / totalNewPanelRatio,
      );

      panelContexts.forEach((panelContext, index) => {
        let panelRatio = newPanelRatios[index];
        if (!panelRatio) {
          console.warn('Expected panelRatio to be defined');
          return;
        }
        let proportionalSize = panelRatio * remainingContainerSize;
        let actualSize = Math.round(proportionalSize);
        panelLengths[panelContext.id] = actualSize;
      });
    };
    calculateLengthsOfPanelWithoutMinLength();

    for (let index = 0; index <= this.listPanelContext.size; index++) {
      let panelContext = this.listPanelContext.get(index);
      if (panelContext) {
        this.listPanelContext.set(index, {
          ...panelContext,
          lengthPx: panelLengths[index] || 0,
        });
      }
    }
  }

  private findPanelsByResizeHandle(ResizeHandleId: string) {
    let idArr = ResizeHandleId.split('-');
    let ResizeHandleIdNumber = Number(idArr[idArr.length - 1]);
    if (ResizeHandleIdNumber == undefined) {
      return {
        prevPanelEl: undefined,
        nextPanelEl: undefined,
      };
    }
    let prevPanelEl = this.getHtmlElement(this.panelElId(ResizeHandleIdNumber));
    let nextPanelEl = this.getHtmlElement(
      this.panelElId(ResizeHandleIdNumber + 1),
    );
    return {
      prevPanelEl,
      nextPanelEl,
    };
  }

  private getHtmlElement(id: string): HTMLElement {
    return nodeFor(this, id);
  }

  @action
  private panelElId(id: number | undefined): string {
    return `${resizablePanelElIdPrefix}-${this.args.orientation}-${id}`;
  }

  private panelId(elId: string): number {
    let idArr = elId.split('-');
    return Number(idArr[idArr.length - 1]);
  }

  @action
  private ResizeHandleElId(id: number | undefined): string {
    return `${ResizeHandleElIdPrefix}-${this.args.orientation}-${id}`;
  }
}
