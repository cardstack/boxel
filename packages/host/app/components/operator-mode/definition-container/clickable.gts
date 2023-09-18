import Component from '@glimmer/component';
import { action } from '@ember/object';
import { on } from '@ember/modifier';

export interface ClickableArgs {
  onSelectDefinition?: (newUrl: URL | undefined) => void;
  url?: string | undefined;
}

interface ClickableSignature {
  Element: HTMLElement;
  Args: ClickableArgs;
  Blocks: {
    default: [];
  };
}

export class Clickable extends Component<ClickableSignature> {
  @action
  handleClick() {
    if (this.args.onSelectDefinition && this.args.url) {
      this.args.onSelectDefinition(new URL(this.args.url));
    }
  }
  <template>
    <button
      type='button'
      {{on 'click' this.handleClick}}
      class='clickable-button'
      ...attributes
    >
      {{yield}}
    </button>
    <style>
      .clickable-button {
        background: none;
        border: none;
        padding: 0;
        margin: 0;
        cursor: pointer;
        width: 100%;
        height: 100%;
        appearance: none;
        -webkit-appearance: none;
        -moz-appearance: none;
        border-radius: var(--boxel-border-radius);
        text-align: inherit;
      }

      .clickable-button:hover {
        outline: 2px solid var(--boxel-highlight);
      }
    </style>
  </template>
}
