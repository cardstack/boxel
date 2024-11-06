import { registerDestructor } from '@ember/destroyable';
import { on } from '@ember/modifier';
import { action } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { modifier } from 'ember-modifier';

import type ResizablePanelGroup from './index.gts';

interface Signature {
  Args: {
    hide: boolean;
    onDoubleClick: (event: MouseEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    orientation: 'horizontal' | 'vertical';
    panelGroupComponent: ResizablePanelGroup;
    registerHandle: (handle: Handle) => void;
    reverseArrow: boolean;
    unregisterHandle: (handle: Handle) => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

let registerHandle = modifier((element, [handle]: [Handle]) => {
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
        class='resize-handle {{@orientation}} {{if @hide "hidden"}}'
        aria-label='Resize handle'
        {{on 'mousedown' @onMouseDown}}
        {{on 'dblclick' @onDoubleClick}}
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

      .resize-handle:hover {
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

  constructor(owner: any, args: any) {
    super(owner, args);

    registerDestructor(this, this.args.unregisterHandle);
  }

  @action registerHandle() {
    this.args.registerHandle(this);
  }
}
