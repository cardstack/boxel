import { on } from '@ember/modifier';
import { scheduleOnce } from '@ember/runloop';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { PanelContext } from './index';
import cssVars from '../../helpers/css-var.ts';

interface Signature {
  Args: {
    defaultWidth: string;
    isLastPanel: (panelId: number) => boolean;
    minWidth?: string;
    onResizeHandlerDblClick: (event: MouseEvent) => void;
    onResizeHandlerMouseDown: (event: MouseEvent) => void;
    panelContext: (panelId: number) => PanelContext | undefined;
    // The following arguments will be supplied by the parent ResizablePanelGroup that yields this component
    registerPanel: (context: PanelContext) => number;
    width?: string;
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
      class='boxel-panel'
      style={{cssVars
        boxel-panel-width=this.panelContext.width
        boxel-panel-min-width=(if
          this.panelContext.minWidth this.panelContext.minWidth @minWidth
        )
      }}
    >
      {{yield}}
    </div>
    {{#unless this.isLastPanel}}
      <div class='separator'>
        <button
          id={{this.resizeHandlerId}}
          class='resize-handler'
          aria-label={{this.resizeHandlerId}}
          {{on 'mousedown' @onResizeHandlerMouseDown}}
          {{on 'dblclick' @onResizeHandlerDblClick}}
        ><div class={{this.arrowResizeHandlerClass}} /></button>
      </div>
    {{/unless}}
    <style>
      .boxel-panel {
        --boxel-panel-width: '300px';
        --boxel-panel-min-width: 'none';

        width: var(--boxel-panel-width);
        min-width: var(--boxel-panel-min-width);
      }
      .separator {
        display: flex;
        align-items: center;
        --boxel-panel-resize-handler-height: 100px;
        --boxel-panel-resize-handler-width: 5px;
        --boxel-panel-resize-handler-background-color: var(--boxel-highlight);

        padding: var(--boxel-sp-xxxs);
      }
      .resize-handler {
        cursor: col-resize;

        height: var(--boxel-panel-resize-handler-height);
        width: var(--boxel-panel-resize-handler-width);
        border: none;
        border-radius: var(--boxel-border-radius-xl);
        padding: 0;
        background-color: var(--boxel-panel-resize-handler-background-color);

        position: relative;
        z-index: 2;
      }
      .arrow-right {
        content: '';
        position: absolute;
        top: 50%;
        right: calc(var(--boxel-panel-resize-handler-width) * -1);
        transform: translateY(-50%);
        width: 0;
        height: 0;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-left: 10px solid
          var(--boxel-panel-resize-handler-background-color);
        pointer-events: none;
      }

      .arrow-left {
        content: '';
        position: absolute;
        top: 50%;
        left: calc(var(--boxel-panel-resize-handler-width) * -1);
        transform: translateY(-50%);
        width: 0;
        height: 0;
        border-top: 6px solid transparent;
        border-bottom: 6px solid transparent;
        border-right: 10px solid
          var(--boxel-panel-resize-handler-background-color);
        pointer-events: none;
      }
    </style>
  </template>

  @tracked id: number | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);

    // eslint-disable-next-line ember/no-incorrect-calls-with-inline-anonymous-functions
    scheduleOnce('afterRender', this, () => {
      this.id = this.args.registerPanel({
        width: this.args.width ?? this.args.defaultWidth,
        defaultWidth: this.args.defaultWidth,
      });
    });
  }

  get panelContext() {
    if (!this.id) {
      return {
        width: this.args.defaultWidth,
        defaultWidth: this.args.defaultWidth,
        minWidth: undefined,
      };
    }
    return this.args.panelContext(this.id);
  }

  get resizeHandlerId() {
    return `resize-handler-${this.id}`;
  }

  get isLastPanel() {
    return this.id && this.args.isLastPanel(this.id);
  }

  get arrowResizeHandlerClass() {
    if (
      (this.id === 1 && this.panelContext?.width !== '0px') ||
      (this.id &&
        this.args.isLastPanel(this.id + 1) &&
        this.args.panelContext(this.id + 1)?.width === '0px')
    ) {
      return 'arrow-left';
    } else if (
      (this.id && this.args.isLastPanel(this.id + 1)) ||
      (this.id === 1 && this.panelContext?.width === '0px')
    ) {
      return 'arrow-right';
    } else {
      return '';
    }
  }
}
