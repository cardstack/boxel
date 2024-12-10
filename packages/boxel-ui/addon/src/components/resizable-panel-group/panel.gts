import { action } from '@ember/object';
import { guidFor } from '@ember/object/internals';
import { htmlSafe } from '@ember/template';
import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { modifier } from 'ember-modifier';

import {
  type GetPanelStyle,
  type Orientation,
  type ResizablePanelConstraints,
} from './utils/types.ts';

interface Signature {
  Args: {
    collapsible?: boolean | undefined;
    defaultSize?: number | undefined;
    groupId: string;
    maxSize?: number | undefined;
    //In percentage
    minSize?: number | undefined;
    orientation: Orientation;
    registerPanel: (panel: Panel) => GetPanelStyle;
    unregisterPanel: (panel: Panel) => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

let managePanelRegistration = modifier((element, [panel]: [Panel]) => {
  panel.element = element as HTMLDivElement;
  panel.registerPanel();
  return () => {
    panel.unregisterPanel();
  };
});

export default class Panel extends Component<Signature> {
  <template>
    <div
      class='boxel-panel'
      style={{(this.getStyle)}}
      data-boxel-panel-group-id={{@groupId}}
      data-boxel-panel-id={{this.id}}
      {{managePanelRegistration this}}
      ...attributes
    >
      {{yield}}
    </div>
  </template>

  element!: HTMLDivElement;
  @tracked private getStyle: GetPanelStyle = () => htmlSafe('');
  private _id = guidFor(this);

  @action
  registerPanel() {
    this.getStyle = this.args.registerPanel(this);
  }

  @action
  unregisterPanel() {
    this.args.unregisterPanel(this);
  }

  get constraints(): ResizablePanelConstraints {
    return {
      collapsible:
        this.args.collapsible == undefined ? true : this.args.collapsible,
      defaultSize: this.args.defaultSize,
      minSize: this.args.minSize,
      maxSize: this.args.maxSize,
    };
  }

  get id() {
    return this._id;
  }
}
