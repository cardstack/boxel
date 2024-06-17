import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { WithBoundArgs } from '@glint/template';
import { nodeFor } from 'ember-ref-bucket';
import didResizeModifier from 'ember-resize-modifier/modifiers/did-resize';
import { TrackedArray } from 'tracked-built-ins';

import type { PanelContext as PanelContextType } from './panel.gts';
import ResizablePanel from './panel.gts';
import ResizeHandle from './resize-handler.gts';

export { default as ResizablePanel } from './panel.gts';
export { default as ResizeHandle } from './resize-handler.gts';

function sumArray(array: number[]) {
  return array.reduce((partialSum, a) => partialSum + a, 0);
}

const ResizeHandleElIdPrefix = 'resize-handler';

class PanelContext implements PanelContextType {
  @tracked collapsible = false;
  @tracked defaultLengthFraction?: number;
  @tracked initialMinLengthPx?: number;
  @tracked isHidden?: boolean;
  @tracked lengthPx = 0;
  @tracked minLengthPx?: number;
  @tracked panel?: ResizablePanel | undefined;

  constructor(args: PanelContextType) {
    this.collapsible = args.collapsible;
    this.defaultLengthFraction = args.defaultLengthFraction;
    this.initialMinLengthPx = args.initialMinLengthPx;
    this.isHidden = args.isHidden;
    this.lengthPx = args.lengthPx;
    this.minLengthPx = args.minLengthPx;
    this.panel = args.panel;
  }
}

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
            isLastPanel=this.isLastPanel
            panelGroupComponent=this
          )
          (component
            ResizeHandle
            orientation=@orientation
            registerResizeHandle=this.registerResizeHandle
            unRegisterResizeHandle=this.unRegisterResizeHandle
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
  minimumLengthToShowHandles = 30;

  resizablePanelIdCache = new WeakMap<ResizablePanel, number>();
  panelContexts = new TrackedArray<PanelContext>();
  resizeHandles = new TrackedArray<ResizeHandle>();

  currentResizeHandle: {
    handle: ResizeHandle;
    initialPosition: number;
    nextPanelContext?: PanelContext | null;
    prevPanelContext?: PanelContext | null;
  } | null = null;
  panelRatios: number[] = [];

  @action
  registerPanel(panel: ResizablePanel) {
    let context = new PanelContext({
      panel,
      defaultLengthFraction: panel.args.defaultLengthFraction,
      lengthPx: panel.args.lengthPx,
      initialMinLengthPx: panel.args.minLengthPx,
      minLengthPx: panel.args.minLengthPx,
      collapsible:
        panel.args.collapsible == undefined ? true : panel.args.collapsible,
      isHidden: panel.args.isHidden,
    }) as PanelContext;

    if (context.lengthPx === undefined) {
      if (
        this.panelGroupLengthPx === undefined ||
        context.defaultLengthFraction === undefined
      ) {
        context.lengthPx = -1;
      } else if (context.isHidden) {
        context.lengthPx = 0;
      } else {
        context.lengthPx =
          context.defaultLengthFraction * this.panelGroupLengthPx;
      }
    }

    this.panelContexts.push(context);
    panel.setPanelContext(context);
    this.calculatePanelRatio();
  }

  @action
  unregisterPanel(panel: ResizablePanel) {
    let panelContextIndex = this.panelContexts.findIndex(
      (context) => context.panel === panel,
    );

    if (panelContextIndex > -1) {
      this.panelContexts.splice(panelContextIndex, 1);
      this.calculatePanelRatio();
    }
  }

  calculatePanelRatio() {
    let panelLengths = this.panelContexts.map(
      (panelContext) => panelContext.lengthPx,
    );

    this.panelRatios = [];
    for (let index = 0; index < panelLengths.length; index++) {
      let panelLength = panelLengths[index];
      if (panelLength == undefined) {
        break;
      }
      this.panelRatios[index] = panelLength / sumArray(panelLengths);
    }
  }

  @action
  isLastPanel(panel: ResizablePanel) {
    return this.panelContexts[this.panelContexts.length - 1]?.panel === panel;
  }

  @action
  registerResizeHandle(handle: ResizeHandle) {
    this.resizeHandles.push(handle);
  }

  @action
  unRegisterResizeHandle(handle: ResizeHandle) {
    let handleIndex = this.resizeHandles.indexOf(handle);
    if (handleIndex > -1) {
      this.resizeHandles.splice(handleIndex, 1);
    }
  }

  get totalResizeHandle() {
    return this.resizeHandles.length;
  }

  @action
  onResizeHandleMouseDown(event: MouseEvent) {
    let button = event.target as HTMLElement;

    let handle = this.resizeHandles.find(
      (handle) => handle.element === button.parentNode,
    );

    console.log('handle mouse down', button, handle);

    if (this.currentResizeHandle || !handle) {
      return;
    }

    let { prevPanelContext, nextPanelContext } =
      this.findPanelsByResizeHandle(handle);
    if (!prevPanelContext || !nextPanelContext) {
      console.warn('prevPanelEl and nextPanelEl are required');
      return undefined;
    }
    this.currentResizeHandle = {
      handle,
      initialPosition: event[this.clientPositionProperty],
      prevPanelContext: prevPanelContext,
      nextPanelContext: nextPanelContext,
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
      !this.currentResizeHandle.prevPanelContext?.panel ||
      !this.currentResizeHandle.nextPanelContext?.panel
    ) {
      return;
    }

    let delta =
      event[this.clientPositionProperty] -
      this.currentResizeHandle.initialPosition;
    if (delta === 0) {
      console.log('delta is 0, returning early!');
      return;
    }

    console.log(`delta is non-zero ${delta}`);

    let newPrevPanelElLength =
      this.currentResizeHandle.prevPanelContext.panel.element[
        this.clientLengthProperty
      ] + delta;
    let newNextPanelElLength =
      this.currentResizeHandle.nextPanelContext.panel.element[
        this.clientLengthProperty
      ] - delta;
    let prevPanelElContext = this.currentResizeHandle.prevPanelContext;
    let nextPanelElContext = this.currentResizeHandle.nextPanelContext;

    console.log('newPrevPanelElLength', newPrevPanelElLength);
    console.log('newNextPanelElLength', newNextPanelElLength);
    console.log('prevPanelElContext', prevPanelElContext);
    console.log('nextPanelElContext', nextPanelElContext);

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

    console.log(
      'calling setSiblingPanelContexts in mouseMove',
      prevPanelElContext,
      nextPanelElContext,
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

    this.setSiblingPanelContexts(
      prevPanelElContext,
      nextPanelElContext,
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

    console.log(
      'currentResizeHandle initialPosition was ' +
        this.currentResizeHandle.initialPosition,
    );
    this.currentResizeHandle.initialPosition =
      event[this.clientPositionProperty];
    console.log(
      'currentResizeHandle initialPosition is ' +
        this.currentResizeHandle.initialPosition,
    );

    this.calculatePanelRatio();
  }

  // This event only applies to the first and last resize handler.
  // When triggered, it will close either the first or last panel.
  // In this scenario, the minimum length of the panel will be disregarded.
  @action
  onResizeHandleDblClick(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    let isFirstButton = buttonId.includes('0');
    let isLastButton = buttonId.includes(String(this.panelContexts.length - 2));
    let panelGroupLengthPx = this.panelGroupLengthWithoutResizeHandlePx;
    if (panelGroupLengthPx === undefined) {
      console.warn('Expected panelGroupLengthPx to be defined');
      return undefined;
    }

    let { prevPanelContext, nextPanelContext } =
      this.findPanelsByResizeHandle(buttonId);
    if (!prevPanelContext || !nextPanelContext) {
      console.warn('prevPanelContext and nextPanelContext are required');
      return undefined;
    }

    let prevPanelElLength = prevPanelContext.lengthPx;
    let nextPanelElLength = nextPanelContext.lengthPx;

    if (
      isFirstButton &&
      prevPanelElLength > 0 &&
      !this.args.reverseCollapse &&
      prevPanelContext.collapsible
    ) {
      this.setSiblingPanelContexts(
        prevPanelContext,
        nextPanelContext,
        0,
        prevPanelElLength + nextPanelElLength,
        0,
        nextPanelContext.initialMinLengthPx,
      );
    } else if (isFirstButton && prevPanelElLength <= 0) {
      this.setSiblingPanelContexts(
        prevPanelContext,
        nextPanelContext,
        prevPanelContext.defaultLengthFraction
          ? panelGroupLengthPx * prevPanelContext.defaultLengthFraction
          : prevPanelContext.lengthPx,
        prevPanelContext.defaultLengthFraction
          ? nextPanelElLength -
              panelGroupLengthPx * prevPanelContext.defaultLengthFraction
          : panelGroupLengthPx - nextPanelElLength,
        prevPanelContext.initialMinLengthPx,
        nextPanelContext.initialMinLengthPx,
      );
    } else if (
      isLastButton &&
      nextPanelElLength > 0 &&
      nextPanelContext.collapsible
    ) {
      this.setSiblingPanelContexts(
        prevPanelContext,
        nextPanelContext,
        prevPanelElLength + nextPanelElLength,
        0,
        prevPanelContext.initialMinLengthPx,
        0,
      );
    } else if (isLastButton && nextPanelElLength <= 0) {
      this.setSiblingPanelContexts(
        prevPanelContext,
        nextPanelContext,
        nextPanelContext.defaultLengthFraction
          ? prevPanelElLength -
              panelGroupLengthPx * nextPanelContext.defaultLengthFraction
          : panelGroupLengthPx - prevPanelElLength,
        nextPanelContext.defaultLengthFraction
          ? panelGroupLengthPx * nextPanelContext.defaultLengthFraction
          : nextPanelContext.lengthPx,
        prevPanelContext.initialMinLengthPx,
        nextPanelContext.initialMinLengthPx,
      );
    }

    this.calculatePanelRatio();
  }

  @action
  setSiblingPanelContexts(
    leftPanelContext: PanelContext,
    rightPanelContext: PanelContext,
    newPrevPanelElLength: number,
    newNextPanelElLength: number,
    newPrevPanelElMinLength?: number,
    newNextPanelElMinLength?: number,
  ) {
    // FIXME left/right should be before/after
    if (leftPanelContext) {
      console.log(
        `leftPanelContext updates length: ${newPrevPanelElLength}, min: ${newPrevPanelElMinLength}`,
      );
      console.log('lpc is', leftPanelContext);
      leftPanelContext.lengthPx = newPrevPanelElLength;
      leftPanelContext.minLengthPx = newPrevPanelElMinLength;
    }

    if (rightPanelContext) {
      console.log(
        `rightPanelContext updates length: ${newNextPanelElLength}, min: ${newNextPanelElMinLength}`,
      );
      rightPanelContext.lengthPx = newNextPanelElLength;
      rightPanelContext.minLengthPx = newNextPanelElMinLength;
    }

    this.args.onListPanelContextChange?.(this.panelContexts);
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

    let panelLengths: number[] = this.panelContexts.map(
      (panelContext) => panelContext.lengthPx,
    );

    console.log('panelLengths', panelLengths);

    let newContainerSize = this.panelGroupLengthWithoutResizeHandlePx;
    if (newContainerSize == undefined) {
      console.warn('Expected newContainerSize to be defined');
      return;
    }

    let remainingContainerSize = newContainerSize;
    let calculateLengthsOfPanelWithMinLegth = () => {
      let panelContexts = this.panelContexts.filter(
        (panelContext) => panelContext.initialMinLengthPx,
      );

      panelContexts.forEach((panelContext, index) => {
        let panelRatio = this.panelRatios[index];
        if (!panelRatio || !newContainerSize) {
          return;
        }
        let proportionalSize = panelRatio * newContainerSize;
        let actualSize = Math.round(
          panelContext?.initialMinLengthPx
            ? Math.max(proportionalSize, panelContext.initialMinLengthPx)
            : proportionalSize,
        );
        panelLengths[index] = actualSize;
        remainingContainerSize = remainingContainerSize - actualSize;
      });
    };
    calculateLengthsOfPanelWithMinLegth();

    let calculateLengthsOfPanelWithoutMinLength = () => {
      let panelContexts = this.panelContexts.filter(
        (panelContext) => !panelContext.initialMinLengthPx,
      );
      // FIXME probably removable?
      let panelContextIds = panelContexts.map((_panelContext, index) => index);
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

      panelContexts.forEach((_panelContext, index) => {
        let panelRatio = newPanelRatios[index];
        if (!panelRatio) {
          console.warn('Expected panelRatio to be defined');
          return;
        }
        let proportionalSize = panelRatio * remainingContainerSize;
        let actualSize = Math.round(proportionalSize);
        panelLengths[index] = actualSize;
      });
    };
    calculateLengthsOfPanelWithoutMinLength();

    for (let index = 0; index <= this.panelContexts.length; index++) {
      let panelContext = this.panelContexts[index];
      if (panelContext) {
        panelContext.lengthPx = panelLengths[index] || 0;
      }
    }
  }

  private findPanelsByResizeHandle(handle: ResizeHandle) {
    let handleIndex = this.resizeHandles.indexOf(handle);
    if (handleIndex === -1) {
      return {
        prevPanelContext: undefined,
        nextPanelContext: undefined,
      };
    }

    let prevPanelContext = this.panelContexts[handleIndex];
    let nextPanelContext = this.panelContexts[handleIndex + 1];

    return {
      prevPanelContext,
      nextPanelContext,
    };
  }

  private getHtmlElement(id: string): HTMLElement {
    return nodeFor(this, id);
  }

  @action
  private ResizeHandleElId(id: number | undefined): string {
    return `${ResizeHandleElIdPrefix}-${this.args.orientation}-${id}`;
  }
}
