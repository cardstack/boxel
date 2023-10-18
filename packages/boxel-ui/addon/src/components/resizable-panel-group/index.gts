import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import type { WithBoundArgs } from '@glint/template';
import didResizeModifier from 'ember-resize-modifier/modifiers/did-resize';
import { TrackedMap } from 'tracked-built-ins';

import type { PanelContext } from './panel.gts';
import ResizablePanel from './panel.gts';

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
      {{didResizeModifier this.onWindowResize}}
      ...attributes
    >
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
        )
      }}
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

  private get contentRectLengthProperty() {
    return this.isHorizontal ? 'width' : 'height';
  }

  listPanelContext = new TrackedMap<number, PanelContext>();
  currentResizeHandler: {
    firstEl?: HTMLElement | null;
    id: string;
    initialPosition: number;
    secondEl?: HTMLElement | null;
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

    let firstElMinLength = this.currentResizeHandler.firstEl
      .computedStyleMap()
      .get(this.cssMinLengthProperty) as { value: number };
    let secondElMinLength = this.currentResizeHandler.secondEl
      .computedStyleMap()
      .get(this.cssMinLengthProperty) as { value: number };
    if (
      (firstElMinLength && newFirstElLength < firstElMinLength.value) ||
      (secondElMinLength && newSecondElLength < secondElMinLength.value)
    ) {
      return;
    }

    let firstElId = Number(this.currentResizeHandler.firstEl?.id);
    let secondElId = Number(this.currentResizeHandler.secondEl?.id);
    this.setSiblingPanelContexts(
      firstElId,
      secondElId,
      `${newFirstElLength}px`,
      `${newSecondElLength}px`,
    );

    this.currentResizeHandler.initialPosition =
      event[this.clientPositionProperty];
  }

  // This event only applies to the first and last resize handler.
  // When triggered, it will close either the first or last panel.
  // In this scenario, the minimum length of the panel will be disregarded.
  @action
  onResizeHandlerDblClick(event: MouseEvent) {
    let buttonId = (event.target as HTMLElement).id;
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
        '0px',
        `${prevElLength + nextElLength}px`,
        `0px`,
      );
    } else if (buttonId.includes('1') && prevElLength <= 0 && prevElContext) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        prevElContext.defaultLength,
        `calc(${nextElLength}px - ${prevElContext.defaultLength})`,
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      nextElLength > 0
    ) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        `${prevElLength + nextElLength}px`,
        '0px',
        undefined,
        '0px',
      );
    } else if (
      buttonId.includes(String(this.listPanelContext.size - 1)) &&
      nextElLength <= 0 &&
      nextElContext
    ) {
      this.setSiblingPanelContexts(
        Number(prevEl.id),
        Number(nextEl.id),
        `calc(${prevElLength}px - ${nextElContext.defaultLength})`,
        nextElContext.defaultLength,
      );
    }
  }

  @action
  setSiblingPanelContexts(
    firstElId: number,
    secondElId: number,
    newFirstElLength: string,
    newSecondElLength: string,
    newFirstElMinLength?: string,
    newSecondElMinLength?: string,
  ) {
    let leftPanelContext = this.listPanelContext.get(firstElId);
    if (leftPanelContext) {
      this.listPanelContext.set(firstElId, {
        ...leftPanelContext,
        length: newFirstElLength,
        minLength: newFirstElMinLength,
      });
    }

    let rightPanelContext = this.listPanelContext.get(secondElId);
    if (rightPanelContext) {
      this.listPanelContext.set(secondElId, {
        ...rightPanelContext,
        length: newSecondElLength,
        minLength: newSecondElMinLength,
      });
    }

    this.args.onListPanelContextChange?.(
      Array.from(this.listPanelContext, ([_name, value]) => value),
    );
  }

  @action
  onWindowResize(entry: ResizeObserverEntry, _observer: ResizeObserver) {
    let panelGroupEl = entry.target as HTMLElement;

    let panelLengths = [];
    for (let index = 1; index <= this.listPanelContext.size; index++) {
      let panelEl = panelGroupEl.querySelector(
        `[id='${index}'].boxel-panel-${this.args.orientation}`,
      ) as HTMLElement;
      if (!panelEl) {
        console.error(
          `Could not find selector: [id='${index}'].boxel-panel when handling window resize for resizeable panel group`,
        );
        continue;
      }
      panelLengths.push(panelEl[this.offsetLengthProperty]);
    }
    let totalPanelLength = panelLengths.reduce(
      (partialSum, a) => partialSum + a,
    );
    let resizeHandlerSelector = `#resize-handler-${this.args.orientation}-1`;
    let resizeHandlerEl = panelGroupEl.querySelector(
      resizeHandlerSelector,
    ) as HTMLElement;
    if (!resizeHandlerEl) {
      console.error(
        `Could not find selector: ${resizeHandlerSelector} when handling window resize for resizeable panel group`,
      );
      return;
    }

    let resizeHandlerLength = (resizeHandlerEl as HTMLElement)[
      this.offsetLengthProperty
    ];
    let totalResizeHandlerLength =
      resizeHandlerLength * (this.listPanelContext.size - 1);

    let panelGroupWithoutResizeHandlerLength =
      entry.contentRect[this.contentRectLengthProperty] -
      totalResizeHandlerLength;
    let panelGroupRemainingLength =
      panelGroupWithoutResizeHandlerLength - totalPanelLength;

    if (panelGroupRemainingLength <= 0) {
      return;
    }

    let largestPanel = {
      id: 1,
      length: 0,
    };
    for (let index = 1; index <= this.listPanelContext.size; index++) {
      let panelLength = panelLengths[index - 1] || 0;
      let newLength =
        panelLength +
        Math.round(
          (panelLength / totalPanelLength) * panelGroupRemainingLength,
        );
      let panelContext = this.listPanelContext.get(index);
      if (panelContext) {
        this.listPanelContext.set(index, {
          ...panelContext,
          length: `${newLength}px`,
        });
      }
      if (largestPanel.length < newLength) {
        largestPanel.id = index;
        largestPanel.length = newLength;
      }

      panelGroupWithoutResizeHandlerLength =
        panelGroupWithoutResizeHandlerLength - newLength;
    }

    let largestPanelContext = this.listPanelContext.get(largestPanel.id);
    if (panelGroupWithoutResizeHandlerLength > 0 && largestPanelContext) {
      this.listPanelContext.set(largestPanel.id, {
        ...largestPanelContext,
        length: `${
          largestPanel.length + panelGroupWithoutResizeHandlerLength
        }px`,
      });
    }
  }
}
