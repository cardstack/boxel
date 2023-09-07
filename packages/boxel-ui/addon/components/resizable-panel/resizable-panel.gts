import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { PanelGroupApi } from './resizable-panel-group';
import cssVars from '@cardstack/boxel-ui/helpers/css-var';
import { scheduleOnce } from '@ember/runloop';
import { on } from '@ember/modifier';

interface Signature {
  Element: HTMLDivElement;
  Args: {
    panelGroupApi: PanelGroupApi;
    defaultWidth: string;
    width?: string;
    minWidth?: string;
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
          {{on 'mousedown' @panelGroupApi.onResizeHandlerMouseDown}}
          {{on 'dblclick' @panelGroupApi.onResizeHandlerDblClick}}
        />
      </div>
    {{/unless}}
    <style>
      .boxel-panel {
        --boxel-panel-width: '300px';
        --boxel-panel-min-width: 'none';

        width: var(--boxel-panel-width);
        min-width: var(--boxel-panel-min-width);

        overflow: hidden;
      }
      .separator {
        display: flex;
        align-items: center;

        padding: var(--boxel-sp-xxxs);
      }
      .resize-handler {
        --boxel-panel-resize-handler-height: 100px;
        --boxel-panel-resize-handler-background-color: var(--boxel-200);
        cursor: col-resize;

        height: var(--boxel-panel-resize-handler-height);
        width: 5px;
        border: none;
        border-radius: var(--boxel-border-radius-xl);
        padding: 0;
        background-color: var(--boxel-panel-resize-handler-background-color);
      }
    </style>
  </template>

  @tracked id: number | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);

    // eslint-disable-next-line ember/no-incorrect-calls-with-inline-anonymous-functions
    scheduleOnce('afterRender', this, () => {
      this.id = this.args.panelGroupApi.registerPanel({
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
    return this.args.panelGroupApi.panelContext(this.id);
  }

  get resizeHandlerId() {
    return `resize-handler-${this.id}`;
  }

  get isLastPanel() {
    return this.id && this.args.panelGroupApi.isLastPanel(this.id);
  }
}
