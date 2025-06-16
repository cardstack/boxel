import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import {
  type ResizeHandlerAction,
  registerResizeHandle,
} from './utils/panel-resize-handle-registry.ts';
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
    orientation: Orientation;
    registerResizeHandle: (handle: Handle) => RegisterResizeHandleResult;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement;
}

let manageHandleRegistration = modifier((element, [handle]: [Handle]) => {
  handle.element = element as HTMLButtonElement;
  handle.registerHandle();
});

export default class Handle extends Component<Signature> {
  <template>
    <button
      class='separator separator-{{@orientation}}'
      data-boxel-panel-group-id={{@groupId}}
      data-boxel-panel-resize-handle-id={{this.id}}
      {{manageHandleRegistration this}}
      ...attributes
    >
      <div
        class='resize-handle {{@orientation}} {{if this.isHover "hover"}}'
        aria-label='Resize handle'
        data-test-resize-handle
      />
    </button>
    <style scoped>
      .separator {
        --boxel-panel-resize-handle-background-color: var(--boxel-450);
        --boxel-panel-resize-handle-hover-background-color: var(
          --boxel-highlight
        );

        display: flex;

        background: transparent;
        border: none;
        padding: 2px;
      }

      .separator-horizontal {
        --boxel-panel-resize-handle-height: 100px;
        --boxel-panel-resize-handle-width: 4px;

        align-items: center;
        cursor: col-resize;
      }

      .separator-vertical {
        --boxel-panel-resize-handle-width: 100px;
        --boxel-panel-resize-handle-height: 4px;

        justify-content: center;
        cursor: row-resize;
      }

      .resize-handle {
        width: var(--boxel-panel-resize-handle-width);
        height: var(--boxel-panel-resize-handle-height);

        border: none;
        border-radius: var(--boxel-border-radius-xl);
        padding: 0;
        background-color: var(--boxel-panel-resize-handle-background-color);

        position: relative;
        opacity: 0;
      }

      .separator:hover .resize-handle {
        opacity: 1;
      }

      .resize-handle:hover {
        background-color: var(
          --boxel-panel-resize-handle-hover-background-color
        );
      }
    </style>
  </template>

  element!: HTMLButtonElement;
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
      this.element,
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
