import Component from '@glimmer/component';

interface Signature {
  Element: HTMLElement;
  Blocks: {
    header: [];
    body: [];
  };
}

export default class AiAssistantPanelPopover extends Component<Signature> {
  <template>
    <style>
      .panel-popover {
        background: white;
        width: 370px;
        position: absolute;
        border-radius: var(--boxel-border-radius);
        color: black;
        max-height: 75%;
        margin-top: -60px;
        z-index: 20;
      }

      .header {
        font-size: var(--boxel-font-size-lg);
        font-weight: 600;
        padding: var(--boxel-sp-sm);
      }

      .body {
        overflow-y: auto;
        max-height: calc(75vh - 60px);
      }
    </style>

    <div class='panel-popover' ...attributes>
      <div class='header'>
        {{yield to='header'}}
      </div>
      <div class='body'>
        {{yield to='body'}}
      </div>
    </div>
  </template>
}
