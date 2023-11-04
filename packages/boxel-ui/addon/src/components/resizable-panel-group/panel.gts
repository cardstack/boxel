import { on } from '@ember/modifier';
import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';

import cssVars from '../../helpers/css-var.ts';
import { eq } from '../../helpers/truth-helpers.ts';

export type PanelContext = {
  defaultLength: string;
  length: string;
  minLength?: string;
};

interface Signature {
  Args: {
    defaultLength: string;
    hideHandle: boolean;
    isLastPanel: (panelId: number) => boolean;
    length?: string;
    minLength?: string;
    onResizeHandlerDblClick: (event: MouseEvent) => void;
    onResizeHandlerMouseDown: (event: MouseEvent) => void;
    orientation: 'horizontal' | 'vertical';
    panelContext: (panelId: number) => PanelContext | undefined;
    registerPanel: (context: PanelContext) => number;
    reverseHandlerArrow: boolean;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

export default class Panel extends Component<Signature> {
  <template>
    <div
      id={{this.id}}
      class='boxel-panel {{@orientation}}'
      style={{if
        (eq @orientation 'horizontal')
        (cssVars
          boxel-panel-width=this.panelContext.length
          boxel-panel-min-width=(if
            this.panelContext.minLength this.panelContext.minLength @minLength
          )
        )
        (cssVars
          boxel-panel-height=this.panelContext.length
          boxel-panel-min-height=(if
            this.panelContext.minLength this.panelContext.minLength @minLength
          )
        )
      }}
    >
      {{yield}}
    </div>
    {{#unless this.isLastPanel}}
      <div class='separator-{{@orientation}}' ...attributes>
        <button
          id={{this.resizeHandlerId}}
          class='resize-handler {{@orientation}} {{if @hideHandle "hidden"}}'
          aria-label={{this.resizeHandlerId}}
          {{on 'mousedown' @onResizeHandlerMouseDown}}
          {{on 'dblclick' @onResizeHandlerDblClick}}
        ><div class={{this.arrowResizeHandlerClass}} /></button>
      </div>
    {{/unless}}
    <style>
      .boxel-panel {
        --resizable-panel-length: '300px;';
      }

      .boxel-panel.horizontal {
        --boxel-panel-width: var(--resizable-panel-length);
        --boxel-panel-min-width: 'none';

        width: var(--boxel-panel-width);
        min-width: var(--boxel-panel-min-width);
      }

      .boxel-panel.vertical {
        --boxel-panel-height: var(--resizable-panel-length);
        --boxel-panel-min-height: 'none';

        height: var(--boxel-panel-height);
        min-height: var(--boxel-panel-min-height);
      }

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
        z-index: 2;
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
    scheduleOnce('afterRender', this, this.registerPanel);
  }

  private registerPanel() {
    this.id = this.args.registerPanel({
      length: this.args.length ?? this.args.defaultLength,
      defaultLength: this.args.defaultLength,
    });
  }

  get panelContext() {
    if (!this.id) {
      return {
        length: this.args.defaultLength,
        defaultLength: this.args.defaultLength,
        minLength: undefined,
      };
    }
    return this.args.panelContext(this.id);
  }

  get resizeHandlerId() {
    return `resize-handler-${this.args.orientation}-${this.id}`;
  }

  get isLastPanel() {
    return this.id && this.args.isLastPanel(this.id);
  }

  get arrowResizeHandlerClass() {
    let horizontal = this.args.orientation === 'horizontal';
    let reverse = this.args.reverseHandlerArrow;

    if (!this.id) {
      return '';
    }

    let toward: string | null = null;

    let isFirstPanel = this.id === 1;
    let isCollapsed = this.panelContext?.length === '0px';

    let nextPanelIsLast = this.args.isLastPanel(this.id + 1);
    let nextPanelIsCollapsed =
      this.args.panelContext(this.id + 1)?.length === '0px';

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
