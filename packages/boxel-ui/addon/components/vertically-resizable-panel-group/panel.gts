import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { VerticalPanelContext } from './index';
import cssVars from '@cardstack/boxel-ui/helpers/css-var';
import { scheduleOnce } from '@ember/runloop';
import { on } from '@ember/modifier';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    defaultHeight: string;
    height?: string;
    minHeight?: string;
    // The following arguments will be supplied by the parent ResizablePanelGroup that yields this component
    registerPanel: (context: VerticalPanelContext) => number;
    panelContext: (panelId: number) => VerticalPanelContext | undefined;
    isLastPanel: (panelId: number) => boolean;
    onResizeHandlerMouseDown: (event: MouseEvent) => void;
    onResizeHandlerDblClick: (event: MouseEvent) => void;
  };
  Blocks: {
    default: [];
  };
}

export default class Panel extends Component<Signature> {
  <template>
    <div
      id={{this.id}}
      class='boxel-panel'
      style={{cssVars
        boxel-panel-height=this.panelContext.height
        boxel-panel-min-height=(if
          this.panelContext.minHeight this.panelContext.minHeight @minHeight
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
        --boxel-panel-height: '300px';
        --boxel-panel-min-height: 'none';

        height: var(--boxel-panel-height);
        min-height: var(--boxel-panel-min-height);
      }

      .separator {
        display: flex;
        justify-content: center;
        --boxel-panel-resize-handler-width: 100px;
        --boxel-panel-resize-handler-height: 5px;
        --boxel-panel-resize-handler-background-color: var(--boxel-highlight);

        padding: var(--boxel-sp-xxxs);
      }

      .resize-handler {
        cursor: row-resize;

        width: var(--boxel-panel-resize-handler-width);
        height: var(--boxel-panel-resize-handler-height);
        border: none;
        border-radius: var(--boxel-border-radius-xl);
        padding: 0;
        background-color: var(--boxel-panel-resize-handler-background-color);

        position: relative;
        z-index: 2;
      }

      .arrow-top {
        content: '';
        position: absolute;
        left: 50%;
        top: calc(var(--boxel-panel-resize-handler-height) * -1);
        transform: translateX(-50%);
        width: 0;
        height: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-bottom: 10px solid
          var(--boxel-panel-resize-handler-background-color);
        pointer-events: none;
      }

      .arrow-bottom {
        content: '';
        position: absolute;
        left: 50%;
        bottom: calc(var(--boxel-panel-resize-handler-height) * -1);
        transform: translateX(-50%);
        height: 0;
        width: 0;
        border-left: 6px solid transparent;
        border-right: 6px solid transparent;
        border-top: 10px solid
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
        height: this.args.height ?? this.args.defaultHeight,
        defaultHeight: this.args.defaultHeight,
      });
    });
  }

  get panelContext() {
    if (!this.id) {
      return {
        height: this.args.defaultHeight,
        defaultHeight: this.args.defaultHeight,
        minHeight: undefined,
      };
    }
    return this.args.panelContext(this.id);
  }

  get resizeHandlerId() {
    return `vertical-resize-handler-${this.id}`;
  }

  get isLastPanel() {
    return this.id && this.args.isLastPanel(this.id);
  }

  get arrowResizeHandlerClass() {
    if (
      (this.id === 1 && this.panelContext?.height !== '0px') ||
      (this.id &&
        this.args.isLastPanel(this.id + 1) &&
        this.args.panelContext(this.id + 1)?.height === '0px')
    ) {
      return 'arrow-top';
    } else if (
      (this.id && this.args.isLastPanel(this.id + 1)) ||
      (this.id === 1 && this.panelContext?.height === '0px')
    ) {
      return 'arrow-bottom';
    } else {
      return '';
    }
  }
}
