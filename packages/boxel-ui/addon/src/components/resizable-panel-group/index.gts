import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { WithBoundArgs } from '@glint/template';
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

  private get cssMinLengthProperty() {
    return this.isHorizontal ? 'min-width' : 'min-height';
  }

  private get perpendicularLengthProperty() {
    return this.isHorizontal ? 'clientHeight' : 'clientWidth';
  }

  private get panelGroupLengthPx() {
    return this.panelGroupElement?.[this.offsetLengthProperty];
  }

  private get panelGroupLengthWithoutResizeHandlerPx() {
    let resizeHandlerSelector = `#resize-handler-${this.args.orientation}-1`;
    let resizeHandlerEl = this.panelGroupElement?.querySelector(
      resizeHandlerSelector,
    ) as HTMLElement;
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
  panelRatio: number[] = [];

  @action
  registerPanel(context: {
    defaultLengthFraction: number | undefined;
    lengthPx: number | undefined;
    minLengthPx: number | undefined;
  }) {
    let id = Number(this.listPanelContext.size + 1);
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
      defaultLengthFraction: context.defaultLengthFraction,
      lengthPx: context.lengthPx,
      minLengthPx: context.minLengthPx,
    });

    this.calculatePanelRatio();

    return id;
  }

  @action
  calculatePanelRatio() {
    let panelLengths = Array.from(this.listPanelContext.values()).map(
      (panelContext) => panelContext.lengthPx,
    );

    for (let index = 0; index < panelLengths.length; index++) {
      let panelLength = panelLengths[index];
      if (panelLength == undefined) {
        break;
      }
      this.panelRatio[index] = panelLength / sumArray(panelLengths);
    }
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
    let newFirstElLength =
      this.currentResizeHandler.firstEl[this.clientLengthProperty] + delta;
    let newSecondElLength =
      this.currentResizeHandler.secondEl[this.clientLengthProperty] - delta;
    if (newFirstElLength < 0 && newSecondElLength > 0) {
      newSecondElLength = newSecondElLength + newFirstElLength;
      newFirstElLength = 0;
    } else if (newFirstElLength > 0 && newSecondElLength < 0) {
      newFirstElLength = newFirstElLength + newSecondElLength;
      newSecondElLength = 0;
    }

    let firstElMinLength = parseInt(
      window
        .getComputedStyle(this.currentResizeHandler.firstEl)
        .getPropertyValue(this.cssMinLengthProperty),
    );
    let secondElMinLength = parseInt(
      window
        .getComputedStyle(this.currentResizeHandler.secondEl)
        .getPropertyValue(this.cssMinLengthProperty),
    );
    if (
      (firstElMinLength && newFirstElLength < firstElMinLength) ||
      (secondElMinLength && newSecondElLength < secondElMinLength)
    ) {
      return;
    }

    let firstElId = Number(this.currentResizeHandler.firstEl?.id);
    let secondElId = Number(this.currentResizeHandler.secondEl?.id);
    this.setSiblingPanelContexts(
      firstElId,
      secondElId,
      newFirstElLength,
      newSecondElLength,
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
    let panelGroupLengthPx = this.panelGroupLengthWithoutResizeHandlerPx;
    if (panelGroupLengthPx === undefined) {
      console.warn('Expected panelGroupLengthPx to be defined');
      return undefined;
    }

    let parentElement = document.querySelector(`#${buttonId}`)?.parentElement;
    let prevEl = parentElement?.previousElementSibling as HTMLElement;
    let nextEl = parentElement?.nextElementSibling as HTMLElement;

    let prevElLength = prevEl[this.offsetLengthProperty];
    let nextElLength = nextEl[this.offsetLengthProperty];
    let prevElContext = this.listPanelContext.get(Number(prevEl.id));
    let nextElContext = this.listPanelContext.get(Number(nextEl.id));
    if (
      buttonId.includes('1') &&
      prevElLength > 0 &&
      !this.args.reverseCollapse
    ) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        0,
        prevElLength + nextElLength,
        0,
      );
    } else if (buttonId.includes('1') && prevElLength <= 0 && prevElContext) {
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
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      nextElLength > 0
    ) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        prevElLength + nextElLength,
        0,
        undefined,
        0,
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      nextElLength <= 0 &&
      nextElContext
    ) {
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

    for (let index = 1; index <= this.listPanelContext.size; index++) {
      let panelContext = this.listPanelContext.get(index);
      let panelRatio = this.panelRatio[index - 1];
      if (!panelRatio) {
        console.warn('Expected panelRatio to be defined');
        break;
      }
      let proportionalSize = panelRatio * newContainerSize;
      let actualSize = Math.round(
        panelContext?.minLengthPx
          ? Math.max(proportionalSize, panelContext.minLengthPx)
          : proportionalSize,
      );
      panelLengths[index - 1] = actualSize;
    }

    let remainingContainerSize = newContainerSize - sumArray(panelLengths);
    let panelWithNoMinLength = Array.from(this.listPanelContext).find(
      (panelContext) => panelContext[1].minLengthPx == undefined,
    );
    if (remainingContainerSize > 0) {
      panelLengths[0] = panelLengths[0]! + remainingContainerSize;
    } else if (remainingContainerSize < 0 && panelWithNoMinLength) {
      panelLengths[panelWithNoMinLength[0] - 1] =
        panelLengths[panelWithNoMinLength[0] - 1]! + remainingContainerSize > 0
          ? panelLengths[panelWithNoMinLength[0] - 1]! + remainingContainerSize
          : 0;
    }

    for (let index = 1; index <= this.listPanelContext.size; index++) {
      let panelContext = this.listPanelContext.get(index);
      if (panelContext) {
        this.listPanelContext.set(index, {
          ...panelContext,
          lengthPx: panelLengths[index - 1] || 0,
        });
      }
    }
  }
}
