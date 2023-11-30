import { on } from '@ember/modifier';
import { action } from '@ember/object';
import Component from '@glimmer/component';
import { type ResolvedCodeRef } from '@cardstack/runtime-common/code-ref';

export interface ClickableArgs {
  openDefinition: (
    moduleHref: string,
    codeRef: ResolvedCodeRef | undefined,
    localName: string | undefined,
  ) => void;
  moduleHref: string;
  codeRef?: ResolvedCodeRef;
  localName?: string;
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
    this.args.openDefinition(
      this.args.moduleHref,
      this.args.codeRef,
      this.args.localName,
    );
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
