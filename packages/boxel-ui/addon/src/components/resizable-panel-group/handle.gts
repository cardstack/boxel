import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import type ResizablePanelGroup from './index.gts';

export type PanelContext = {
  defaultLengthFraction?: number;
  id: number;
  initialMinLengthPx?: number;
  lengthPx: number;
  minLengthPx?: number;
};

interface Signature {
  Args: {
    hideHandle: boolean;
    isLastPanel: (panelId: number) => boolean;
    onResizeHandleDblClick: (event: MouseEvent) => void;
    onResizeHandleMouseDown: (event: MouseEvent) => void;
    orientation: 'horizontal' | 'vertical';
    panelContext: (panelId: number) => PanelContext | undefined;
    panelGroupComponent: ResizablePanelGroup;
    registerResizeHandle: (handle: ResizeHandle) => number;
    resizeHandleElId: (id: number | undefined) => string;
    reverseHandlerArrow: boolean;
    unRegisterResizeHandle: () => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

let registerHandle = modifier((element, [handle]: [ResizeHandle]) => {
  handle.element = element as HTMLDivElement;
  scheduleOnce('afterRender', handle, handle.registerHandle);
});

export default class Handle extends Component<Signature> {
  <template>
    <div
      class='separator-{{@orientation}}'
      {{registerHandle this}}
      ...attributes
    >
      <button
        id={{(@resizeHandleElId this.id)}}
        class='resize-handler {{@orientation}} {{if @hideHandle "hidden"}}'
        aria-label={{(@resizeHandleElId this.id)}}
        data-test-resize-handler={{(@resizeHandleElId this.id)}}
        {{on 'mousedown' @onResizeHandleMouseDown}}
        {{on 'dblclick' @onResizeHandleDblClick}}
      ><div class={{this.arrowResizeHandleClass}} /></button>
    </div>
    <style>
      .separator-horizontal {
        display: flex;
        align-items: center;
        --boxel-panel-resize-handler-height: 100px;
        --boxel-panel-resize-handler-width: 5px;
        --boxel-panel-resize-handler-background-color: var(--boxel-450);
        --boxel-panel-resize-handler-hover-background-color: var(
          --boxel-highlight
        );

        padding: var(--boxel-sp-xxxs);
      }

      .separator-vertical {
        display: flex;
        justify-content: center;
        --boxel-panel-resize-handler-width: 100px;
        --boxel-panel-resize-handler-height: 5px;
        --boxel-panel-resize-handler-background-color: var(--boxel-450);
        --boxel-panel-resize-handler-hover-background-color: var(
          --boxel-highlight
        );

        padding: var(--boxel-sp-xxxs);
      }

      .resize-handler {
        width: var(--boxel-panel-resize-handler-width);
        height: var(--boxel-panel-resize-handler-height);

        border: none;
        border-radius: var(--boxel-border-radius-xl);
        padding: 0;
        background-color: var(--boxel-panel-resize-handler-background-color);

        position: relative;
      }

      .resize-handler:hover {
        background-color: var(
          --boxel-panel-resize-handler-hover-background-color
        );
      }

      .resize-handler.horizontal {
        cursor: col-resize;
      }

      .resize-handler.vertical {
        cursor: row-resize;
      }

      .resize-handler.hidden {
        visibility: hidden;
      }

      .arrow {
        content: '';
        position: absolute;
        width: 0;
        height: 0;
        pointer-events: none;
      }

      .arrow.right {
        top: 50%;
        right: calc(var(--boxel-panel-resize-handler-width) * -1);
        transform: translateY(-50%);
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-left: 10px solid
          var(--boxel-panel-resize-handler-background-color);
      }

      .resize-handler:hover .arrow.right {
        border-left-color: var(
          --boxel-panel-resize-handler-hover-background-color
        );
      }

      .arrow.left {
        top: 50%;
        left: calc(var(--boxel-panel-resize-handler-width) * -1);
        transform: translateY(-50%);
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-right: 10px solid
          var(--boxel-panel-resize-handler-background-color);
      }

      .resize-handler:hover .arrow.left {
        border-right-color: var(
          --boxel-panel-resize-handler-hover-background-color
        );
      }

      .arrow.top {
        left: 50%;
        top: calc(var(--boxel-panel-resize-handler-height) * -1);
        transform: translateX(-50%);
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 10px solid
          var(--boxel-panel-resize-handler-background-color);
      }

      .resize-handler:hover .arrow.top {
        border-bottom-color: var(
          --boxel-panel-resize-handler-hover-background-color
        );
      }

      .arrow.bottom {
        left: 50%;
        bottom: calc(var(--boxel-panel-resize-handler-height) * -1);
        transform: translateX(-50%);
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 10px solid
          var(--boxel-panel-resize-handler-background-color);
      }

      /* FIXME handler -> handle */
      .resize-handler:hover .arrow.bottom {
        border-top-color: var(
          --boxel-panel-resize-handler-hover-background-color
        );
      }
    </style>
  </template>

  element!: HTMLDivElement;

  constructor(owner: any, args: any) {
    super(owner, args);
    // FIMXE move into modifier? also, unregister
    registerDestructor(this, this.args.unRegisterResizeHandle);
  }

  @action registerHandle() {
    this.args.registerResizeHandle(this);
  }

  get arrowResizeHandleClass() {
    let horizontal = this.args.orientation === 'horizontal';
    let reverse = this.args.reverseHandlerArrow;

    let id = this.args.panelGroupComponent.resizeHandles.indexOf(this);
    console.log('id', id, this.args.panelGroupComponent.resizeHandles.length);

    if (id == undefined) {
      return '';
    }

    let toward: string | null = null;

    let groupComponent = this.args.panelGroupComponent;

    let isFirstPanel = id === 0;
    let isCollapsed = groupComponent.panels[id]?.lengthPx === 0;

    let nextPanelIsLast = groupComponent.resizeHandles.length - 1 === id;
    let nextPanelIsCollapsed = groupComponent.panels[id + 1]?.lengthPx === 0;

    if (isFirstPanel && !isCollapsed) {
      if (nextPanelIsLast && nextPanelIsCollapsed) {
        toward = reverse ? 'beginning' : 'end';
      } else {
        toward = reverse ? 'end' : 'beginning';
      }
    } else if (nextPanelIsLast || (isFirstPanel && isCollapsed)) {
      if (nextPanelIsCollapsed) {
        toward = 'beginning';
      } else {
        toward = reverse ? 'beginning' : 'end';
      }
    }

    if (toward) {
      if (toward === 'beginning') {
        return horizontal ? 'arrow left' : 'arrow top';
      } else {
        return horizontal ? 'arrow right' : 'arrow bottom';
      }
    } else {
      return '';
    }
  }
}
