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
        position: absolute;
        width: 24.5rem;
        min-height: 12.5rem;
        max-height: 75%;
        margin-left: calc(-1 * var(--boxel-sp));
        margin-top: -60px;
        background-color: var(--boxel-light);
        border-radius: var(--boxel-border-radius-xl);
        color: var(--boxel-dark);
        box-shadow: 0 5px 15px 0 rgba(0, 0, 0, 0.5);
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
