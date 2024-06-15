import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import cssVars from '../../helpers/css-var.ts';
import { eq } from '../../helpers/truth-helpers.ts';
import type ResizablePanelGroup from './index.gts';

export type PanelContext = {
  collapsible: boolean;
  defaultLengthFraction?: number;
  initialMinLengthPx?: number;
  isHidden?: boolean;
  lengthPx: number;
  minLengthPx?: number;
  panel: Panel;
};

interface Signature {
  Args: {
    collapsible?: boolean; //default true
    defaultLengthFraction: number;
    isHidden?: boolean; //default false
    isLastPanel: (panel: Panel) => boolean;
    lengthPx?: number;
    minLengthPx?: number;
    orientation: 'horizontal' | 'vertical';
    panelGroupComponent: ResizablePanelGroup;
    registerPanel: (panel: Panel) => void;
    unregisterPanel: (panel: Panel) => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

let managePanelRegistration = modifier((element, [panel]: [Panel]) => {
  panel.element = element as HTMLDivElement;
  scheduleOnce('afterRender', panel, panel.registerPanel);
});

export default class Panel extends Component<Signature> {
  <template>
    <div
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

  element!: HTMLDivElement;
  @tracked panelContext: PanelContext | undefined;

  constructor(owner: any, args: any) {
    super(owner, args);
    registerDestructor(this, this.unregisterPanel);
  }

  @action
  registerPanel() {
    this.args.registerPanel(this);
  }

  @action
  unregisterPanel() {
    this.args.unregisterPanel(this);
  }

  @action setPanelContext(context: PanelContext) {
    this.panelContext = context;
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
    console.log('panelContext hmm', this.panelContext);
    let lengthPx = this.panelContext?.lengthPx;
    let defaultLengthFraction = this.panelContext?.defaultLengthFraction;
    console.log(
      'lengthPx',
      lengthPx,
      'defaultLengthFraction',
      defaultLengthFraction,
    );
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
