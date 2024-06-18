import { registerDestructor } from '@ember/destroyable';
import { action } from '@ember/object';
import { scheduleOnce } from '@ember/runloop';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';
import didResizeModifier from 'ember-resize-modifier/modifiers/did-resize';

import cssVars from '../../helpers/css-var.ts';
import { eq } from '../../helpers/truth-helpers.ts';

interface Signature {
  Args: {
    collapsible?: boolean; //default true
    defaultLengthFraction: number;
    didResize: (panel: Panel) => void;
    isHidden?: boolean;
    //default false
    lengthPx?: number;
    minLengthPx?: number;
    orientation: 'horizontal' | 'vertical';
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
      {{didResizeModifier this.handleResize}}
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

  @tracked lengthPx: number | undefined = 0;
  @tracked minLengthPx: number | undefined = 0;
  @tracked ratio: number | undefined;
  initialMinLengthPx: number;

  @tracked collapsible: boolean;

  constructor(owner: any, args: Signature['Args']) {
    super(owner, args);
    this.lengthPx = args.lengthPx;
    this.minLengthPx = args.minLengthPx || 0;
    this.collapsible = args.collapsible ?? true;
    this.initialMinLengthPx = this.args.minLengthPx || 0;

    registerDestructor(this, this.unregisterPanel);
  }

  get isHidden() {
    return this.args.isHidden;
  }

  get defaultLengthFraction() {
    return this.args.defaultLengthFraction;
  }

  @action
  registerPanel() {
    this.args.registerPanel(this);
  }

  @action
  unregisterPanel() {
    this.args.unregisterPanel(this);
  }

  @action handleResize() {
    console.log('resized!');
    this.args.didResize(this);
  }

  get minLengthCssValue() {
    if (this.args.isHidden) {
      return htmlSafe('0px');
    } else if (this.minLengthPx !== undefined) {
      return htmlSafe(`${this.minLengthPx}px`);
    } else if (this.args.minLengthPx !== undefined) {
      return htmlSafe(`${this.args.minLengthPx}px`);
    }
    return undefined;
  }

  get lengthCssValue() {
    let lengthPx = this.lengthPx;
    let defaultLengthFraction = this.args.defaultLengthFraction;
    console.log(
      'lengthPx',
      lengthPx,
      'defaultLengthFraction',
      defaultLengthFraction,
      'hidden?!!',
      this.args.isHidden,
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
