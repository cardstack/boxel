import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { WithBoundArgs } from '@glint/template';
import { nodeFor } from 'ember-ref-bucket';
import { resolveGlobalRef } from 'ember-ref-bucket/utils/ref';
import didResizeModifier from 'ember-resize-modifier/modifiers/did-resize';
import { TrackedMap } from 'tracked-built-ins';

import type { PanelContext } from './panel.gts';
import ResizablePanel from './panel.gts';

function sumArray(array: number[]) {
  return array.reduce((partialSum, a) => partialSum + a, 0);
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
        | 'hideHandle'
        | 'isLastPanel'
        | 'onResizeHandlerMouseDown'
        | 'onResizeHandlerDblClick'
        | 'orientation'
        | 'panelContext'
        | 'registerPanel'
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
            panelContext=this.panelContext
            isLastPanel=this.isLastPanel
            onResizeHandlerMouseDown=this.onResizeHandlerMouseDown
            onResizeHandlerDblClick=this.onResizeHandlerDblClick
            reverseHandlerArrow=@reverseCollapse
            hideHandle=this.hideHandles
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

    document.addEventListener('mouseup', this.onResizeHandlerMouseUp);
    document.addEventListener('mousemove', this.onResizeHandlerMouseMove);

    registerDestructor(this, () => {
      document.removeEventListener('mouseup', this.onResizeHandlerMouseUp);
      document.removeEventListener('mousedown', this.onResizeHandlerMouseMove);
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

  private get panelGroupLengthWithoutResizeHandlerPx() {
    let resizeHandlerSelector = `resize-handler-${this.args.orientation}-0`;
    let resizeHandlerEl = this.getHtmlElement(resizeHandlerSelector);
    if (!resizeHandlerEl) {
      console.error(
        `Could not find selector: ${resizeHandlerSelector} when handling window resize for resizeable panel group`,
      );
      return undefined;
    }
    let resizeHandleContainer = (resizeHandlerEl as HTMLElement).parentElement!;
    let resizeHandlerLength = resizeHandleContainer[this.offsetLengthProperty];
    let totalResizeHandlerLength =
      resizeHandlerLength * (this.listPanelContext.size - 1);
    let panelGroupLengthPx = this.panelGroupLengthPx;
    if (panelGroupLengthPx === undefined) {
      console.warn('Expected panelGroupLengthPx to be defined');
      return undefined;
    }
    return panelGroupLengthPx - totalResizeHandlerLength;
  }

  @tracked hideHandles = false;
  minimumLengthToShowHandles = 30;

  listPanelContext = new TrackedMap<number, PanelContext>();
  currentResizeHandler: {
    firstEl?: HTMLElement | null;
    id: string;
    initialPosition: number;
    secondEl?: HTMLElement | null;
  } | null = null;
  panelRatios: number[] = [];

  @action
  registerPanel(context: {
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
    this.listPanelContext.set(id, {
      id,
      defaultLengthFraction: context.defaultLengthFraction,
      lengthPx: context.lengthPx,
      initialMinLengthPx: context.minLengthPx,
      minLengthPx: context.minLengthPx,
    });

    this.calculatePanelRatio();

    return id;
  }

  calculatePanelRatio() {
    let panelLengths = Array.from(this.listPanelContext.values()).map(
      (panelContext) => panelContext.lengthPx,
    );

    for (let index = 0; index < panelLengths.length; index++) {
      let panelLength = panelLengths[index];
      if (panelLength == undefined) {
        break;
      }
      this.panelRatios[index] = panelLength / sumArray(panelLengths);
    }
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
  onResizeHandlerMouseDown(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    if (this.currentResizeHandler || !buttonId) {
      return;
    }

    let parentElement = this.getHtmlElement(buttonId).parentElement;
    this.currentResizeHandler = {
      id: buttonId,
      initialPosition: event[this.clientPositionProperty],
      firstEl: parentElement?.previousElementSibling as HTMLElement,
      secondEl: parentElement?.nextElementSibling as HTMLElement,
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
      !this.currentResizeHandler.firstEl ||
      !this.currentResizeHandler.secondEl
    ) {
      return;
    }

    let delta =
      event[this.clientPositionProperty] -
      this.currentResizeHandler.initialPosition;
    if (delta === 0) {
      return;
    }

    let newFirstElLength =
      this.currentResizeHandler.firstEl[this.clientLengthProperty] + delta;
    let newSecondElLength =
      this.currentResizeHandler.secondEl[this.clientLengthProperty] - delta;
    let firstElId = Number(this.currentResizeHandler.firstEl?.id);
    let secondElId = Number(this.currentResizeHandler.secondEl?.id);
    let firstElContext = this.listPanelContext.get(Number(firstElId));
    let secondElContext = this.listPanelContext.get(Number(secondElId));
    if (!firstElContext || !secondElContext) {
      console.warn('Expected firstElContext && secondElContext to be defined');
      return;
    }

    if (newFirstElLength < 0 && newSecondElLength > 0) {
      newSecondElLength = newSecondElLength + newFirstElLength;
      newFirstElLength = 0;
    } else if (newFirstElLength > 0 && newSecondElLength < 0) {
      newFirstElLength = newFirstElLength + newSecondElLength;
      newSecondElLength = 0;
    } else if (
      firstElContext.initialMinLengthPx &&
      newFirstElLength < firstElContext.initialMinLengthPx &&
      newFirstElLength > firstElContext.lengthPx
    ) {
      newSecondElLength =
        newSecondElLength -
        (firstElContext.initialMinLengthPx - newFirstElLength);
      newFirstElLength = firstElContext.initialMinLengthPx;
    } else if (
      secondElContext.initialMinLengthPx &&
      newSecondElLength < secondElContext.initialMinLengthPx &&
      newSecondElLength > secondElContext.lengthPx
    ) {
      newFirstElLength =
        newFirstElLength +
        (secondElContext.initialMinLengthPx - newSecondElLength);
      newSecondElLength = secondElContext.initialMinLengthPx;
    } else if (
      firstElContext.initialMinLengthPx &&
      newFirstElLength < firstElContext.initialMinLengthPx &&
      newFirstElLength < firstElContext.lengthPx
    ) {
      newSecondElLength = newSecondElLength + newFirstElLength;
      newFirstElLength = 0;
    } else if (
      secondElContext.initialMinLengthPx &&
      newSecondElLength < secondElContext.initialMinLengthPx &&
      newSecondElLength < secondElContext.lengthPx
    ) {
      newFirstElLength = newFirstElLength + newSecondElLength;
      newSecondElLength = 0;
    }

    this.setSiblingPanelContexts(
      firstElId,
      secondElId,
      newFirstElLength,
      newSecondElLength,
      firstElContext.initialMinLengthPx &&
        newFirstElLength >= firstElContext.initialMinLengthPx
        ? firstElContext.initialMinLengthPx
        : 0,
      secondElContext.initialMinLengthPx &&
        newSecondElLength >= secondElContext.initialMinLengthPx
        ? secondElContext.initialMinLengthPx
        : 0,
    );

    this.currentResizeHandler.initialPosition =
      event[this.clientPositionProperty];

    this.calculatePanelRatio();
  }

  // This event only applies to the first and last resize handler.
  // When triggered, it will close either the first or last panel.
  // In this scenario, the minimum length of the panel will be disregarded.
  @action
  onResizeHandlerDblClick(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
    let isFirstButton = buttonId.includes('0');
    let isLastButton = buttonId.includes(
      String(this.listPanelContext.size - 2),
    );
    let panelGroupLengthPx = this.panelGroupLengthWithoutResizeHandlerPx;
    if (panelGroupLengthPx === undefined) {
      console.warn('Expected panelGroupLengthPx to be defined');
      return undefined;
    }

    let parentElement = this.getHtmlElement(buttonId).parentElement;
    let prevEl = parentElement?.previousElementSibling as HTMLElement;
    let nextEl = parentElement?.nextElementSibling as HTMLElement;

    let prevElContext = this.listPanelContext.get(Number(prevEl.id));
    let nextElContext = this.listPanelContext.get(Number(nextEl.id));
    if (!prevElContext || !nextElContext) {
      console.warn('Expected prevElContext && nextElContext to be defined');
      return undefined;
    }
    let prevElLength = prevElContext.lengthPx;
    let nextElLength = nextElContext.lengthPx;
    if (isFirstButton && prevElLength > 0 && !this.args.reverseCollapse) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        0,
        prevElLength + nextElLength,
        0,
        nextElContext.initialMinLengthPx,
      );
    } else if (isFirstButton && prevElLength <= 0) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        prevElContext.defaultLengthFraction
          ? panelGroupLengthPx * prevElContext.defaultLengthFraction
          : prevElContext.lengthPx,
        prevElContext.defaultLengthFraction
          ? nextElLength -
              panelGroupLengthPx * prevElContext.defaultLengthFraction
          : panelGroupLengthPx - nextElLength,
        prevElContext.initialMinLengthPx,
        nextElContext.initialMinLengthPx,
      );
    } else if (isLastButton && nextElLength > 0) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        prevElLength + nextElLength,
        0,
        prevElContext.initialMinLengthPx,
        0,
      );
    } else if (isLastButton && nextElLength <= 0) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        nextElContext.defaultLengthFraction
          ? prevElLength -
              panelGroupLengthPx * nextElContext.defaultLengthFraction
          : panelGroupLengthPx - prevElLength,
        nextElContext.defaultLengthFraction
          ? panelGroupLengthPx * nextElContext.defaultLengthFraction
          : nextElContext.lengthPx,
        prevElContext.initialMinLengthPx,
        nextElContext.initialMinLengthPx,
      );
    }

    this.calculatePanelRatio();
  }

  @action
  setSiblingPanelContexts(
    firstElId: number,
    secondElId: number,
    newFirstElLength: number,
    newSecondElLength: number,
    newFirstElMinLength?: number,
    newSecondElMinLength?: number,
  ) {
    let leftPanelContext = this.listPanelContext.get(firstElId);
    if (leftPanelContext) {
      this.listPanelContext.set(firstElId, {
        ...leftPanelContext,
        lengthPx: newFirstElLength,
        minLengthPx: newFirstElMinLength,
      });
    }

    let rightPanelContext = this.listPanelContext.get(secondElId);
    if (rightPanelContext) {
      this.listPanelContext.set(secondElId, {
        ...rightPanelContext,
        lengthPx: newSecondElLength,
        minLengthPx: newSecondElMinLength,
      });
    }

    this.args.onListPanelContextChange?.(
      Array.from(this.listPanelContext, ([_name, value]) => value),
    );
  }

  @action
  onContainerResize(entry: ResizeObserverEntry, _observer: ResizeObserver) {
    if (!this.panelGroupElement) {
      this.panelGroupElement = entry.target as HTMLDivElement;
      next(this, this.onContainerResize, entry, _observer);
      return;
    }

    this.hideHandles =
      this.panelGroupElement[this.perpendicularLengthProperty] <
      this.minimumLengthToShowHandles;

    let panelLengths: number[] = Array.from(this.listPanelContext.values()).map(
      (panelContext) => panelContext.lengthPx,
    );
    let newContainerSize = this.panelGroupLengthWithoutResizeHandlerPx;
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

  private getHtmlElement(id: string): HTMLElement {
    return nodeFor(resolveGlobalRef(), id);
  }
}
