import { on } from '@ember/modifier';
import Component from '@glimmer/component';

export interface PillSignature {
  Args: {
    onClick?: () => void;
  };
  Blocks: {
    icon: [];
    default: [];
  };
  Element: HTMLButtonElement | HTMLDivElement;
}

let noop = () => {};

export default class Pill extends Component<PillSignature> {
  get wrapperComponent() {
    if (this.args.onClick) {
      return ButtonPill;
    } else {
      return DivPill;
    }
  }

  <template>
    <this.wrapperComponent
      class='pill'
      {{on 'click' (if @onClick @onClick noop)}}
      ...attributes
    >
      <figure class='icon'>
        {{yield to='icon'}}
      </figure>
      <section>
        {{yield}}
      </section>
    </this.wrapperComponent>

    <style>
      .pill {
        display: inline-flex;
        padding: var(--boxel-sp-xxxs) var(--boxel-sp-xs);
        background-color: var(--boxel-light);
        border: 1px solid var(--boxel-400);
        border-radius: var(--boxel-border-radius-sm);
        font: 700 var(--boxel-font-sm);
        letter-spacing: var(--boxel-lsp-xs);
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
        margin-right: var(--boxel-sp-xxxs);
      }

      .icon :deep(img) {
        width: 20px;
        height: 20px;
      }
    </style>
  </template>
}

interface ButtonSignature {
  Args: {
    onClick: () => void;
  };
  Blocks: {
    default: [];
  };
  Element: HTMLButtonElement;
}

class ButtonPill extends Component<ButtonSignature> {
  <template>
    <button {{on 'click' (if @onClick @onClick noop)}} ...attributes>
      {{yield}}
    </button>
  </template>
}

interface DivSignature {
  Args: {};
  Blocks: {
    default: [];
  };
  Element: HTMLDivElement;
}

class DivPill extends Component<DivSignature> {
  <template>
    <div ...attributes>
      {{yield}}
    </div>
  </template>
}
