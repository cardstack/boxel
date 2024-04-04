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
  justRegistered: boolean = false;

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
  listPanelContext = new PanelContextMap();
  currentResizeHandle: {
    id: string;
    initialPosition: number;
    nextPanelEl?: HTMLElement | null;
    prevPanelEl?: HTMLElement | null;
  } | null = null;

  // regardless of what lengthPx is provided
  // ratios should definitely sum to 1 after setting all of this
  // if the lengths dont fit the screen, the lengths should be adapted
  // lengths may not adapt when length in the application storage is stale
  // the default fractions dont
  // we actually dont care about restoring the width unless the container size has changed
  // should we revert to default or keep it the same
  @action
  registerPanel(context: {
    collapsible: boolean | undefined;
    defaultLengthFraction: number | undefined;
    lengthPx: number | undefined;
    minLengthPx: number | undefined;
  }) {
    console.log('registering panel');
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

    let screenSize = this.panelGroupLengthPx;
    this.listPanelContext.set(
      id,
      {
        id,
        defaultLengthFraction: context.defaultLengthFraction,
        lengthPx: context.lengthPx,
        initialMinLengthPx: context.minLengthPx,
        minLengthPx: context.minLengthPx,
        collapsible:
          context.collapsible == undefined ? true : context.collapsible,
      },
      true,
      screenSize, //fill up the screen
    );

    if (this.args.orientation === 'horizontal' && context.minLengthPx !== 371) {
      //debugger;
      // if (
      //   this.listPanelContext.size === 3 &&
      //   this.listPanelContext.isLengthsStale(this.panelGroupLengthPx)
      // ) {
      //   console.log('length is stale');
      //   console.log(this.listPanelContext.sum);
      //   console.log(this.panelGroupLengthPx);
      // }
      // console.log('panel group length');
      // console.log(this.panelGroupLengthPx);
      // console.log('lengthPx');
      // console.log(context.lengthPx);
      // //debugger;
    }
    this.justRegistered = true;
    return id;
  }

  // ratios should be recalculated here
  @action
  unregisterPanel(id: number) {
    this.listPanelContext.delete(id);
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

  //onResize the ratios are changing
  // the size should remain the same
  @action
  onResizeHandleMouseMove(event: MouseEvent) {
    // console.log('on resize handle mouse move');
    // this gets triggered over hover its crazy
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
      this.listPanelContext.set(
        prevPanelElId,
        {
          ...leftPanelContext,
          lengthPx: newPrevPanelElLength,
          minLengthPx: newPrevPanelElMinLength,
        },
        true, // we realculate the ratios whenever the distribution of panels change
      );
    }

    let rightPanelContext = this.listPanelContext.get(nextPanelElId);
    if (rightPanelContext) {
      this.listPanelContext.set(
        nextPanelElId,
        {
          ...rightPanelContext,
          lengthPx: newNextPanelElLength,
          minLengthPx: newNextPanelElMinLength,
        },
        true, // we realculate the ratios whenever the distribution of panels change
      );
    }

    this.args.onListPanelContextChange?.(
      Array.from(
        this.listPanelContext.listPanelContext,
        ([_name, value]) => value,
      ),
    );
  }

  // when u resize the container
  // ratios should never change. one should never recalculate ratios
  // lengths may change
  // looks like reactivity doesn't seem to work when registering something
  // that becomes bigger than the screen we might need to use on containerResize
  @action
  onContainerResize(entry?: ResizeObserverEntry, _observer?: ResizeObserver) {
    if (this.justRegistered === true) {
      this.justRegistered = false;
      return;
    }
    console.log('on resize container');
    // if (this.args.orientation === 'horizontal') {
    //   //debugger;
    // }

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
    let newContainerSize = this.panelGroupLengthWithoutResizeHandlePx;
    if (newContainerSize == undefined) {
      console.warn('Expected newContainerSize to be defined');
      return;
    }
    // if (!this.listPanelContext.isLengthsStale(newContainerSize)) {
    //   console.log('length is not stale');
    //   return;
    // }
    if (this.args.orientation === 'horizontal') {
      if (entry && entry.contentRect.width === 1880) {
        return;
      }

      if (entry && entry.contentRect.width === 1920) {
        return;
      }
    }
    // console.log(`newContainerSize ${newContainerSize}`);

    // if (this.listPanelContext.isLengthsStale(newContainerSize)) {
    //   console.log('length is stale');
    // }
    // if (entry) {
    //   console.log(entry.contentRect.height);
    //   console.log(entry.contentRect.width);
    // }
    // this.listPanelContext.recomputeLengthsOnResize(newContainerSize);
    this.listPanelContext.recalculateLengthsFromCurrentRatios(newContainerSize);
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

type PanelContext1 = PanelContext & { ratio: number | undefined };

class PanelContextMap {
  #panelContextMap: TrackedMap<number, PanelContext> = new TrackedMap<
    number,
    PanelContext
  >();
  #ratios: Map<number, number> = new Map();

  get listPanelContext() {
    return this.#panelContextMap;
  }

  get size() {
    return this.#panelContextMap.size;
  }
  // we are safe to always recalculate ratio
  // we just dont want to recompute ratios when we r resizing. The ratios remain stale and we use them when recalculate lengths from ratios
  set(
    key: number,
    value: PanelContext,
    recompute = false,
    newScreenSize?: number,
  ) {
    let lengthPx =
      value.minLengthPx && value.minLengthPx > value.lengthPx
        ? value.minLengthPx
        : value.lengthPx;
    this.#panelContextMap.set(key, {
      ...value,
      lengthPx,
    });
    if (recompute === true) {
      this.recalculateRatios();
    }
    if (newScreenSize !== undefined) {
      // if (this.isLengthsStale(newScreenSize)) {
      console.log('windiow size', window.innerWidth);
      console.log('screen size', newScreenSize);
      console.log('length px', lengthPx);
      console.log('minLengthPx px', value.minLengthPx);
      console.log('default length fraction px', value.defaultLengthFraction);
      //if length is stale than revert this
      // if (this.isLengthsStale(newScreenSize)) {
      this.recalculateLengthsFromDefaultLengthFraction(newScreenSize);
      // }
      // }
      // }
    }
    // if (newScreenSize !== undefined) {
    //   // this.recalculateLengths(newScreenSize);
    // }
    return this;
  }

  //returns ratio also
  get(key: number): PanelContext1 {
    let val = this.#panelContextMap.get(key);
    return { ...val, ratio: this.#ratios.get(key) } as PanelContext1;
  }

  delete(key: number) {
    // let originalSize = this.sum;
    this.#panelContextMap.delete(key);
    this.#ratios.delete(key);
    //we intentionally do not recompute ratios at the end bcos if we did that then the ratios will be morphed
    //this keeps the memory of the last ratio
    // this.recalculateRatios();
    // this.recalculateLengthsFromDefaultLengthFraction(originalSize);
  }

  remainingContainerSize(screenSize: number) {
    return screenSize - this.totalLengthInitialhMinLengthPx;
  }

  get totalLengthInitialhMinLengthPx() {
    let initialMinLengthPxs: number[] = Array.from(
      this.#panelContextMap.values(),
    )
      .filter((o) => o.initialMinLengthPx)
      .map((o) => o.initialMinLengthPx!);
    return sumArray(initialMinLengthPxs);
  }

  get lengths() {
    let panelLengths: number[] = Array.from(this.#panelContextMap.values()).map(
      (panelContext) => panelContext.lengthPx,
    );
    return panelLengths;
  }

  get sum() {
    return sumArray(this.lengths);
  }

  get ratios() {
    // let ratios = Array.from(this.values()).map((o) => o.ratio);
    // return ratios.filter((r) => r !== undefined);
    return Array.from(this.#ratios.values());
  }

  get defaultLengthFractions() {
    // let ratios = Array.from(this.values()).map((o) => o.ratio);
    // return ratios.filter((r) => r !== undefined);
    let vals = Array.from(this.#panelContextMap.values());
    let valsWithDefaultLengthFraction = vals.filter(
      (o) => o.defaultLengthFraction !== undefined,
    );
    if (vals.length !== valsWithDefaultLengthFraction.length) {
      throw new Error('not all vals have defaultLengthFraction');
    }
    return valsWithDefaultLengthFraction.map(
      (o) => o.defaultLengthFraction,
    ) as number[];
  }

  get isRatioStale() {
    let tolerance = 0.05;
    let ratioSum = sumArray(this.ratios);
    // console.log(`current ratio sum ${ratioSum}`);
    // console.log(this.ratios);
    return Math.abs(ratioSum - 1) > tolerance;
  }

  isLengthsStale(fullWidth: number) {
    let tolerance = 0.05; //%//px
    console.log('length tolerance', tolerance);

    console.log(`sum vs fullWidth: ${this.sum} vs ${fullWidth}`);
    return Math.abs(fullWidth - this.sum) > tolerance * fullWidth;
  }

  //from lengths
  //when adding your ratios will be stale
  recalculateRatios() {
    if (this.sum === 0) {
      console.warn('sum = 0 ');
      return;
    }
    for (const [k, v] of this.#panelContextMap.entries()) {
      if (v.lengthPx === undefined) {
        throw new Error('h');
      }
      let ratio = v.lengthPx / this.sum;
      this.#ratios.set(k, ratio);
    }
    console.log('Ratios recalculated');
  }

  recalculateLengthsFromCurrentRatios(screenSize: number) {
    console.log('recaclculating lengths from ratios');
    if (this.isRatioStale) {
      console.log('ratios are stale not recalculating lengths');
      return;
    }
    for (const [k, v] of this.#panelContextMap.entries()) {
      let ratio = this.#ratios.get(k);
      if (!ratio) {
        throw new Error('ratio unattainable');
      }
      this.set(
        k,
        {
          ...v,
          lengthPx: Math.round(screenSize * ratio),
        },
        false,
      );
    }
  }

  recalculateLengthsFromDefaultLengthFraction(screenSize: number) {
    console.log('recaclculating lengths from default length fraction');
    for (const [_, v] of this.#panelContextMap.entries()) {
      if (v.defaultLengthFraction === undefined) {
        console.log('default length fraction doesn not exist');
        //debugger;
        return;
      }
    }
    let totalRatios = sumArray(this.defaultLengthFractions);

    for (const [k, v] of this.#panelContextMap.entries()) {
      if (this.#panelContextMap.size === 3) {
        console.log('===default length recompute');
        console.log('id', k);
        console.log('lengtPx', v.lengthPx);
        console.log('initialMinLenghtPx', v.initialMinLengthPx);
        if (v.initialMinLengthPx === 2000 || v.minLengthPx === 2000) {
          debugger;
        }
        console.log('ratio', this.#ratios.get(k));
      }
      let ratio = v.defaultLengthFraction! / totalRatios; // be very careful when normalising with fractions
      this.set(
        k,
        {
          ...v,
          lengthPx: Math.round(screenSize * ratio),
        },
        false,
      );
      this.#ratios.set(k, ratio);
    }
  }

  recomputeLengthsOnResize(newSize: number) {
    //keep ratios stale
    let remainingContainerSize = newSize;
    if (this.isRatioStale) {
      throw new Error('ratio is stale');
    }
    let totalNewPanelRatio = sumArray(this.ratios);

    // let totalNewPanelRatio = Array.from(this.values())
    //   .filter((c) => !c.initialMinLengthPx && c.ratio)
    //   .map((c) => c.ratio!)
    //   .reduce((accum, currentValue) => {
    //     if (currentValue) {
    //       return accum + currentValue;
    //     } else {
    //       return accum;
    //     }
    //   }, 0);
    if (totalNewPanelRatio === 0) {
      if (this.size === 3) {
        //debugger;
      }
      throw new Error('new ratio 0');
    }
    // for (const [k, v] of this.entries()) {
    //   if (v.initialMinLengthPx) {
    //     let proportionalSize = v.ratio * newSize;
    //     let actualSize = proportionalSize; //v.initialMinLengthPx;
    //     // Math.round(Math.max(proportionalSize, v.initialMinLengthPx)); //tricky
    //     this.set(k, { ...v, lengthPx: actualSize }, false);
    //   }
    // }
    // remainingContainerSize =
    //   remainingContainerSize - this.totalLengthInitialhMinLengthPx;
    // let totalNewPanelRatio = Array.from(this.values())
    //   .filter((c) => !c.initialMinLengthPx && c.ratio)
    //   .map((c) => c.ratio!)
    //   .reduce((accum, currentValue) => {
    //     if (currentValue) {
    //       return accum + currentValue;
    //     } else {
    //       return accum;
    //    4
    //   }, 0);
    // if (totalNewPanelRatio === 0) {
    //   return;
    // }
    for (const [k, v] of this.#panelContextMap.entries()) {
      if (!v.initialMinLengthPx) {
        let ratio = this.#ratios.get(k);
        if (ratio === undefined) {
          //debugger;
          throw new Error('ratio undefined');
        }
        let newPanelRatio = ratio / totalNewPanelRatio;
        this.#ratios.set(k, newPanelRatio);

        let proportionalSize = newPanelRatio * remainingContainerSize;
        let actualSize = Math.round(proportionalSize);
        this.set(
          k,
          {
            ...v,
            lengthPx: actualSize,
          },
          false,
        );
      }
    }
  }
}
