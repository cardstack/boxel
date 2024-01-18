import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import createRef from 'ember-ref-bucket/modifiers/create-ref';

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
    onResizeHandlerDblClick: (event: MouseEvent) => void;
    onResizeHandlerMouseDown: (event: MouseEvent) => void;
    orientation: 'horizontal' | 'vertical';
    panelContext: (panelId: number) => PanelContext | undefined;
    panelGroupComponent: ResizablePanelGroup;
    registerResizeHandler: () => number;
    resizeHandlerElId: (id: number | undefined) => string;
    reverseHandlerArrow: boolean;
    unRegisterResizeHandler: () => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

export default class ResizeHandler extends Component<Signature> {
  <template>
    <div class='separator-{{@orientation}}' ...attributes>
      <button
        id={{(@resizeHandlerElId this.id)}}
        class='resize-handler {{@orientation}} {{if @hideHandle "hidden"}}'
        aria-label={{(@resizeHandlerElId this.id)}}
        data-test-resize-handler={{(@resizeHandlerElId this.id)}}
        {{on 'mousedown' @onResizeHandlerMouseDown}}
        {{on 'dblclick' @onResizeHandlerDblClick}}
        {{createRef (@resizeHandlerElId this.id) bucket=@panelGroupComponent}}
      ><div class={{this.arrowResizeHandlerClass}} /></button>
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

      .resize-handler:hover .arrow.bottom {
        border-top-color: var(
          --boxel-panel-resize-handler-hover-background-color
        );
      }
    </style>
  </template>

  @tracked id: number | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);
    scheduleOnce('afterRender', this, this.registerResizeHandler);
    registerDestructor(this, this.args.unRegisterResizeHandler);
  }

  private registerResizeHandler() {
    this.id = this.args.registerResizeHandler();
  }

  get arrowResizeHandlerClass() {
    let horizontal = this.args.orientation === 'horizontal';
    let reverse = this.args.reverseHandlerArrow;

    if (this.id == undefined) {
      return '';
    }

    let toward: string | null = null;

    let isFirstPanel = this.id === 0;
    let isCollapsed = this.args.panelContext(this.id)?.lengthPx === 0;

    let nextPanelIsLast = this.args.isLastPanel(this.id + 1);
    let nextPanelIsCollapsed =
      this.args.panelContext(this.id + 1)?.lengthPx === 0;

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
