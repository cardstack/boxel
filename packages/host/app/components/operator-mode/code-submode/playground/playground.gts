import Component from '@glimmer/component';

import { not } from '@cardstack/boxel-ui/helpers';

import { isFieldDef, isPrimitive } from '@cardstack/runtime-common';
import type { ResolvedCodeRef } from '@cardstack/runtime-common';

import type { BaseDef, ViewCardFn } from 'https://cardstack.com/base/card-api';

import PlaygroundPanel from './playground-panel';

interface UnsupportedMessageSignature {
  Args: {
    cardOrField?: typeof BaseDef;
    codeRef?: ResolvedCodeRef;
  };
}

class UnsupportedMessage extends Component<UnsupportedMessageSignature> {
  private get unsupportedMessage() {
    if (isPrimitive(this.args.cardOrField)) {
      return 'Playground is not currently supported for primitive fields.';
    }
    return 'Playground is not currently supported for this type.';
  }

  <template>
    <p
      class='file-incompatible-message'
      data-test-playground-incompatible-message
      data-test-incompatible-nonexports={{not @codeRef}}
      data-test-incompatible-primitives={{isPrimitive @cardOrField}}
    >
      <span>
        {{this.unsupportedMessage}}
      </span>
    </p>

    <style scoped>
      .file-incompatible-message {
        display: flex;
        flex-wrap: wrap;
        align-content: center;
        justify-content: center;
        text-align: center;
        height: 100%;
        background-color: var(--boxel-200);
        font: var(--boxel-font-sm);
        color: var(--boxel-450);
        font-weight: 500;
        padding: var(--boxel-sp-xl);
        margin-block: 0;
      }
      .file-incompatible-message > span {
        max-width: 400px;
      }
    </style>
  </template>
}

interface Signature {
  Args: {
    isOpen: boolean;
    codeRef?: ResolvedCodeRef;
    isUpdating?: boolean;
    cardOrField?: typeof BaseDef;
    viewCard?: ViewCardFn;
  };
  Element: HTMLElement;
}

export default class Playground extends Component<Signature> {
  private get playgroundPanelArgs() {
    if (!this.args.codeRef || isPrimitive(this.args.cardOrField)) {
      return undefined;
    }
    return {
      codeRef: this.args.codeRef,
      isFieldDef: isFieldDef(this.args.cardOrField),
      isUpdating: this.args.isUpdating,
    };
  }

  <template>
    {{#if this.playgroundPanelArgs}}
      <PlaygroundPanel
        @codeRef={{this.playgroundPanelArgs.codeRef}}
        @isFieldDef={{this.playgroundPanelArgs.isFieldDef}}
        @isUpdating={{this.playgroundPanelArgs.isUpdating}}
        @viewCard={{@viewCard}}
      />
    {{else}}
      <UnsupportedMessage @cardOrField={{@cardOrField}} @codeRef={{@codeRef}} />
    {{/if}}
  </template>
}
