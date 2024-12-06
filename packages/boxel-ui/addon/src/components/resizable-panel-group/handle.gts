import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import {
  type ResizeHandlerAction,
  registerResizeHandle,
} from './utils/panelResizeHandleRegistry.ts';
import type {
  Orientation,
  ResizeEvent,
  ResizeHandler,
  ResizeHandleState,
} from './utils/types.ts';

type RegisterResizeHandleResult = {
  doubleClickHandler: ResizeHandler;
  resizeHandler: ResizeHandler;
  startDragging: ResizeHandler;
  stopDragging: ResizeHandler;
};

interface Signature {
  Args: {
    groupId: string;
    hide?: boolean;
    orientation: Orientation;
    registerResizeHandle: (handle: Handle) => RegisterResizeHandleResult;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

let manageHandleRegistration = modifier((element, [handle]: [Handle]) => {
  handle.element = element as HTMLDivElement;
  handle.registerHandle();
});

export default class Handle extends Component<Signature> {
  <template>
    <div
      class='separator-{{@orientation}}'
      data-boxel-panel-group-id={{@groupId}}
      data-boxel-panel-resize-handle-id={{this.id}}
      {{manageHandleRegistration this}}
      ...attributes
    >
      <button
        class='resize-handle
          {{@orientation}}
          {{if this.isHover "hover"}}
          {{if @hide "hidden"}}'
        aria-label='Resize handle'
        data-test-resize-handle
      />
    </div>
    <style scoped>
      .separator-horizontal {
        display: flex;
        align-items: center;
        --boxel-panel-resize-handle-height: 100px;
        --boxel-panel-resize-handle-width: 5px;
        --boxel-panel-resize-handle-background-color: var(--boxel-450);
        --boxel-panel-resize-handle-hover-background-color: var(
          --boxel-highlight
        );

        padding: var(--boxel-sp-xxxs);
      }

      .separator-vertical {
        display: flex;
        justify-content: center;
        --boxel-panel-resize-handle-width: 100px;
        --boxel-panel-resize-handle-height: 5px;
        --boxel-panel-resize-handle-background-color: var(--boxel-450);
        --boxel-panel-resize-handle-hover-background-color: var(
          --boxel-highlight
        );

        padding: var(--boxel-sp-xxxs);
      }

      .resize-handle {
        width: var(--boxel-panel-resize-handle-width);
        height: var(--boxel-panel-resize-handle-height);

        border: none;
        border-radius: var(--boxel-border-radius-xl);
        padding: 0;
        background-color: var(--boxel-panel-resize-handle-background-color);

        position: relative;
      }

      .resize-handle:hover,
      .resize-handle.hover {
        background-color: var(
          --boxel-panel-resize-handle-hover-background-color
        );
      }

      .resize-handle.horizontal {
        cursor: col-resize;
      }

      .resize-handle.vertical {
        cursor: row-resize;
      }

      .resize-handle.hidden {
        visibility: hidden;
      }
    </style>
  </template>

  element!: HTMLDivElement;
  private _id = guidFor(this);

  @tracked private state: ResizeHandleState = 'inactive';

  @action registerHandle() {
    const { resizeHandler, startDragging, stopDragging, doubleClickHandler } =
      this.args.registerResizeHandle(this);

    const setResizeHandlerState = (
      action: ResizeHandlerAction,
      isActive: boolean,
      event: ResizeEvent,
    ) => {
      if (isActive) {
        switch (action) {
          case 'down': {
            this.state = 'drag';

            startDragging(event);
            break;
          }
          case 'move': {
            if (this.state !== 'drag') {
              this.state = 'hover';
            }

            resizeHandler(event);
            break;
          }
          case 'up': {
            this.state = 'hover';
            stopDragging(event);
            break;
          }
          case 'dblclick': {
            doubleClickHandler(event);
            break;
          }
        }
      } else {
        this.state = 'inactive';
      }
    };

    registerResizeHandle(
      this.id,
      this.element.children[0]! as HTMLElement,
      this.args.orientation,
      {
        coarse: 15,
        fine: 5,
      },
      setResizeHandlerState,
    );
  }

  get id() {
    return this._id;
  }

  private get isHover() {
    return this.state !== 'inactive';
  }
}
