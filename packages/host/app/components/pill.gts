import Component from '@glimmer/component';

export interface PillSignature {
  Args: {
    inert?: boolean;
  };
  Blocks: {
    icon: [];
    default: [];
  };
  Element: HTMLButtonElement | HTMLDivElement;
}

export default class Pill extends Component<PillSignature> {
  <template>
    <button
      class='pill {{if @inert "inert"}}'
      disabled={{@inert}}
      ...attributes
    >
      <figure class='icon'>
        {{yield to='icon'}}
      </figure>
      <section>
        {{yield}}
      </section>
    </button>

    <style>
      .pill {
        display: inline-flex;
        align-items: center;
        padding: var(--boxel-sp-xxxxxs);
        padding-right: var(--boxel-sp-xxxxs);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        border-radius: var(--boxel-border-radius-sm);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
      }

      .pill.inert {
        border: 0;
        background-color: var(--boxel-100);
      }

      .pill:hover {
        background-color: var(--boxel-100);
      }

      .pill > div {
        display: flex;
      }

      .icon {
        display: flex;
        margin-block: 0;
        margin-inline: 0;
        margin-right: var(--boxel-sp-xxxxxs);
      }

      .icon :deep(img) {
        width: 20px;
        height: 20px;
      }
    </style>
  </template>
}
