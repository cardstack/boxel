import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import createRef from 'ember-ref-bucket/modifiers/create-ref';

import cssVars from '../../helpers/css-var.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import type ResizablePanelGroup from './index.gts';

export type PanelContext = {
  collapsible: boolean;
  defaultLengthFraction?: number;
  id: number;
  initialMinLengthPx?: number;
  lengthPx: number;
  minLengthPx?: number;
  isHidden?: boolean;
};

interface Signature {
  Args: {
    collapsible?: boolean; //default true
    defaultLengthFraction: number;
    isHidden?: boolean; //default false
    isLastPanel: (panelId: number) => boolean;
    lengthPx?: number;
    minLengthPx?: number;
    orientation: 'horizontal' | 'vertical';
    panelContext: (panelId: number) => PanelContext | undefined;
    panelGroupComponent: ResizablePanelGroup;
    registerPanel: (context: {
      collapsible: boolean | undefined;
      defaultLengthFraction: number | undefined;
      lengthPx: number | undefined;
      minLengthPx: number | undefined;
      isHidden: boolean | undefined;
    }) => number;
    resizablePanelElId: (id: number | undefined) => string;
    unregisterPanel: (id: number) => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

let managePanelRegistration = modifier((_element, [panel]: [Panel]) => {
  scheduleOnce('afterRender', panel, panel.registerPanel);
});

export default class Panel extends Component<Signature> {
  <template>
    <div
      id={{(@resizablePanelElId this.id)}}
      class='boxel-panel {{@orientation}}'
      style={{if
        (eq @orientation 'horizontal')
        (cssVars
          boxel-panel-width=this.lengthCssValue
          boxel-panel-min-width=this.minLengthCssValue
        )
        (cssVars
          boxel-panel-height=this.lengthCssValue
          boxel-panel-min-height=this.minLengthCssValue
        )
      }}
      {{createRef (@resizablePanelElId this.id) bucket=@panelGroupComponent}}
      {{managePanelRegistration this}}
      ...attributes
    >
      {{yield}}
    </div>
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
    </style>
  </template>

  @tracked id: number | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);
    registerDestructor(this, this.unregisterPanel);
  }

  get panelElId() {
    return this.args.resizablePanelElId(this.id);
  }

  @action
  registerPanel() {
    if (this.id == undefined) {
      this.id = this.args.registerPanel({
        lengthPx: this.args.lengthPx,
        defaultLengthFraction: this.args.defaultLengthFraction,
        minLengthPx: this.args.minLengthPx,
        collapsible: this.args.collapsible,
        isHidden: this.args.isHidden,
      });
    }
  }

  @action
  unregisterPanel() {
    if (this.id) {
      this.args.unregisterPanel(this.id);
      this.id = undefined;
    }
  }

  get panelContext() {
    if (this.id == undefined) {
      return {
        lengthPx: undefined,
        defaultLengthFraction: this.args.defaultLengthFraction,
        minLengthPx: undefined,
      };
    }
    return this.args.panelContext(this.id);
  }

  get minLengthCssValue() {
    if (this.args.isHidden) {
      return htmlSafe('0px');
    } else if (this.panelContext?.minLengthPx !== undefined) {
      return htmlSafe(`${this.panelContext.minLengthPx}px`);
    } else if (this.args.minLengthPx !== undefined) {
      return htmlSafe(`${this.args.minLengthPx}px`);
    }
    return undefined;
  }

  get lengthCssValue() {
    let lengthPx = this.panelContext?.lengthPx;
    let defaultLengthFraction = this.panelContext?.defaultLengthFraction;
    if (this.args.isHidden) {
      return htmlSafe('0px');
    } else if (lengthPx === -1 && defaultLengthFraction) {
      return htmlSafe(`${defaultLengthFraction * 100}%`);
    } else if (lengthPx !== -1 && lengthPx !== undefined) {
      return htmlSafe(`${lengthPx}px`);
    }
    return undefined;
  }
}
