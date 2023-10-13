import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { PanelContext } from './index';
import cssVars from '@cardstack/boxel-ui/helpers/css-var';
import { scheduleOnce } from '@ember/runloop';
import { on } from '@ember/modifier';
import { eq } from '@cardstack/boxel-ui/helpers/truth-helpers';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    orientation: 'horizontal' | 'vertical';
    defaultLength: string;
    length?: string;
    minLength?: string;
    // The following arguments will be supplied by the parent ResizablePanelGroup that yields this component
    registerPanel: (context: PanelContext) => number;
    panelContext: (panelId: number) => PanelContext | undefined;
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
      class='boxel-panel-{{@orientation}}'
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
      <div class='separator-{{@orientation}}'>
        <button
          id={{this.resizeHandlerId}}
          class='resize-handler-{{@orientation}}'
          aria-label={{this.resizeHandlerId}}
          {{on 'mousedown' @onResizeHandlerMouseDown}}
          {{on 'dblclick' @onResizeHandlerDblClick}}
        ><div class={{this.arrowResizeHandlerClass}} /></button>
      </div>
    {{/unless}}
    <style>
      .boxel-panel-horizontal {
        --boxel-panel-width: '300px';
        --boxel-panel-min-width: 'none';

        width: var(--boxel-panel-width);
        min-width: var(--boxel-panel-min-width);
      }

      .separator-horizontal {
        display: flex;
        align-items: center;
        --boxel-panel-resize-handler-height: 100px;
        --boxel-panel-resize-handler-width: 5px;
        --boxel-panel-resize-handler-background-color: var(--boxel-highlight);

        padding: var(--boxel-sp-xxxs);
      }

      .resize-handler-horizontal {
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

      .boxel-panel-vertical {
        --boxel-panel-height: '300px';
        --boxel-panel-min-height: 'none';

        height: var(--boxel-panel-height);
        min-height: var(--boxel-panel-min-height);
      }

      .separator-vertical {
        display: flex;
        justify-content: center;
        --boxel-panel-resize-handler-width: 100px;
        --boxel-panel-resize-handler-height: 5px;
        --boxel-panel-resize-handler-background-color: var(--boxel-highlight);

        padding: var(--boxel-sp-xxxs);
      }

      .resize-handler-vertical {
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
        length: this.args.length ?? this.args.defaultLength,
        defaultLength: this.args.defaultLength,
      });
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

    if (
      (this.id === 1 && this.panelContext?.length !== '0px') ||
      (this.id &&
        this.args.isLastPanel(this.id + 1) &&
        this.args.panelContext(this.id + 1)?.length === '0px')
    ) {
      return horizontal ? 'arrow-left' : 'arrow-top';
    } else if (
      (this.id && this.args.isLastPanel(this.id + 1)) ||
      (this.id === 1 && this.panelContext?.length === '0px')
    ) {
      return horizontal ? 'arrow-right' : 'arrow-bottom';
    } else {
      return '';
    }
  }
}
