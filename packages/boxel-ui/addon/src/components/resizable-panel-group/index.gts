import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { next } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import type { WithBoundArgs } from '@glint/template';
import didResizeModifier from 'ember-resize-modifier/modifiers/did-resize';
import { TrackedArray } from 'tracked-built-ins';

import ResizeHandle from './handle.gts';
import ResizablePanel from './panel.gts';

export { default as ResizeHandle } from './handle.gts';
export { default as ResizablePanel } from './panel.gts';

function sumArray(array: number[]) {
  return array.reduce((partialSum, a) => partialSum + a, 0);
}

interface Signature {
  Args: {
    onPanelChange?: (panels: ResizablePanel[]) => void;
    orientation: 'horizontal' | 'vertical';
    reverseCollapse?: boolean;
  };
  Blocks: {
    default: [
      // FIXME do these still make sense?
      WithBoundArgs<
        typeof ResizablePanel,
        | 'orientation'
        | 'registerPanel'
        | 'unregisterPanel'
        | 'resizablePanelElId'
      >,
      WithBoundArgs<
        typeof ResizeHandle,
        | 'hide'
        | 'onMouseDown'
        | 'onDoubleClick'
        | 'orientation'
        | 'panelGroupComponent'
        | 'registerHandle'
        | 'unregisterHandle'
        | 'reverseArrow'
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
          )
          (component
            ResizeHandle
            orientation=@orientation
            registerHandle=this.registerHandle
            unregisterHandle=this.unregisterHandle
            onMouseDown=this.onHandleMouseDown
            onDoubleClick=this.onHandleDoubleClick
            reverseArrow=this.reverseCollapse
            hide=this.hideHandles
            panelGroupComponent=this
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

  @tracked private panelGroupElement: HTMLDivElement | undefined;

  @tracked hideHandles = false;
  minimumLengthToShowHandles = 30;

  resizablePanelIdCache = new WeakMap<ResizablePanel, number>();
  panels = new TrackedArray<ResizablePanel>();
  resizeHandles = new TrackedArray<ResizeHandle>();

  currentResizeHandle: {
    handle: ResizeHandle;
    initialPosition: number;
    nextPanel?: ResizablePanel | null;
    prevPanel?: ResizablePanel | null;
  } | null = null;

  constructor(args: any, owner: any) {
    super(args, owner);

    document.addEventListener('mouseup', this.onResizeHandleMouseUp);
    document.addEventListener('mousemove', this.onResizeHandleMouseMove);

    registerDestructor(this, () => {
      document.removeEventListener('mouseup', this.onResizeHandleMouseUp);
      document.removeEventListener('mousedown', this.onResizeHandleMouseMove);
    });
  }

  private get reverseCollapse() {
    return this.args.reverseCollapse ?? false;
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

  private get perpendicularLengthProperty() {
    return this.isHorizontal ? 'clientHeight' : 'clientWidth';
  }

  private get panelGroupLengthPx() {
    return this.panelGroupElement?.[this.offsetLengthProperty];
  }

  private get panelGroupLengthWithoutResizeHandlePx() {
    let totalResizeHandleLength = this.resizeHandles.reduce(
      (prevValue, handle) => {
        return prevValue + handle.element[this.offsetLengthProperty];
      },
      0,
    );
    let panelGroupElement = this.panelGroupElement;
    if (panelGroupElement === undefined) {
      console.warn('Expected panelGroupElement to be defined');
      return undefined;
    }
    let panelGroupLengthPx = this.panelGroupLengthPx;
    if (panelGroupLengthPx === undefined) {
      console.warn('Expected panelGroupLengthPx to be defined');
      return undefined;
    }
    console.log(
      'panelGroupLengthWithoutResizeHandlePx',
      panelGroupLengthPx - totalResizeHandleLength,
    );
    return panelGroupLengthPx - totalResizeHandleLength;
  }

  @action
  registerPanel(panel: ResizablePanel) {
    console.log('registerPanel', panel, panel.lengthPx);
    console.log('isHidden?', panel.isHidden);
    if (panel.lengthPx === undefined) {
      if (
        this.panelGroupLengthPx === undefined ||
        panel.defaultLengthFraction === undefined
      ) {
        panel.lengthPx = -1;
      } else if (panel.isHidden) {
        panel.lengthPx = 0;
      } else {
        console.log(
          'else',
          panel.defaultLengthFraction,
          this.panelGroupLengthPx,
          panel.defaultLengthFraction * this.panelGroupLengthPx,
        );
        panel.lengthPx = panel.defaultLengthFraction * this.panelGroupLengthPx;
      }
    }

    console.log('lengthpx now', panel.lengthPx);

    this.panels.push(panel);
    this.calculatePanelRatio();
  }

  @action
  unregisterPanel(panel: ResizablePanel) {
    let panelIndex = this.panels.findIndex((p) => p === panel);

    if (panelIndex > -1) {
      this.panels.splice(panelIndex, 1);
      this.calculatePanelRatio();
    }
  }

  calculatePanelRatio() {
    let panelLengths = this.panels.map((panel) => panel.lengthPx ?? 0);

    console.log('panelLengths', ...panelLengths);

    for (let index = 0; index < panelLengths.length; index++) {
      let panelLength = panelLengths[index];
      let panel = this.panels[index];
      if (panelLength == undefined || !panel) {
        break;
      }
      panel.ratio = panelLength / sumArray(panelLengths);
    }

    console.log(
      'calculatePanelRatio',
      ...this.panels.map((panel) => panel.ratio),
    );
  }

  @action
  isLastPanel(panel: ResizablePanel) {
    return this.panels[this.panels.length - 1] === panel;
  }

  @action
  registerHandle(handle: ResizeHandle) {
    this.resizeHandles.push(handle);
  }

  @action
  unregisterHandle(handle: ResizeHandle) {
    let handleIndex = this.resizeHandles.indexOf(handle);
    if (handleIndex > -1) {
      this.resizeHandles.splice(handleIndex, 1);
    }
  }

  get totalResizeHandle() {
    return this.resizeHandles.length;
  }

  @action
  onHandleMouseDown(event: MouseEvent) {
    let button = event.target as HTMLElement;

    let handle = this.resizeHandles.find(
      (handle) => handle.element === button.parentNode,
    );

    console.log('handle mouse down', button, handle);

    if (this.currentResizeHandle || !handle) {
      return;
    }

    let { prevPanel, nextPanel } = this.findPanelsByResizeHandle(handle);
    if (!prevPanel || !nextPanel) {
      console.warn('prevPanelEl and nextPanelEl are required');
      return undefined;
    }
    this.currentResizeHandle = {
      handle,
      initialPosition: event[this.clientPositionProperty],
      prevPanel: prevPanel,
      nextPanel: nextPanel,
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
      !this.currentResizeHandle.prevPanel ||
      !this.currentResizeHandle.nextPanel
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
      this.currentResizeHandle.prevPanel.element[this.clientLengthProperty] +
      delta;
    let newNextPanelElLength =
      this.currentResizeHandle.nextPanel.element[this.clientLengthProperty] -
      delta;
    let prevPanelEl = this.currentResizeHandle.prevPanel;
    let nextPanelEl = this.currentResizeHandle.nextPanel;

    console.log('newPrevPanelElLength', newPrevPanelElLength);
    console.log('newNextPanelElLength', newNextPanelElLength);
    console.log('prevPanelElContext', prevPanelEl);
    console.log('nextPanelElContext', nextPanelEl);

    if (!prevPanelEl || !nextPanelEl) {
      console.warn('Expected prevPanelEl && nextPanelEl to be defined');
      return;
    }

    if (newPrevPanelElLength < 0 && newNextPanelElLength > 0) {
      newNextPanelElLength = newNextPanelElLength + newPrevPanelElLength;
      newPrevPanelElLength = 0;
    } else if (newPrevPanelElLength > 0 && newNextPanelElLength < 0) {
      newPrevPanelElLength = newPrevPanelElLength + newNextPanelElLength;
      newNextPanelElLength = 0;
    } else if (
      prevPanelEl.initialMinLengthPx &&
      newPrevPanelElLength < prevPanelEl.initialMinLengthPx &&
      newPrevPanelElLength > prevPanelEl.lengthPx
    ) {
      newNextPanelElLength =
        newNextPanelElLength -
        (prevPanelEl.initialMinLengthPx - newPrevPanelElLength);
      newPrevPanelElLength = prevPanelEl.initialMinLengthPx;
    } else if (
      nextPanelEl.initialMinLengthPx &&
      newNextPanelElLength < nextPanelEl.initialMinLengthPx &&
      newNextPanelElLength > nextPanelEl.lengthPx
    ) {
      newPrevPanelElLength =
        newPrevPanelElLength +
        (nextPanelEl.initialMinLengthPx - newNextPanelElLength);
      newNextPanelElLength = nextPanelEl.initialMinLengthPx;
    } else if (
      prevPanelEl.initialMinLengthPx &&
      newPrevPanelElLength < prevPanelEl.initialMinLengthPx &&
      newPrevPanelElLength < prevPanelEl.lengthPx
    ) {
      newNextPanelElLength = newNextPanelElLength + newPrevPanelElLength;
      newPrevPanelElLength = 0;
    } else if (
      nextPanelEl.initialMinLengthPx &&
      newNextPanelElLength < nextPanelEl.initialMinLengthPx &&
      newNextPanelElLength < nextPanelEl.lengthPx
    ) {
      newPrevPanelElLength = newPrevPanelElLength + newNextPanelElLength;
      newNextPanelElLength = 0;
    }

    console.log(
      'calling setSiblingPanelContexts in mouseMove',
      prevPanelEl,
      nextPanelEl,
      newPrevPanelElLength,
      newNextPanelElLength,
      (prevPanelEl.initialMinLengthPx &&
        newPrevPanelElLength >= prevPanelEl.initialMinLengthPx) ||
        !prevPanelEl.collapsible
        ? prevPanelEl.initialMinLengthPx
        : 0,
      (nextPanelEl.initialMinLengthPx &&
        newNextPanelElLength >= nextPanelEl.initialMinLengthPx) ||
        !nextPanelEl.collapsible
        ? nextPanelEl.initialMinLengthPx
        : 0,
    );

    // FIXME remove “context” everywhere
    this.setSiblingPanelContexts(
      prevPanelEl,
      nextPanelEl,
      newPrevPanelElLength,
      newNextPanelElLength,
      (prevPanelEl.initialMinLengthPx &&
        newPrevPanelElLength >= prevPanelEl.initialMinLengthPx) ||
        !prevPanelEl.collapsible
        ? prevPanelEl.initialMinLengthPx
        : 0,
      (nextPanelEl.initialMinLengthPx &&
        newNextPanelElLength >= nextPanelEl.initialMinLengthPx) ||
        !nextPanelEl.collapsible
        ? nextPanelEl.initialMinLengthPx
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
  onHandleDoubleClick(event: MouseEvent) {
    let handleElement = event.target as HTMLElement;
    let handle = this.resizeHandles.find(
      (handle) => handle.element === handleElement.parentNode,
    );

    if (!handle) {
      console.warn('Could not find handle');
      return;
    }

    let isFirstButton = this.resizeHandles.indexOf(handle) === 0;
    let isLastButton =
      this.resizeHandles.indexOf(handle) === this.totalResizeHandle - 1;

    let panelGroupLengthPx = this.panelGroupLengthWithoutResizeHandlePx;
    if (panelGroupLengthPx === undefined) {
      console.warn('Expected panelGroupLengthPx to be defined');
      return undefined;
    }

    let { prevPanel, nextPanel } = this.findPanelsByResizeHandle(handle);
    if (!prevPanel || !nextPanel) {
      // FIXME required where?
      console.warn('prevPanel and nextPanel are required');
      return undefined;
    }

    let prevPanelElLength = prevPanel.lengthPx;
    let nextPanelElLength = nextPanel.lengthPx;

    if (
      isFirstButton &&
      prevPanelElLength > 0 &&
      !this.args.reverseCollapse &&
      prevPanel.collapsible
    ) {
      this.setSiblingPanelContexts(
        prevPanel,
        nextPanel,
        0,
        prevPanelElLength + nextPanelElLength,
        0,
        nextPanel.initialMinLengthPx,
      );
    } else if (isFirstButton && prevPanelElLength <= 0) {
      this.setSiblingPanelContexts(
        prevPanel,
        nextPanel,
        prevPanel.defaultLengthFraction
          ? panelGroupLengthPx * prevPanel.defaultLengthFraction
          : prevPanel.lengthPx,
        prevPanel.defaultLengthFraction
          ? nextPanelElLength -
              panelGroupLengthPx * prevPanel.defaultLengthFraction
          : panelGroupLengthPx - nextPanelElLength,
        prevPanel.initialMinLengthPx,
        nextPanel.initialMinLengthPx,
      );
    } else if (isLastButton && nextPanelElLength > 0 && nextPanel.collapsible) {
      this.setSiblingPanelContexts(
        prevPanel,
        nextPanel,
        prevPanelElLength + nextPanelElLength,
        0,
        prevPanel.initialMinLengthPx,
        0,
      );
    } else if (isLastButton && nextPanelElLength <= 0) {
      this.setSiblingPanelContexts(
        prevPanel,
        nextPanel,
        nextPanel.defaultLengthFraction
          ? prevPanelElLength -
              panelGroupLengthPx * nextPanel.defaultLengthFraction
          : panelGroupLengthPx - prevPanelElLength,
        nextPanel.defaultLengthFraction
          ? panelGroupLengthPx * nextPanel.defaultLengthFraction
          : nextPanel.lengthPx,
        prevPanel.initialMinLengthPx,
        nextPanel.initialMinLengthPx,
      );
    }

    this.calculatePanelRatio();
  }

  @action
  setSiblingPanelContexts(
    prevPanel: ResizablePanel,
    nextPanel: ResizablePanel,
    newPrevLength: number,
    newNextLength: number,
    newPrevMinLength?: number,
    newNextMinLength?: number,
  ) {
    if (prevPanel) {
      prevPanel.lengthPx = newPrevLength;
      prevPanel.minLengthPx = newPrevMinLength;
    }

    if (nextPanel) {
      nextPanel.lengthPx = newNextLength;
      nextPanel.minLengthPx = newNextMinLength;
    }

    this.args.onPanelChange?.(this.panels);
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

    let panelLengths: number[] = this.panels.map((panel) => panel.lengthPx);
    let panelToNewLength = new Map<ResizablePanel, number>();

    console.log('panelLengths', ...panelLengths);

    let newContainerSize = this.panelGroupLengthWithoutResizeHandlePx;
    console.log('newContainerSize', newContainerSize);
    if (newContainerSize == undefined) {
      console.warn('Expected newContainerSize to be defined');
      return;
    }

    let remainingContainerSize = newContainerSize;
    console.log('remainingContainerSize v0', remainingContainerSize);
    let calculateLengthsOfPanelsWithMinLength = () => {
      let panels = this.panels.filter((panel) => panel.initialMinLengthPx);

      panels.forEach((panel, index) => {
        let panelRatio = panel.ratio;
        console.log(`panel index ${index} ratio: ${panelRatio}`);
        if (!panelRatio || !newContainerSize) {
          return;
        }
        let proportionalSize = panelRatio * newContainerSize;
        console.log(`panel index ${index} proportional size`, proportionalSize);
        let actualSize = Math.round(
          panel?.initialMinLengthPx
            ? Math.max(proportionalSize, panel.initialMinLengthPx)
            : proportionalSize,
        );
        panelLengths[index] = actualSize;
        panelToNewLength.set(panel, actualSize);
        remainingContainerSize = remainingContainerSize - actualSize;
      });
    };

    calculateLengthsOfPanelsWithMinLength();
    console.log(
      'remainingContainerSize after WithMinLength',
      remainingContainerSize,
    );

    let calculateLengthsOfPanelsWithoutMinLength = () => {
      let panels = this.panels.filter((panel) => !panel.initialMinLengthPx);
      console.log(
        'current panel ratios',
        ...this.panels.map((panel) => panel.ratio),
      );
      // FIXME can ?? 0 be pushed down?
      let newPanelRatios = panels.map((panel) => panel.ratio ?? 0);
      console.log('new panel ratios v1', ...newPanelRatios);
      let totalNewPanelRatio = newPanelRatios.reduce(
        (prevValue, currentValue) => prevValue + currentValue,
        0,
      );
      newPanelRatios = newPanelRatios.map(
        (panelRatio) => panelRatio / totalNewPanelRatio,
      );

      console.log('new panel ratios v2', ...newPanelRatios);

      panels.forEach((panel, index) => {
        let panelRatio = newPanelRatios[index];
        console.log(`panelRatio index ${index}: ${panelRatio}`);
        console.log(`remainingContainerSize: ${remainingContainerSize}`);
        if (!panelRatio) {
          console.warn('Expected panelRatio to be defined');
          return;
        }
        let proportionalSize = panelRatio * remainingContainerSize;
        let actualSize = Math.round(proportionalSize);
        console.log(`panel index ${index} actual size`, actualSize);
        panelLengths[index] = actualSize;
        panelToNewLength.set(panel, actualSize);
      });
    };
    calculateLengthsOfPanelsWithoutMinLength();
    console.log(
      'remainingContainerSize after WithoutMinLength',
      remainingContainerSize,
    );

    for (let index = 0; index <= this.panels.length; index++) {
      let panel = this.panels[index];
      if (panel) {
        console.log(
          `panel index ${index} length being set to ${panelToNewLength.get(
            panel,
          )}`,
        );
        // FIXME non-for?
        panel.lengthPx = panelToNewLength.get(panel) ?? 0;
        // panel.lengthPx = panelLengths[index] || 0;
      }
    }
  }

  private findPanelsByResizeHandle(handle: ResizeHandle) {
    let handleIndex = this.resizeHandles.indexOf(handle);
    if (handleIndex === -1) {
      return {
        prevPanel: undefined,
        nextPanel: undefined,
      };
    }

    let prevPanel = this.panels[handleIndex];
    let nextPanel = this.panels[handleIndex + 1];

    return {
      prevPanel,
      nextPanel,
    };
  }
}
